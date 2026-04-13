import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import * as cheerio from 'cheerio';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const source_id = searchParams.get('source_id');
    
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
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
      }
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
        if (i >= 5) return false; // Return first 5 results
        const anchor = $(el);
        let href = anchor.attr('href') || '';
        
        if (!href) return; // Skip if no href

        // Build full URL
        let pdf_url = href.startsWith('http') 
          ? href 
          : `${source.base_url.endsWith('/') ? source.base_url.slice(0, -1) : source.base_url}/${href.startsWith('/') ? href.slice(1) : href}`;
        
        let date_label = '';
        if (source.date_label_selector) {
            // Find closest matching element relative to anchor. Try to limit to the current row first.
            let dateEl = anchor.closest('tr').find(source.date_label_selector);
            if (dateEl.length === 0) {
               // Fallback: just look up siblings or anywhere near... basic heuristic
               dateEl = anchor.siblings(source.date_label_selector);
            }
            if (dateEl.length > 0) {
                date_label = dateEl.text().trim();
            }
        }
        
        // Fallback 1: use anchor text
        if (!date_label) {
            date_label = anchor.text().trim();
        }
        // Fallback 2: use filename
        if (!date_label) {
            const filename = href.split('/').pop() || 'Unknown';
            date_label = filename;
        }

        results.push({ date_label, pdf_url });
    });

    return NextResponse.json({ results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
