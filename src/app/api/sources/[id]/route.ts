import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const { id } = params;
    const body = await request.json();
    const { name, base_url, index_url, pdf_link_selector, date_label_selector, notes } = body;

    // Explicitly handle date_label_selector: empty string → null (means "use link text")
    // Only keep existing DB value if the field was not sent at all (undefined)
    const resolvedDateSelector = date_label_selector === undefined 
      ? undefined  // will use COALESCE to keep existing
      : (date_label_selector === '' ? null : date_label_selector);

    const resolvedNotes = notes === undefined
      ? undefined
      : (notes === '' ? null : notes);

    const { rows } = await sql`
      UPDATE newspaper_sources 
      SET 
        name = COALESCE(${name ?? null}, name),
        base_url = COALESCE(${base_url ?? null}, base_url),
        index_url = COALESCE(${index_url ?? null}, index_url),
        pdf_link_selector = COALESCE(${pdf_link_selector ?? null}, pdf_link_selector),
        date_label_selector = CASE 
          WHEN ${resolvedDateSelector === undefined ? 'keep' : 'update'} = 'keep' 
          THEN date_label_selector 
          ELSE ${resolvedDateSelector ?? null}
        END,
        notes = CASE 
          WHEN ${resolvedNotes === undefined ? 'keep' : 'update'} = 'keep' 
          THEN notes 
          ELSE ${resolvedNotes ?? null}
        END
      WHERE id = ${id}
      RETURNING *
    `;

    if (rows.length === 0) {
        return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const sid = Number(id);
    if (!Number.isFinite(sid)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    await sql`DELETE FROM pages WHERE issue_id IN (SELECT id FROM issues WHERE source_id = ${sid})`;
    await sql`DELETE FROM issues WHERE source_id = ${sid}`;
    const { rowCount } = await sql`DELETE FROM newspaper_sources WHERE id = ${sid}`;

    if (!rowCount) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: rowCount });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
