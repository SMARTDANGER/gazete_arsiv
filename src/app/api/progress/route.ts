import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const source_id = searchParams.get('source_id');

    if (!source_id) {
      return Response.json({ error: "source_id is required" }, { status: 400 });
    }

    // Total issues for this source
    const { rows: totalRows } = await sql`
      SELECT count(*) as total FROM issues WHERE source_id = ${source_id}
    `;
    const total = parseInt(totalRows[0].total);

    // Completed = issues that have at least 1 page
    const { rows: completedRows } = await sql`
      SELECT count(DISTINCT i.id) as completed
      FROM issues i
      INNER JOIN pages p ON p.issue_id = i.id
      WHERE i.source_id = ${source_id}
    `;
    const completed = parseInt(completedRows[0].completed);

    const pending = total - completed;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return Response.json({ total, completed, pending, percent });
  } catch (error) {
    console.error('progress error:', error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
