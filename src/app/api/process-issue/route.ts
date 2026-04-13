import { sql } from '@vercel/postgres';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function pdfPageToImageBuffer(pdfBuffer: Buffer, pageNum: number): Promise<Buffer> {
  const { createCanvas } = await import('canvas');
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdfDoc = await loadingTask.promise;
  const page = await pdfDoc.getPage(pageNum);

  const scale = 2.5;
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');

  await page.render({ canvasContext: context as any, viewport }).promise;

  return canvas.toBuffer('image/png');
}

export async function POST(request: Request) {
  try {
    const { issue_id } = await request.json();

    const { rows } = await sql`SELECT pdf_url FROM issues WHERE id = ${issue_id}`;
    if (!rows.length) return Response.json({ error: 'Issue not found' }, { status: 404 });

    const pdfUrl = rows[0].pdf_url;
    console.log('Downloading PDF:', pdfUrl);

    const response = await fetch(pdfUrl);
    if (!response.ok) throw new Error('PDF fetch failed: ' + response.status);
    const pdfBuffer = Buffer.from(await response.arrayBuffer());

    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
    const pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages;
    console.log('Total pages:', totalPages);

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      console.log('Processing page', pageNum, 'of', totalPages);

      const imageBuffer = await pdfPageToImageBuffer(pdfBuffer, pageNum);

      const processed = await sharp(imageBuffer)
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
        VALUES (${issue_id}, ${pageNum}, ${cleaned})
        ON CONFLICT DO NOTHING
      `;

      console.log('Page', pageNum, 'saved,', cleaned.length, 'chars');
    }

    return Response.json({ success: true, pages_processed: totalPages });
  } catch (error) {
    console.error('process-issue error:', String(error));
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
