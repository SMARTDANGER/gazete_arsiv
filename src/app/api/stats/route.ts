import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    const { rows: totals } = await sql`
      SELECT 
        (SELECT count(*) FROM newspaper_sources) as total_sources,
        (SELECT count(*) FROM issues) as total_issues,
        (SELECT count(*) FROM pages) as total_pages,
        (SELECT count(*) FROM pages WHERE length(ocr_text) > 10) as total_processed_pages
    `;

    const { rows: breakdown } = await sql`
      SELECT 
         s.name,
         count(DISTINCT i.id) as issue_count,
         count(p.id) as page_count
      FROM newspaper_sources s
      LEFT JOIN issues i ON i.source_id = s.id
      LEFT JOIN pages p ON p.issue_id = i.id
      GROUP BY s.id, s.name
      ORDER BY s.id ASC
    `;

    return NextResponse.json({
        totals: totals[0],
        breakdown
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
