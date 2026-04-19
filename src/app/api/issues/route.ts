import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const source_id = searchParams.get('source_id');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    if (!source_id) {
       return NextResponse.json({ error: "source_id is required" }, { status: 400 });
    }

    await sql`ALTER TABLE issues ADD COLUMN IF NOT EXISTS ocr_dpi INTEGER DEFAULT NULL`;

    // Get total count for pagination
    const { rows: countRows } = await sql`
      SELECT count(*) as total FROM issues WHERE source_id = ${source_id}
    `;
    const totalCount = parseInt(countRows[0].total);

    const { rows } = await sql`
      SELECT i.id, i.date_label, i.pdf_url, i.ocr_dpi, i.status, i.page_count,
             count(p.id) as pages_count
      FROM issues i
      LEFT JOIN pages p ON p.issue_id = i.id
      WHERE i.source_id = ${source_id}
      GROUP BY i.id
      ORDER BY i.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return NextResponse.json({ issues: rows, totalCount });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await sql`ALTER TABLE issues ADD COLUMN IF NOT EXISTS ocr_dpi INTEGER DEFAULT NULL`;
    const { source_id, mode, issue_id } = await request.json();

    if (mode === 'single') {
      if (!issue_id) return NextResponse.json({ error: 'issue_id required' }, { status: 400 });
      const iid = Number(issue_id);
      await sql`DELETE FROM pages WHERE issue_id = ${iid}`;
      const { rowCount } = await sql`DELETE FROM issues WHERE id = ${iid}`;
      return NextResponse.json({ deleted: rowCount ?? 0 });
    }

    if (mode === 'reset_single') {
      if (!issue_id) return NextResponse.json({ error: 'issue_id required' }, { status: 400 });
      const iid = Number(issue_id);
      await sql`DELETE FROM pages WHERE issue_id = ${iid}`;
      const { rowCount } = await sql`UPDATE issues SET status = 'pending', page_count = NULL, ocr_dpi = NULL WHERE id = ${iid}`;
      return NextResponse.json({ reset: rowCount ?? 0 });
    }

    if (!source_id || !mode) {
      return NextResponse.json({ error: 'source_id and mode are required' }, { status: 400 });
    }
    const sid = Number(source_id);

    if (mode === 'all') {
      await sql`DELETE FROM pages WHERE issue_id IN (SELECT id FROM issues WHERE source_id = ${sid})`;
      const { rowCount } = await sql`DELETE FROM issues WHERE source_id = ${sid}`;
      return NextResponse.json({ deleted: rowCount ?? 0 });
    }

    if (mode === 'processed') {
      const { rows: processedIssues } = await sql`
        SELECT DISTINCT i.id FROM issues i
        INNER JOIN pages p ON p.issue_id = i.id
        WHERE i.source_id = ${sid}
      `;
      const ids = processedIssues.map(r => Number(r.id));
      if (ids.length === 0) return NextResponse.json({ deleted: 0 });

      await sql.query('DELETE FROM pages WHERE issue_id = ANY($1::int[])', [ids]);
      const result = await sql.query('DELETE FROM issues WHERE id = ANY($1::int[])', [ids]);
      return NextResponse.json({ deleted: result.rowCount ?? 0 });
    }

    if (mode === 'reset_ocr') {
      const { rows: processedIssues } = await sql`
        SELECT DISTINCT i.id FROM issues i
        INNER JOIN pages p ON p.issue_id = i.id
        WHERE i.source_id = ${sid}
      `;
      const ids = processedIssues.map(r => Number(r.id));
      if (ids.length === 0) return NextResponse.json({ reset: 0 });

      await sql.query('DELETE FROM pages WHERE issue_id = ANY($1::int[])', [ids]);
      const result = await sql.query(`UPDATE issues SET status = 'pending', page_count = NULL WHERE id = ANY($1::int[])`, [ids]);
      return NextResponse.json({ reset: result.rowCount ?? 0 });
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
