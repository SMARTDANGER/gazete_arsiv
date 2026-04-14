import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import sharp from 'sharp';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const issue_id = searchParams.get('issue_id');
    const page_number = searchParams.get('page_number');
    if (!issue_id || !page_number) {
      return new NextResponse('missing params', { status: 400 });
    }

    const { rows } = await sql`SELECT pdf_url FROM issues WHERE id = ${issue_id}`;
    if (rows.length === 0) return new NextResponse('Not found', { status: 404 });

    const pdfResponse = await fetch(rows[0].pdf_url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!pdfResponse.ok) return new NextResponse('pdf fetch failed', { status: 502 });
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const pageIdx = parseInt(page_number) - 1;
    if (pageIdx < 0 || pageIdx >= doc.countPages()) {
      doc.destroy();
      return new NextResponse('page out of range', { status: 400 });
    }
    const page = doc.loadPage(pageIdx);
    const scale = 150 / 72;
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const pngBuffer = Buffer.from(pixmap.asPNG());
    pixmap.destroy();
    page.destroy();
    doc.destroy();

    const out = await sharp(pngBuffer)
      .grayscale()
      .normalise()
      .sharpen(1.5)
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(out), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error: any) {
    return new NextResponse(String(error?.message || error), { status: 500 });
  }
}
