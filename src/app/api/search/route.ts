import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await sql.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pages' AND column_name = 'tsv'
      ) THEN
        ALTER TABLE pages
          ADD COLUMN tsv tsvector
          GENERATED ALWAYS AS (to_tsvector('turkish', COALESCE(ocr_text, ''))) STORED;
      END IF;
    END $$;
  `);
  await sql`CREATE INDEX IF NOT EXISTS pages_tsv_idx ON pages USING GIN (tsv)`;
  schemaReady = true;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const source_id = searchParams.get('source_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '30') || 30, 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0') || 0, 0);

    if (!q) {
      return NextResponse.json({ results: [] });
    }

    await ensureSchema();

    const sid = source_id ? Number(source_id) : null;

    const result = await sql.query(
      `
        WITH matched AS (
          SELECT p.id, p.page_number, p.issue_id, p.ocr_text
          FROM pages p
          JOIN issues i ON i.id = p.issue_id
          WHERE p.tsv @@ plainto_tsquery('turkish', $1)
            ${sid ? 'AND i.source_id = $4' : ''}
          ORDER BY i.date_label DESC
          LIMIT $2 OFFSET $3
        )
        SELECT
          m.id AS page_id,
          m.page_number,
          i.date_label,
          i.pdf_url,
          s.name AS source_name,
          ts_headline('turkish', m.ocr_text, plainto_tsquery('turkish', $1),
            'MaxWords=20, MinWords=8, StartSel=<mark>, StopSel=</mark>') AS snippet
        FROM matched m
        JOIN issues i ON i.id = m.issue_id
        JOIN newspaper_sources s ON s.id = i.source_id
        ORDER BY i.date_label DESC
      `,
      sid ? [q, limit, offset, sid] : [q, limit, offset]
    );

    const results = result.rows.map((row: any) => ({
      page_id: row.page_id,
      page_number: row.page_number,
      date_label: row.date_label,
      pdf_url: row.pdf_url,
      source_name: row.source_name,
      snippet: row.snippet,
    }));

    return NextResponse.json(
      { results },
      { headers: { 'Cache-Control': 'private, max-age=30' } }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
