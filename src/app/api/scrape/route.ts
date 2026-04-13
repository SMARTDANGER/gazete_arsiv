import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import * as cheerio from 'cheerio';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source_id } = body;
    
    if (!source_id) {
      return NextResponse.json({ error: "source_id is required" }, { status: 400 });
    }

    const { rows } = await sql`SELECT * FROM newspaper_sources WHERE id = ${source_id}`;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    const source = rows[0];

    // Fetch the index HTML
    const response = await fetch(source.index_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Referer': 'https://nek.istanbul.edu.tr/',
        'Connection': 'keep-alive',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
        return NextResponse.json({ error: `Failed to fetch index_url: ${response.status} ${response.statusText}` }, { status: 400 });
    }
    const html = await response.text();
    
    // Parse using cheerio
    const $ = cheerio.load(html);
    const links = $(source.pdf_link_selector);
    const results: { date_label: string; pdf_url: string }[] = [];

    links.each((i, el) => {
        const anchor = $(el);
        let href = anchor.attr('href') || '';
        
        if (!href) return; // Skip if no href

        // Build full URL
        let pdf_url = href.startsWith('http') 
          ? href 
          : `${source.base_url.endsWith('/') ? source.base_url.slice(0, -1) : source.base_url}/${href.startsWith('/') ? href.slice(1) : href}`;
        
        let date_label = '';
        if (source.date_label_selector) {
            let dateEl = anchor.closest('tr').find(source.date_label_selector);
            if (dateEl.length === 0) {
               dateEl = anchor.siblings(source.date_label_selector);
            }
            if (dateEl.length > 0) {
                date_label = dateEl.text().trim();
            }
        }
        
        // Fallback
        if (!date_label) {
            date_label = anchor.text().trim();
        }
        if (!date_label) {
            const filename = href.split('/').pop() || 'Unknown';
            date_label = filename;
        }

        results.push({ date_label, pdf_url });
    });

    let insertedCount = 0;

    // Insert all found issues
    // We should ideally do a batch insert, but for simplicity and ON CONFLICT handling,
    // we can use individual inserts or a chained parameterized query.
    // Using simple loop given typical issue counts (under a few thousand).
    for (const item of results) {
        try {
            const result = await sql`
                INSERT INTO issues (source_id, date_label, pdf_url)
                VALUES (${source.id}, ${item.date_label}, ${item.pdf_url})
                ON CONFLICT ON CONSTRAINT issues_pdf_url_key DO NOTHING
            `;
            if (result.rowCount && result.rowCount > 0) {
                insertedCount++;
            }
        } catch (insertError) {
            console.error("Error inserting issue", item.pdf_url, insertError);
            // continue inserting others
        }
    }

    return NextResponse.json({ 
        source_name: source.name,
        inserted: insertedCount,
        total_found: results.length
    });
  } catch (error: any) {
    console.error("Scrape Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
