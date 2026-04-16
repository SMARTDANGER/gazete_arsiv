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

    // Stored generated tsvector column — avoids per-row to_tsvector on every scan.
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
    steps.push('pages.tsv generated column ensured');

    await sql`CREATE INDEX IF NOT EXISTS pages_tsv_idx ON pages USING GIN (tsv)`;
    steps.push('pages.tsv GIN index ensured');

    await sql`DROP INDEX IF EXISTS pages_ocr_idx`;
    steps.push('old pages_ocr_idx dropped (superseded by pages_tsv_idx)');

    await sql`CREATE INDEX IF NOT EXISTS pages_issue_id_idx ON pages (issue_id)`;
    steps.push('pages.issue_id index ensured');

    await sql`CREATE INDEX IF NOT EXISTS issues_source_id_idx ON issues (source_id)`;
    steps.push('issues.source_id index ensured');

    await sql`CREATE INDEX IF NOT EXISTS issues_source_date_idx ON issues (source_id, date_label DESC)`;
    steps.push('issues(source_id, date_label DESC) index ensured');

    return NextResponse.json({ success: true, steps });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
