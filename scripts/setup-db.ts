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

    console.log('Creating GIN index on pages.ocr_text...');
    // Create the index if it doesn't already exist.
    // PostgreSQL string escaping and conditional creation for index
    await sql`
      CREATE INDEX IF NOT EXISTS pages_ocr_idx ON pages 
      USING GIN (to_tsvector('turkish', COALESCE(ocr_text, '')));
    `;

    console.log('Database setup completed successfully.');
  } catch (error) {
    console.error('Error during database setup:', error);
  }
}

setup();
