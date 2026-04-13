export const maxDuration = 300;
export const dynamic = 'force-dynamic';

import { sql } from '@/lib/db';
import { pdf } from 'pdf-to-img';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';

async function processPDF(pdfUrl: string, issueId: number) {
  const response = await fetch(pdfUrl);
  if (!response.ok) {
    throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
  }
  const pdfBuffer = await response.arrayBuffer();

  const document = await pdf(Buffer.from(pdfBuffer), { scale: 3 });
  let pageNumber = 0;

  for await (const pageImage of document) {
    pageNumber++;

    const processed = await sharp(Buffer.from(pageImage))
      .grayscale()
      .normalise()
      .sharpen(1.5)
      .threshold(140)
      .png()
      .toBuffer();

    console.log(`[OCR] Issue ${issueId} page ${pageNumber}: running Tesseract...`);
    const { data: { text } } = await Tesseract.recognize(processed, 'tur');

    const cleaned = text
      .replace(/\b([A-ZÇĞİÖŞÜa-zçğışöüA-Z])\.\s*(?=[A-ZÇĞİÖŞÜa-zçğışöüA-Z]\.)/g, '$1')
      .replace(/(?<!\w)([a-zA-ZçğışöüÇĞİÖŞÜ])\s+(?=[a-zA-ZçğışöüÇĞİÖŞÜ]\s)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    await sql`
      INSERT INTO pages (issue_id, page_number, ocr_text)
      VALUES (${issueId}, ${pageNumber}, ${cleaned})
    `;

    console.log(`[OCR] Issue ${issueId} page ${pageNumber} done: ${cleaned.length} chars`);
  }

  return pageNumber;
}

export async function POST(request: Request) {
  let issueIdForLog: string | number = 'unknown';
  try {
    const { issue_id } = await request.json();
    issueIdForLog = issue_id;
    if (!issue_id) {
      return Response.json({ error: "issue_id is required" }, { status: 400 });
    }

    const { rows } = await sql`SELECT pdf_url FROM issues WHERE id = ${issue_id}`;
    if (rows.length === 0) {
      return Response.json({ error: "Issue not found" }, { status: 404 });
    }
    const pdf_url = rows[0].pdf_url;
    console.log(`[OCR] Processing issue ${issue_id} from ${pdf_url}`);

    const pages_processed = await processPDF(pdf_url, issue_id);

    console.log(`[OCR] Finished processing issue ${issue_id}. Pages: ${pages_processed}`);
    return Response.json({ pages_processed });
  } catch (error) {
    console.error(`[OCR] Process error for issue ${issueIdForLog}:`, error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
