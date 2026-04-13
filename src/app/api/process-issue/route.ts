import { sql } from '@vercel/postgres';
import sharp from 'sharp';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

let cachedWasmBinary: Uint8Array | null = null;
let cachedModelData: Uint8Array | null = null;

async function getWasmBinary(): Promise<Uint8Array> {
  if (cachedWasmBinary) return cachedWasmBinary;
  const { loadWasmBinary } = await import('tesseract-wasm/node');
  cachedWasmBinary = await loadWasmBinary();
  return cachedWasmBinary;
}

async function getModelData(): Promise<Uint8Array> {
  if (cachedModelData) return cachedModelData;
  const res = await fetch('https://github.com/tesseract-ocr/tessdata_fast/raw/main/tur.traineddata');
  if (!res.ok) throw new Error('Model fetch failed: ' + res.status);
  cachedModelData = new Uint8Array(await res.arrayBuffer());
  return cachedModelData;
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

    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const totalPages = doc.countPages();
    console.log('Total pages:', totalPages);

    const { createOCREngine } = await import('tesseract-wasm');
    const wasmBinary = await getWasmBinary();
    const modelData = await getModelData();

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

      const engine = await createOCREngine({ wasmBinary });
      engine.loadModel(modelData);

      const { data, info } = await sharp(processed)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      engine.loadImage({
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        width: info.width,
        height: info.height,
      });
      const text = engine.getText();
      engine.destroy();

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
