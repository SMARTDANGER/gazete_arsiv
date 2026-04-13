import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source_id, limit = 10 } = body;
    
    if (!source_id) {
      return NextResponse.json({ error: "source_id is required" }, { status: 400 });
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
        return NextResponse.json({ processed: 0, errors: [], message: "No unprocessed issues found." });
    }

    let processed = 0;
    const errors: string[] = [];

    // Process each issue directly instead of self-fetching (avoids serverless timeout issues)
    for (const issue of issuesToProcess) {
        try {
            console.log(`[Batch] Processing issue ${issue.id} inline...`);
            
            // Inline the process-issue logic instead of HTTP self-call
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
            const arrayBuffer = await resp.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Convert to images
            const { fromBuffer } = await import('pdf2pic');
            const sharp = (await import('sharp')).default;
            const Tesseract = (await import('tesseract.js')).default;
            const os = await import('os');
            const path = await import('path');

            const savePath = path.join(os.tmpdir(), 'gazete_arsiv');
            const convert = fromBuffer(buffer, {
                density: 300,
                saveFilename: `issue_${issue.id}_page`,
                savePath,
                format: "png",
                width: 2048
            });
            const pagesOutput = await convert.bulk(-1, { responseType: "buffer" });

            let pagesInserted = 0;
            for (const pageData of pagesOutput) {
                if (!pageData.buffer) continue;

                const processedImageBuffer = await sharp(pageData.buffer)
                    .grayscale()
                    .normalize()
                    .sharpen(1.5)
                    .threshold(140)
                    .toBuffer();

                const { data: { text } } = await Tesseract.recognize(processedImageBuffer, 'tur');

                const cleanText = text
                    .replace(/([A-ZÇŞĞIİÖÜa-zçşğıiöü])[.\s]{1,2}(?=[A-ZÇŞĞIİÖÜa-zçşğıiöü][.\s])/g, '$1')
                    .replace(/\s+/g, ' ')
                    .trim();

                await sql`
                    INSERT INTO pages (issue_id, page_number, ocr_text)
                    VALUES (${issue.id}, ${pageData.page}, ${cleanText})
                `;
                pagesInserted++;
            }

            console.log(`[Batch] Issue ${issue.id} done: ${pagesInserted} pages`);
            processed++;
        } catch (err: any) {
            console.error(`[Batch] Issue ${issue.id} error:`, err);
            errors.push(`Issue ${issue.id} failed: ${err.message}`);
        }
    }

    return NextResponse.json({ processed, errors });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
