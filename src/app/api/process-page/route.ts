import { sql } from '@vercel/postgres';
import sharp from 'sharp';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

let cachedWasm: Uint8Array | null = null;
let cachedModel: Uint8Array | null = null;
const pdfCache = new Map<number, Buffer>();
let schemaReady = false;

async function ensureSchema(force = false): Promise<void> {
  if (schemaReady && !force) return;
  try {
    await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS word_boxes JSONB DEFAULT NULL`;
    await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_width INTEGER DEFAULT NULL`;
    await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_height INTEGER DEFAULT NULL`;
    await sql`ALTER TABLE pages ADD CONSTRAINT pages_issue_page_unique UNIQUE (issue_id, page_number)`.catch(() => {});
    await sql`ALTER TABLE issues ADD COLUMN IF NOT EXISTS ocr_dpi INTEGER DEFAULT NULL`;
    schemaReady = true;
  } catch (e) {
    console.error('ensureSchema failed:', String(e));
    throw e;
  }
}

async function getWasm(): Promise<Uint8Array> {
  if (cachedWasm) return cachedWasm;
  const { loadWasmBinary } = await import('tesseract-wasm/node');
  cachedWasm = await loadWasmBinary();
  return cachedWasm;
}

async function getModel(): Promise<Uint8Array> {
  if (cachedModel) return cachedModel;
  const r = await fetch('https://github.com/tesseract-ocr/tessdata_fast/raw/main/tur.traineddata');
  if (!r.ok) throw new Error('Model fetch failed: ' + r.status);
  cachedModel = new Uint8Array(await r.arrayBuffer());
  return cachedModel;
}

async function getPdfBuffer(issueId: number, pdfUrl: string): Promise<Buffer> {
  const hit = pdfCache.get(issueId);
  if (hit) return hit;
  const response = await fetch(pdfUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  if (!response.ok) throw new Error('PDF fetch failed: ' + response.status);
  const buf = Buffer.from(await response.arrayBuffer());
  pdfCache.set(issueId, buf);
  return buf;
}

export async function POST(request: Request) {
  try {
    const { issue_id, page_number, dpi: dpiRaw } = await request.json();
    if (!issue_id || !page_number) {
      return Response.json({ error: 'issue_id and page_number required' }, { status: 400 });
    }
    const dpi = Math.max(100, Math.min(300, Number(dpiRaw) || 150));

    await ensureSchema();

    const { rows } = await sql`SELECT pdf_url, page_count FROM issues WHERE id = ${issue_id}`;
    if (!rows.length) return Response.json({ error: 'Issue not found' }, { status: 404 });
    const { pdf_url, page_count } = rows[0];

    const pdfBuffer = await getPdfBuffer(issue_id, pdf_url);
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');

    if (page_number < 1 || page_number > doc.countPages()) {
      doc.destroy();
      return Response.json({ error: 'page_number out of range' }, { status: 400 });
    }

    const page = doc.loadPage(page_number - 1);
    const scale = dpi / 72;
    const matrix = mupdf.Matrix.scale(scale, scale);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
    const pngBuffer = Buffer.from(pixmap.asPNG());
    pixmap.destroy();
    page.destroy();
    doc.destroy();

    const processed = await sharp(pngBuffer)
      .grayscale()
      .normalise()
      .sharpen(1.5)
      .toBuffer();

    const { createOCREngine } = await import('tesseract-wasm');
    const wasmBinary = await getWasm();
    const modelData = await getModel();

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

    let wordBoxes: Array<{ text: string; rect: { left: number; top: number; right: number; bottom: number } }> = [];
    try {
      const items = engine.getTextBoxes('word');
      wordBoxes = (items || [])
        .filter((it: any) => it && it.text && it.text.trim().length > 0)
        .map((it: any) => ({
          text: String(it.text).trim(),
          rect: {
            left: it.rect.left | 0,
            top: it.rect.top | 0,
            right: it.rect.right | 0,
            bottom: it.rect.bottom | 0,
          },
        }));
    } catch {
      try {
        const hocr: string = engine.getHOCR();
        const re = /<span class=['"]ocrx_word['"][^>]*title=['"]bbox (\d+) (\d+) (\d+) (\d+)[^'"]*['"][^>]*>([^<]+)<\/span>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(hocr)) !== null) {
          wordBoxes.push({
            text: m[5].trim(),
            rect: { left: +m[1], top: +m[2], right: +m[3], bottom: +m[4] },
          });
        }
      } catch {
        wordBoxes = [];
      }
    }

    const text: string = engine.getText();
    engine.destroy();

    const cleaned = text
      .replace(/([A-Za-zçğışöüÇĞİÖŞÜ])\.\s*(?=[A-Za-zçğışöüÇĞİÖŞÜ]\.)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    const wordBoxesJson = JSON.stringify(wordBoxes);
    const doInsert = () => sql`
      INSERT INTO pages (issue_id, page_number, ocr_text, word_boxes, image_width, image_height)
      VALUES (${issue_id}, ${page_number}, ${cleaned}, ${wordBoxesJson}::jsonb, ${info.width}, ${info.height})
      ON CONFLICT (issue_id, page_number)
      DO UPDATE SET ocr_text = EXCLUDED.ocr_text,
                    word_boxes = EXCLUDED.word_boxes,
                    image_width = EXCLUDED.image_width,
                    image_height = EXCLUDED.image_height
    `;
    try {
      await doInsert();
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/column .* does not exist|relation .* does not exist|no unique|constraint/i.test(msg)) {
        console.warn('insert failed, running ensureSchema and retrying:', msg);
        await ensureSchema(true);
        await doInsert();
      } else {
        throw e;
      }
    }

    const { rows: cntRows } = await sql`SELECT COUNT(*)::int AS done FROM pages WHERE issue_id = ${issue_id}`;
    const done = cntRows[0].done;
    const total = page_count ?? 0;

    let status: 'completed' | 'partial' | 'pending' = 'pending';
    if (total > 0 && done >= total) status = 'completed';
    else if (done > 0) status = 'partial';
    await sql`UPDATE issues SET status = ${status}, ocr_dpi = ${dpi} WHERE id = ${issue_id}`;

    const remaining = Math.max(0, total - done);
    if (remaining === 0) pdfCache.delete(issue_id);

    return Response.json({
      success: true,
      page_number,
      text_length: cleaned.length,
      remaining_pages: remaining,
      status,
    });
  } catch (error) {
    console.error('process-page error:', String(error));
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
