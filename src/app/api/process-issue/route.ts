import { sql } from '@vercel/postgres';
import sharp from 'sharp';
import { createOCRClient } from 'tesseract-wasm';
import { loadWasmBinary } from 'tesseract-wasm/node';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TRAINED_DATA_URL =
  'https://github.com/tesseract-ocr/tessdata_fast/raw/main/tur.traineddata';

async function bufferToImageData(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
}

async function runOCR(imageBuffer: Buffer, modelBuffer: Uint8Array, wasmBinary: ArrayBuffer | Uint8Array): Promise<string> {
  const client = createOCRClient({ wasmBinary } as any);
  try {
    await client.loadModel(modelBuffer);
    const imageData = await bufferToImageData(imageBuffer);
    await client.loadImage(imageData as any);
    return await client.getText();
  } finally {
    client.destroy();
  }
}

export async function POST(request: Request) {
  try {
    const { issue_id } = await request.json();

    const { rows } = await sql`SELECT pdf_url FROM issues WHERE id = ${issue_id}`;
    if (!rows.length) return Response.json({ error: 'Issue not found' }, { status: 404 });

    const pdfUrl = rows[0].pdf_url;
    console.log('Downloading PDF:', pdfUrl);

    const response = await fetch(pdfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!response.ok) throw new Error('PDF fetch failed: ' + response.status);
    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    console.log('PDF downloaded, size:', pdfBuffer.length);

    console.log('Loading OCR wasm + model');
    const wasmBinary = await loadWasmBinary();
    const modelResp = await fetch(TRAINED_DATA_URL);
    if (!modelResp.ok) throw new Error('Trained data fetch failed: ' + modelResp.status);
    const modelBuffer = new Uint8Array(await modelResp.arrayBuffer());

    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const totalPages = doc.countPages();
    console.log('Total pages:', totalPages);

    for (let pageNum = 0; pageNum < totalPages; pageNum++) {
      console.log('Processing page', pageNum + 1);

      const page = doc.loadPage(pageNum);
      const matrix = mupdf.Matrix.scale(1.5, 1.5);
      const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
      const pngBuffer = Buffer.from(pixmap.asPNG());

      const processed = await sharp(pngBuffer)
        .grayscale()
        .normalise()
        .sharpen(1.5)
        .threshold(140)
        .png()
        .toBuffer();

      const text = await runOCR(processed, modelBuffer, wasmBinary);

      const cleaned = text
        .replace(/([A-Za-zçğışöüÇĞİÖŞÜ])\.\s*(?=[A-Za-zçğışöüÇĞİÖŞÜ]\.)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();

      await sql`
        INSERT INTO pages (issue_id, page_number, ocr_text)
        VALUES (${issue_id}, ${pageNum + 1}, ${cleaned})
        ON CONFLICT DO NOTHING
      `;

      console.log('Page', pageNum + 1, 'saved:', cleaned.length, 'chars');

      pixmap.destroy();
      page.destroy();
    }

    doc.destroy();
    return Response.json({ success: true, pages_processed: totalPages });

  } catch (error) {
    console.error('process-issue error:', String(error));
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
