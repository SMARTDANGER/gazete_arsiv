import { sql } from '@/lib/db';
import Link from 'next/link';

// Escape special regex characters to prevent crashes from user input
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Sanitize text to prevent XSS when used with dangerouslySetInnerHTML
function sanitizeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default async function PageViewer(props: { 
  params: Promise<{ id: string }>,
  searchParams: Promise<{ q?: string }>
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const pageId = parseInt(params.id);
  const q = searchParams.q || '';

  // Fetch data
  const { rows } = await sql`
    SELECT p.*, i.pdf_url, i.date_label, s.name as source_name 
    FROM pages p
    JOIN issues i ON p.issue_id = i.id
    JOIN newspaper_sources s ON i.source_id = s.id
    WHERE p.id = ${pageId}
  `;

  if (rows.length === 0) {
    return (
      <div className="container">
        <h1 style={{ color: '#ef4444' }}>Sayfa bulunamadı</h1>
        <Link href="/" className="btn mt-4">← Aramaya Dön</Link>
      </div>
    );
  }

  const page = rows[0];
  
  // Sanitize OCR text first to prevent XSS, then highlight search term
  let highlightedText = sanitizeHtml(page.ocr_text || '');
  if (q) {
    const safeQuery = escapeRegex(q);
    const regex = new RegExp(`(${safeQuery})`, 'gi');
    highlightedText = highlightedText.replace(regex, '<mark>$1</mark>');
  }

  return (
    <div className="container" style={{ maxWidth: '1400px' }}>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2>{page.source_name} - {page.date_label}</h2>
          <p className="subtitle" style={{ textAlign: 'left', marginBottom: 0 }}>Sayfa {page.page_number}</p>
        </div>
        <Link href={q ? `/?q=${encodeURIComponent(q)}` : '/'} className="btn btn-outline">
          ← Aramaya Dön
        </Link>
      </div>

      <div className="grid grid-cols-2" style={{ gap: '2rem', height: '80vh' }}>
        {/* PDF Viewer */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <iframe 
            src={`${page.pdf_url}#page=${page.page_number}`} 
            width="100%" 
            height="100%" 
            style={{ border: 'none' }}
            title="PDF Viewer"
          />
        </div>

        {/* OCR Text Box */}
        <div className="card" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <h3 className="mb-4" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Metin (OCR)
          </h3>
          <div 
            style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8', flex: 1 }}
            dangerouslySetInnerHTML={{ __html: highlightedText }}
          />
        </div>
      </div>
    </div>
  );
}
