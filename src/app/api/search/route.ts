import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

function findMatchingBoxes(wordBoxes: any, query: string): any[] {
  if (!wordBoxes || !Array.isArray(wordBoxes)) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return wordBoxes.filter((box: any) => {
    const t = (box?.text || '').toLowerCase();
    return terms.some(term => t.includes(term));
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const source_id = searchParams.get('source_id');

    if (!q) {
      return NextResponse.json({ results: [] });
    }

    let result;
    if (source_id) {
      result = await sql`
        SELECT
          p.id as page_id,
          p.page_number,
          p.word_boxes,
          p.image_width,
          p.image_height,
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
          p.word_boxes,
          p.image_width,
          p.image_height,
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

    const results = result.rows.map((row: any) => {
      const matching = findMatchingBoxes(row.word_boxes, q);
      return {
        page_id: row.page_id,
        page_number: row.page_number,
        date_label: row.date_label,
        pdf_url: row.pdf_url,
        source_name: row.source_name,
        snippet: row.snippet,
        image_width: row.image_width,
        image_height: row.image_height,
        match_count: matching.length,
      };
    });

    return NextResponse.json({ results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
