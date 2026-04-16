import { sql } from '@vercel/postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function setup() {
  try {
    console.log('Creating newspaper_sources table...');
    await sql`
      CREATE TABLE IF NOT EXISTS newspaper_sources (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        index_url TEXT NOT NULL,
        pdf_link_selector TEXT NOT NULL,
        date_label_selector TEXT,
        notes TEXT
      );
    `;

    console.log('Creating issues table...');
    await sql`
      CREATE TABLE IF NOT EXISTS issues (
        id SERIAL PRIMARY KEY,
        source_id INTEGER REFERENCES newspaper_sources(id),
        date_label TEXT NOT NULL,
        pdf_url TEXT NOT NULL UNIQUE
      );
    `;

    console.log('Creating pages table...');
    await sql`
      CREATE TABLE IF NOT EXISTS pages (
        id SERIAL PRIMARY KEY,
        issue_id INTEGER REFERENCES issues(id),
        page_number INTEGER NOT NULL,
        ocr_text TEXT
      );
    `;

    console.log('Adding status/page_count columns to issues...');
    await sql`ALTER TABLE issues ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`;
    await sql`ALTER TABLE issues ADD COLUMN IF NOT EXISTS page_count INTEGER`;
    await sql`UPDATE issues SET status = 'pending' WHERE status IN ('error','processing') OR status IS NULL`;

    console.log('Ensuring pages.tsv generated column...');
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

    console.log('Creating indexes...');
    await sql`CREATE INDEX IF NOT EXISTS pages_tsv_idx ON pages USING GIN (tsv)`;
    await sql`CREATE INDEX IF NOT EXISTS pages_issue_id_idx ON pages (issue_id)`;
    await sql`CREATE INDEX IF NOT EXISTS issues_source_id_idx ON issues (source_id)`;
    await sql`CREATE INDEX IF NOT EXISTS issues_source_date_idx ON issues (source_id, date_label DESC)`;

    console.log('Database setup completed successfully.');
  } catch (error) {
    console.error('Error during database setup:', error);
  }
}

setup();
