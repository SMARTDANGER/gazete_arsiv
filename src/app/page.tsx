'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

type Source = { id: number; name: string };
type SearchResult = {
  page_id: number;
  page_number: number;
  date_label: string;
  pdf_url: string;
  source_name: string;
  snippet: string;
};

export default function Home() {
  const [sources, setSources] = useState<Source[]>([]);
  const [query, setQuery] = useState('');
  const [sourceId, setSourceId] = useState<string>('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/sources')
      .then(res => res.json())
      .then(data => {
         if(Array.isArray(data)) setSources(data);
      })
      .catch(err => console.error("Failed to load sources", err));
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    
    try {
      let url = `/api/search?q=${encodeURIComponent(query)}`;
      if (sourceId) {
        url += `&source_id=${sourceId}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Arama hatası');
      
      setResults(data.results || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <header className="header" style={{ textAlign: 'center', position: 'relative' }}>
        <Link 
          href="/admin" 
          className="btn btn-outline" 
          style={{ position: 'absolute', right: 0, top: 0, fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
        >
          Admin →
        </Link>
        <h1>Gazete Arşiv</h1>
        <p className="subtitle">Tarihi Türk Gazetelerinde Arama</p>
      </header>

      <div className="card mb-8">
        <form onSubmit={handleSearch} className="flex gap-4">
          <input 
            type="text" 
            placeholder="Aranacak kelime..." 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <select 
            value={sourceId} 
            onChange={(e) => setSourceId(e.target.value)}
            style={{ width: '200px' }}
          >
            <option value="">Tüm Gazeteler</option>
            {sources.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button type="submit" disabled={loading || !query.trim()}>
            {loading ? 'Aranıyor...' : 'Ara'}
          </button>
        </form>
      </div>

      {error && (
        <div className="card mb-8" style={{ borderLeft: '4px solid #ef4444' }}>
          <p style={{ color: '#ef4444' }}>{error}</p>
        </div>
      )}

      {loading && <div className="spinner"></div>}

      {!loading && results !== null && (
        <div>
          <h3 className="mb-4">Sonuçlar ({results.length})</h3>
          
          {results.length === 0 ? (
            <p className="subtitle">Sonuç bulunamadı.</p>
          ) : (
            <div className="grid grid-cols-2">
              {results.map((res, i) => (
                <div key={`${res.page_id}-${i}`} className="card">
                  <div className="flex justify-between items-center mb-2">
                    <h4 style={{ color: 'var(--primary-color)' }}>{res.source_name}</h4>
                    <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Sayfa {res.page_number}</span>
                  </div>
                  <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>Sayı: {res.date_label}</p>
                  
                  <div 
                    className="snippet-preview" 
                    dangerouslySetInnerHTML={{ __html: res.snippet }}
                  />
                  
                  <div className="mt-4" style={{ textAlign: 'right' }}>
                    <Link 
                      href={`/sayfa/${res.page_id}?q=${encodeURIComponent(query)}`}
                      className="btn btn-outline"
                      style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
                    >
                      Sayfayı Görüntüle →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
