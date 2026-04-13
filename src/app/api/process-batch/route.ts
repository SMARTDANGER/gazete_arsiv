import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { source_id, limit = 5 } = await request.json();

    const { rows: issues } = await sql`
      SELECT i.id FROM issues i
      WHERE i.source_id = ${source_id}
      AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.issue_id = i.id)
      ORDER BY i.id ASC
      LIMIT ${limit}
    `;

    console.log('Processing', issues.length, 'issues');
    const errors: string[] = [];
    let processed = 0;

    for (const issue of issues) {
      try {
        const res = await fetch(
          new URL('/api/process-issue', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ issue_id: issue.id })
          }
        );
        const data = await res.json();
        if (data.error) errors.push('Issue ' + issue.id + ': ' + data.error);
        else processed++;
      } catch (e) {
        errors.push('Issue ' + issue.id + ': ' + String(e));
      }
    }

    return Response.json({ processed, errors, total_attempted: issues.length });
  } catch (error) {
    console.error('process-batch error:', String(error));
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
