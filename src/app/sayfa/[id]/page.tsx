import { sql } from '@/lib/db';
import Link from 'next/link';
import PageViewer from './PageViewer';

export default async function Page(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const pageId = parseInt(params.id);
  const q = searchParams.q || '';

  const { rows } = await sql`
    SELECT
      p.id, p.issue_id, p.page_number, p.ocr_text,
      p.word_boxes, p.image_width, p.image_height,
      i.pdf_url, i.date_label, i.id as issue_id, s.name as source_name
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
  const imageUrl = `/api/page-image?issue_id=${page.issue_id}&page_number=${page.page_number}`;

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

      <PageViewer
        imageUrl={imageUrl}
        wordBoxes={page.word_boxes || null}
        imageWidth={page.image_width || null}
        imageHeight={page.image_height || null}
        ocrText={page.ocr_text || ''}
        initialQuery={q}
      />
    </div>
  );
}
