import { pdf } from 'pdf-to-img';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { issue_id } = await request.json();
    const { rows } = await sql`SELECT pdf_url FROM issues WHERE id = ${issue_id}`;
    if (!rows.length) return Response.json({ error: 'Issue not found' }, { status: 404 });

    const pdfUrl = rows[0].pdf_url;
    console.log('Downloading PDF:', pdfUrl);

    const response = await fetch(pdfUrl);
    if (!response.ok) throw new Error('PDF download failed: ' + response.status);
    const pdfBuffer = Buffer.from(await response.arrayBuffer());

    console.log('PDF downloaded, starting conversion');
    const document = await pdf(pdfBuffer, { scale: 2.5 });
    let pageNumber = 0;

    for await (const pageImage of document) {
      pageNumber++;
      console.log('Processing page', pageNumber);

      const processed = await sharp(Buffer.from(pageImage))
        .grayscale()
        .normalise()
        .sharpen(1.5)
        .threshold(140)
        .png()
        .toBuffer();

      const { data: { text } } = await Tesseract.recognize(processed, 'tur', {
        logger: () => {}
      });

      const cleaned = text
        .replace(/([A-Za-zçğışöüÇĞİÖŞÜ])\.\s*(?=[A-Za-zçğışöüÇĞİÖŞÜ]\.)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();

      await sql`
        INSERT INTO pages (issue_id, page_number, ocr_text)
        VALUES (${issue_id}, ${pageNumber}, ${cleaned})
        ON CONFLICT DO NOTHING
      `;

      console.log('Page', pageNumber, 'saved:', cleaned.length, 'chars');
    }

    return Response.json({ success: true, pages_processed: pageNumber });
  } catch (error) {
    console.error('process-issue error:', String(error));
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
