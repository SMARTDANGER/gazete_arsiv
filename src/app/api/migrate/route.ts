import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const steps: string[] = [];

    await sql`ALTER TABLE issues ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT NULL`;
    steps.push('issues.page_count ensured');

    await sql`ALTER TABLE issues ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`;
    steps.push('issues.status ensured');

    await sql`UPDATE issues SET status = 'pending' WHERE status IN ('error', 'processing') OR status IS NULL`;
    steps.push('stuck issues reset to pending');

    await sql.query(`
      DELETE FROM pages a USING pages b
      WHERE a.ctid < b.ctid
        AND a.issue_id = b.issue_id
        AND a.page_number = b.page_number
    `);
    steps.push('duplicate pages removed');

    await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS word_boxes JSONB DEFAULT NULL`;
    steps.push('pages.word_boxes ensured');

    await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_width INTEGER DEFAULT NULL`;
    steps.push('pages.image_width ensured');

    await sql`ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_height INTEGER DEFAULT NULL`;
    steps.push('pages.image_height ensured');

    await sql.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'pages_issue_page_unique'
        ) THEN
          ALTER TABLE pages ADD CONSTRAINT pages_issue_page_unique UNIQUE (issue_id, page_number);
        END IF;
      END $$;
    `);
    steps.push('pages unique(issue_id, page_number) ensured');

    return NextResponse.json({ success: true, steps });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
