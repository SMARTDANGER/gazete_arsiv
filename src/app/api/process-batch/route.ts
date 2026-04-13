import { sql } from '@vercel/postgres';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { source_id, limit = 5 } = await request.json();
    if (!source_id) return Response.json({ error: 'source_id required' }, { status: 400 });

    const { rows: issues } = await sql`
      SELECT i.id, i.date_label FROM issues i
      WHERE i.source_id = ${source_id}
      AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.issue_id = i.id)
      ORDER BY i.id ASC
      LIMIT ${limit}
    `;

    return Response.json({ issues, total: issues.length });
  } catch (error) {
    console.error('process-batch error:', String(error));
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
