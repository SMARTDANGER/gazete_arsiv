import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const source_id = searchParams.get('source_id');
    
    if (!q) {
      return NextResponse.json({ results: [] });
    }

    let result;
    
    // Condition handling based on whether source_id is provided
    if (source_id) {
        result = await sql`
          SELECT 
            p.id as page_id,
            p.page_number,
            i.date_label,
            i.pdf_url,
            s.name as source_name,
            ts_headline('turkish', p.ocr_text, plainto_tsquery('turkish', ${q}),
              'MaxWords=20, MinWords=8, StartSel=<mark>, StopSel=</mark>') as snippet
          FROM pages p
          JOIN issues i ON i.id = p.issue_id
          JOIN newspaper_sources s ON s.id = i.source_id
          WHERE to_tsvector('turkish', COALESCE(p.ocr_text,'')) @@ plainto_tsquery('turkish', ${q})
            AND i.source_id = ${source_id}
          ORDER BY i.date_label DESC
          LIMIT 30
        `;
    } else {
        result = await sql`
          SELECT 
            p.id as page_id,
            p.page_number,
            i.date_label,
            i.pdf_url,
            s.name as source_name,
            ts_headline('turkish', p.ocr_text, plainto_tsquery('turkish', ${q}),
              'MaxWords=20, MinWords=8, StartSel=<mark>, StopSel=</mark>') as snippet
          FROM pages p
          JOIN issues i ON i.id = p.issue_id
          JOIN newspaper_sources s ON s.id = i.source_id
          WHERE to_tsvector('turkish', COALESCE(p.ocr_text,'')) @@ plainto_tsquery('turkish', ${q})
          ORDER BY i.date_label DESC
          LIMIT 30
        `;
    }

    return NextResponse.json({ results: result.rows });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
