'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type WordBox = {
  text: string;
  rect: { left: number; top: number; right: number; bottom: number };
};

type Props = {
  imageUrl: string;
  wordBoxes: WordBox[] | null;
  imageWidth: number | null;
  imageHeight: number | null;
  ocrText: string;
  initialQuery: string;
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function PageViewer({
  imageUrl,
  wordBoxes,
  imageWidth,
  imageHeight,
  ocrText,
  initialQuery,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [scale, setScale] = useState(1);
  const [current, setCurrent] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => {
    if (!query || !wordBoxes) return [] as WordBox[];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return wordBoxes.filter(b =>
      terms.some(t => (b.text || '').toLowerCase().includes(t))
    );
  }, [query, wordBoxes]);

  useEffect(() => {
    setCurrent(0);
  }, [query]);

  const recomputeScale = () => {
    if (!imgRef.current || !imageWidth) return;
    const disp = imgRef.current.clientWidth;
    if (disp > 0) setScale(disp / imageWidth);
  };

  useEffect(() => {
    recomputeScale();
    window.addEventListener('resize', recomputeScale);
    return () => window.removeEventListener('resize', recomputeScale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageWidth]);

  const highlightedHtml = useMemo(() => {
    const escape = (t: string) =>
      t
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    let html = escape(ocrText || '');
    if (query) {
      const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
      html = html.replace(re, '<mark class="hl-match">$1</mark>');
    }
    return html;
  }, [ocrText, query]);

  useEffect(() => {
    if (!textRef.current) return;
    const nodes = textRef.current.querySelectorAll('mark.hl-match');
    nodes.forEach((n, i) => {
      (n as HTMLElement).style.background = i === current ? '#f59e0b' : '#fde68a';
      (n as HTMLElement).style.color = '#000';
    });
    const active = nodes[current] as HTMLElement | undefined;
    if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightedHtml, current]);

  const overlayMatches = matches;
  const totalMatches = Math.max(overlayMatches.length, (textRef.current?.querySelectorAll('mark.hl-match').length || 0));

  const go = (delta: number) => {
    if (totalMatches === 0) return;
    setCurrent(c => {
      const next = c + delta;
      if (next < 0) return 0;
      if (next >= totalMatches) return totalMatches - 1;
      return next;
    });
  };

  return (
    <div>
      <div className="flex gap-4 items-center mb-4" style={{ flexWrap: 'wrap' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Bu sayfada ara..."
          style={{ flex: 1, minWidth: 200 }}
        />
        <div className="flex items-center gap-2" style={{ background: '#1f2937', padding: '0.4rem 0.8rem', borderRadius: 8 }}>
          <button type="button" onClick={() => go(-1)} disabled={current <= 0 || totalMatches === 0}>
            ← Önceki
          </button>
          <span style={{ fontSize: '0.9rem' }}>
            {totalMatches === 0 ? '0 eşleşme' : `${current + 1} / ${totalMatches} eşleşme`}
          </span>
          <button type="button" onClick={() => go(1)} disabled={totalMatches === 0 || current >= totalMatches - 1}>
            Sonraki →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2" style={{ gap: '2rem', height: '80vh' }}>
        <div className="card" style={{ padding: 0, overflow: 'auto', position: 'relative' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <img
              ref={imgRef}
              src={imageUrl}
              onLoad={recomputeScale}
              style={{ width: '100%', display: 'block' }}
              alt="Sayfa"
            />
            {imageWidth && overlayMatches.map((b, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: b.rect.left * scale,
                  top: b.rect.top * scale,
                  width: (b.rect.right - b.rect.left) * scale,
                  height: (b.rect.bottom - b.rect.top) * scale,
                  border: i === current ? '2px solid #f59e0b' : '2px solid #facc15',
                  background: i === current ? 'rgba(245,158,11,0.35)' : 'rgba(250,204,21,0.25)',
                  borderRadius: 2,
                  pointerEvents: 'none',
                }}
              />
            ))}
          </div>
        </div>

        <div className="card" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <h3 className="mb-4" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Metin (OCR)
          </h3>
          <div
            ref={textRef}
            style={{ whiteSpace: 'pre-wrap', lineHeight: '1.8', flex: 1 }}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </div>
      </div>
    </div>
  );
}
