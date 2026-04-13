import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    const { rows } = await sql`SELECT * FROM newspaper_sources ORDER BY id ASC`;
    return NextResponse.json(rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, base_url, index_url, pdf_link_selector, date_label_selector, notes } = body;
    
    const { rows } = await sql`
      INSERT INTO newspaper_sources (name, base_url, index_url, pdf_link_selector, date_label_selector, notes)
      VALUES (${name}, ${base_url}, ${index_url}, ${pdf_link_selector}, ${date_label_selector || null}, ${notes || null})
      RETURNING *
    `;
    
    return NextResponse.json(rows[0], { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
