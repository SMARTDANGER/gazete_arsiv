import { sql } from '@vercel/postgres';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { issue_id } = await request.json();
    if (!issue_id) return Response.json({ error: 'issue_id required' }, { status: 400 });

    const { rows } = await sql`SELECT pdf_url FROM issues WHERE id = ${issue_id}`;
    if (!rows.length) return Response.json({ error: 'Issue not found' }, { status: 404 });

    const pdfUrl = rows[0].pdf_url;
    console.log('Prep: downloading PDF', pdfUrl);

    const response = await fetch(pdfUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!response.ok) throw new Error('PDF fetch failed: ' + response.status);
    const pdfBuffer = Buffer.from(await response.arrayBuffer());

    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const page_count = doc.countPages();
    doc.destroy();

    await sql`
      UPDATE issues SET page_count = ${page_count}, status = 'pending' WHERE id = ${issue_id}
    `;

    return Response.json({ issue_id, page_count, status: 'ready' });
  } catch (error) {
    console.error('process-issue error:', String(error));
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
