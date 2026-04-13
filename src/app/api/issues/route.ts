import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const source_id = searchParams.get('source_id');
    const limit = searchParams.get('limit') || '50';

    if (!source_id) {
       return NextResponse.json({ error: "source_id is required" }, { status: 400 });
    }

    const { rows } = await sql`
      SELECT i.id, i.date_label, i.pdf_url, count(p.id) as pages_count
      FROM issues i
      LEFT JOIN pages p ON p.issue_id = i.id
      WHERE i.source_id = ${source_id}
      GROUP BY i.id
      ORDER BY i.id DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({ issues: rows });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
