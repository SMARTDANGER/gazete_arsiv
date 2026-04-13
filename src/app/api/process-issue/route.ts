import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { fromBuffer } from 'pdf2pic';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import os from 'os';
import path from 'path';

export async function POST(request: Request) {
  try {
    const { issue_id } = await request.json();
    if (!issue_id) {
        return NextResponse.json({ error: "issue_id is required" }, { status: 400 });
    }

    // 1. Get issue from DB
    const { rows } = await sql`SELECT pdf_url FROM issues WHERE id = ${issue_id}`;
    if (rows.length === 0) {
        return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }
    const pdf_url = rows[0].pdf_url;
    console.log(`[OCR] Processing issue ${issue_id} from ${pdf_url}`);

    // 2. Download the PDF as buffer
    console.log(`[OCR] Downloading PDF...`);
    const resp = await fetch(pdf_url);
    if (!resp.ok) {
        throw new Error(`Failed to download PDF: ${resp.status} ${resp.statusText}`);
    }
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Convert pages to PNG with pdf2pic
    const tmpDir = os.tmpdir();
    const savePath = path.join(tmpDir, 'gazete_arsiv');
    console.log(`[OCR] Converting PDF to images using dir: ${savePath}`);
    const options = {
      density: 300,
      saveFilename: `issue_${issue_id}_page`,
      savePath: savePath,
      format: "png",
      width: 2048
    };
    
    const convert = fromBuffer(buffer, options);
    const pagesOutput = await convert.bulk(-1, { responseType: "buffer" });
    console.log(`[OCR] Converted ${pagesOutput.length} pages.`);

    let pages_processed = 0;

    // 4. For each page
    for (let i = 0; i < pagesOutput.length; i++) {
        const pageData = pagesOutput[i];
        if (!pageData.buffer) {
            console.warn(`[OCR] Page ${pageData.page} buffer missing, skipping.`);
            continue;
        }

        console.log(`[OCR] Processing page ${pageData.page} with sharp...`);
        // 4b. Process with sharp: grayscale, normalize, sharpen, threshold
        const processedImageBuffer = await sharp(pageData.buffer)
            .grayscale()
            .normalize()
            .sharpen(1.5)
            .threshold(140)
            .toBuffer();

        console.log(`[OCR] Running Tesseract on page ${pageData.page}...`);
        // 4c. Run tesseract.js
        const { data: { text } } = await Tesseract.recognize(
            processedImageBuffer,
            'tur'
        );

        // 4d. Clean text:
        //   - Fix spaced/dotted single chars like M.E.K.T.U.P → MEKTUP
        //   - Collapse excessive whitespace
        let cleanText = text
            .replace(/([A-ZÇŞĞIİÖÜa-zçşğıiöü])[.\s]{1,2}(?=[A-ZÇŞĞIİÖÜa-zçşğıiöü][.\s])/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();

        console.log(`[OCR] Storing text for page ${pageData.page} (${cleanText.length} chars)...`);
        // 5. Insert into pages
        await sql`
            INSERT INTO pages (issue_id, page_number, ocr_text)
            VALUES (${issue_id}, ${pageData.page}, ${cleanText})
        `;
        pages_processed++;
    }

    console.log(`[OCR] Finished processing issue ${issue_id}. Pages: ${pages_processed}`);
    return NextResponse.json({ pages_processed });
  } catch (error: any) {
    console.error("[OCR] Process error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
