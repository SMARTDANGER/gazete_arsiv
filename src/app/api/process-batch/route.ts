import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { pdf } from 'pdf-to-img';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source_id, limit = 10 } = body;
    
    if (!source_id) {
      return Response.json({ error: "source_id is required" }, { status: 400 });
    }

    const numericSourceId = Number(source_id);
    const numericLimit = Number(limit);

    // Find up to `limit` issues for this source that have 0 pages (unprocessed).
    const { rows: issuesToProcess } = await sql`
      SELECT i.id 
      FROM issues i 
      LEFT JOIN pages p ON i.id = p.issue_id 
      WHERE i.source_id = ${numericSourceId} AND p.id IS NULL 
      LIMIT ${numericLimit}
    `;

    if (issuesToProcess.length === 0) {
      return Response.json({ processed: 0, errors: [], message: "No unprocessed issues found." });
    }

    let processed = 0;
    const errors: string[] = [];

    // Process each issue inline
    for (const issue of issuesToProcess) {
      try {
        console.log(`[Batch] Processing issue ${issue.id}...`);

        const { rows: issueRows } = await sql`SELECT pdf_url FROM issues WHERE id = ${issue.id}`;
        if (issueRows.length === 0) {
          errors.push(`Issue ${issue.id}: not found in DB`);
          continue;
        }
        const pdf_url = issueRows[0].pdf_url;

        // Download PDF
        const resp = await fetch(pdf_url);
        if (!resp.ok) {
          errors.push(`Issue ${issue.id}: failed to download PDF (${resp.status})`);
          continue;
        }
        const pdfBuffer = await resp.arrayBuffer();

        // Convert PDF to images using pdf-to-img (pdf.js, no system deps)
        const document = await pdf(Buffer.from(pdfBuffer), { scale: 3 });
        let pageNumber = 0;

        for await (const pageImage of document) {
          pageNumber++;

          const processedImage = await sharp(Buffer.from(pageImage))
            .grayscale()
            .normalise()
            .sharpen(1.5)
            .threshold(140)
            .png()
            .toBuffer();

          const { data: { text } } = await Tesseract.recognize(processedImage, 'tur');

          const cleaned = text
            .replace(/\b([A-ZÇĞİÖŞÜa-zçğışöüA-Z])\.\s*(?=[A-ZÇĞİÖŞÜa-zçğışöüA-Z]\.)/g, '$1')
            .replace(/(?<!\w)([a-zA-ZçğışöüÇĞİÖŞÜ])\s+(?=[a-zA-ZçğışöüÇĞİÖŞÜ]\s)/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();

          await sql`
            INSERT INTO pages (issue_id, page_number, ocr_text)
            VALUES (${issue.id}, ${pageNumber}, ${cleaned})
          `;

          console.log(`[Batch] Issue ${issue.id} page ${pageNumber} done: ${cleaned.length} chars`);
        }

        console.log(`[Batch] Issue ${issue.id} completed: ${pageNumber} pages`);
        processed++;
      } catch (err: any) {
        console.error(`[Batch] Issue ${issue.id} error:`, err);
        errors.push(`Issue ${issue.id} failed: ${err.message}`);
      }
    }

    return Response.json({ processed, errors });
  } catch (error: any) {
    console.error('process-batch error:', error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
