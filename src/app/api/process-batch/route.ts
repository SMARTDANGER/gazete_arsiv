import { sql } from '@vercel/postgres';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

async function ensureSchema(): Promise<void> {
  await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS word_boxes JSONB DEFAULT NULL`;
  await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_width INTEGER DEFAULT NULL`;
  await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_height INTEGER DEFAULT NULL`;
  await sql`ALTER TABLE pages ADD CONSTRAINT pages_issue_page_unique UNIQUE (issue_id, page_number)`.catch(() => {});
  await sql`ALTER TABLE issues ADD COLUMN IF NOT EXISTS ocr_dpi INTEGER DEFAULT NULL`;
}

export async function POST(request: Request) {
  try {
    const { source_id, limit = 5 } = await request.json();
    if (!source_id) return Response.json({ error: 'source_id required' }, { status: 400 });

    await ensureSchema();

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
