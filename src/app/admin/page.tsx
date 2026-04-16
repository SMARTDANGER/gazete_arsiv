'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

type Source = { 
  id: number; name: string; base_url: string; index_url: string; 
  pdf_link_selector: string; date_label_selector: string; notes: string;
};

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState(1);
  const [sources, setSources] = useState<Source[]>([]);
  
  // Tab 1 state
  const [formData, setFormData] = useState<Partial<Source>>({});
  const [testResults, setTestResults] = useState<any[] | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Tab 2 & 3 state
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [issues, setIssues] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalIssues, setTotalIssues] = useState(0);
  const ISSUES_PER_PAGE = 100;
  
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeResult, setScrapeResult] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  
  const [batchLimit, setBatchLimit] = useState(10);
  const [manualIssueId, setManualIssueId] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState('');

  // Progress state
  const [progress, setProgress] = useState<{ total: number; completed: number; pending: number; percent: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Batch progress (per toplu-run)
  const [batchProgress, setBatchProgress] = useState<{
    issuesTotal: number;
    issuesDone: number;
    currentLabel: string;
    pagesTotal: number;
    pagesDone: number;
    errors: number;
  } | null>(null);

  // Tab 4 state
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    loadSources();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (activeTab === 2 && selectedSourceId) {
      loadIssues(selectedSourceId, currentPage);
    }
    if (activeTab === 4) {
      loadStats();
    }
  }, [activeTab, selectedSourceId, currentPage]);

  const loadSources = async () => {
    try {
      const res = await fetch('/api/sources');
      const data = await res.json();
      if (Array.isArray(data)) {
        setSources(data);
        if (data.length > 0 && !selectedSourceId) {
          setSelectedSourceId(data[0].id.toString());
        }
      }
    } catch(e) {
      console.error("Failed to load sources", e);
    }
  };

  const loadIssues = async (id: string, page: number = 1) => {
    try {
      const res = await fetch(`/api/issues?source_id=${id}&page=${page}&limit=${ISSUES_PER_PAGE}`);
      const data = await res.json();
      setIssues(data.issues || []);
      setTotalIssues(data.totalCount || 0);
    } catch(e) {
      console.error("Failed to load issues", e);
    }
  };

  const loadStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data);
    } catch(e) {
      console.error("Failed to load stats", e);
    }
  };

  // ----- Tab 1 Actions -----
  const saveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isEdit = !!editingId;
      const url = isEdit ? `/api/sources/${editingId}` : '/api/sources';
      const method = isEdit ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (!res.ok) {
        const data = await res.json();
        alert(`Kayıt hatası: ${data.error || res.statusText}`);
      } else {
        setFormData({});
        setEditingId(null);
        loadSources();
      }
    } catch(e: any) {
      alert(`Kayıt hatası: ${e.message}`);
    }
  };

  const testScraper = async (id: number) => {
    setTestLoading(true); setTestResults(null);
    try {
      const res = await fetch(`/api/test-scrape?source_id=${id}`);
      const data = await res.json();
      if (data.error) alert(data.error);
      else setTestResults(data.results);
    } catch(e) { }
    setTestLoading(false);
  };

  // ----- Tab 2 Actions -----
  const runScrape = async () => {
    if (!selectedSourceId) return;
    setScrapeLoading(true); setScrapeResult('');
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: Number(selectedSourceId) })
      });
      const data = await res.json();
      if (data.error) setScrapeResult(`Hata: ${data.error}`);
      else {
        setScrapeResult(`${data.total_found} link bulundu, ${data.inserted} yeni sayı eklendi.`);
        loadIssues(selectedSourceId);
      }
    } catch(e: any) { setScrapeResult(`Hata: ${e.message}`); }
    setScrapeLoading(false);
  };

  const deleteIssues = async (mode: 'all' | 'processed') => {
    if (!selectedSourceId) return;
    const msg = mode === 'all'
      ? 'Bu kaynağa ait TÜM sayılar silinecek. Emin misiniz?'
      : 'Bu kaynağa ait İŞLENMİŞ tüm sayılar silinecek. Emin misiniz?';
    if (!confirm(msg)) return;
    setDeleteLoading(true);
    try {
      const res = await fetch('/api/issues', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: Number(selectedSourceId), mode })
      });
      const data = await res.json();
      if (data.error) setScrapeResult(`Hata: ${data.error}`);
      else setScrapeResult(`${data.deleted} sayı silindi.`);
      await loadIssues(selectedSourceId, 1);
      setCurrentPage(1);
    } catch (e: any) {
      setScrapeResult(`Hata: ${e.message}`);
    }
    setDeleteLoading(false);
  };

  // ----- Progress Polling -----
  const fetchProgress = useCallback(async () => {
    if (!selectedSourceId) return;
    try {
      const res = await fetch(`/api/progress?source_id=${selectedSourceId}`);
      const data = await res.json();
      if (!data.error) {
        setProgress(data);
        if (data.pending === 0 && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch (e) {
      console.error('Progress poll error', e);
    }
  }, [selectedSourceId]);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    fetchProgress();
    pollRef.current = setInterval(fetchProgress, 5000);
  }, [fetchProgress]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Load progress when Tab 3 is active
  useEffect(() => {
    if (activeTab === 3 && selectedSourceId) {
      fetchProgress();
    }
    if (activeTab !== 3) {
      stopPolling();
    }
  }, [activeTab, selectedSourceId, fetchProgress, stopPolling]);

  // ----- Tab 3 Actions -----
  const processIssuePages = async (
    issueId: number,
    label?: string,
    onPage?: (cur: number, total: number) => void
  ) => {
    const prep = await fetch('/api/process-issue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue_id: issueId })
    });
    const prepData = await prep.json();
    if (prepData.error) throw new Error(prepData.error);
    const pageCount: number = prepData.page_count;
    const tag = label ? `${label} (ID ${issueId})` : `Issue ${issueId}`;
    onPage?.(0, pageCount);

    for (let page = 1; page <= pageCount; page++) {
      setOcrResult(`${tag}: sayfa ${page}/${pageCount} işleniyor...`);
      const res = await fetch('/api/process-page', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue_id: issueId, page_number: page })
      });
      const data = await res.json();
      if (data.error) throw new Error(`sayfa ${page}: ${data.error}`);
      onPage?.(page, pageCount);
      fetchProgress();
    }
    return pageCount;
  };

  const runBatchOcr = async () => {
    if (!selectedSourceId) return;
    setOcrLoading(true); setOcrResult('');
    setBatchProgress(null);
    startPolling();
    try {
      const res = await fetch('/api/process-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: Number(selectedSourceId), limit: batchLimit })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const issues: { id: number; date_label: string }[] = data.issues || [];
      if (issues.length === 0) {
        setOcrResult('İşlenecek sayı bulunamadı.');
      } else {
        setBatchProgress({
          issuesTotal: issues.length,
          issuesDone: 0,
          currentLabel: '',
          pagesTotal: 0,
          pagesDone: 0,
          errors: 0,
        });
        let processed = 0;
        const errors: string[] = [];
        for (const issue of issues) {
          setBatchProgress(p => p && {
            ...p,
            currentLabel: issue.date_label || `Issue ${issue.id}`,
            pagesTotal: 0,
            pagesDone: 0,
          });
          try {
            await processIssuePages(issue.id, issue.date_label, (cur, total) => {
              setBatchProgress(p => p && { ...p, pagesDone: cur, pagesTotal: total });
            });
            processed++;
            setBatchProgress(p => p && { ...p, issuesDone: p.issuesDone + 1 });
          } catch (e: any) {
            errors.push(`Issue ${issue.id}: ${e.message}`);
            setBatchProgress(p => p && {
              ...p,
              issuesDone: p.issuesDone + 1,
              errors: p.errors + 1,
            });
          }
        }
        setOcrResult(`${processed}/${issues.length} sayı tamamlandı. Hata: ${errors.length}${errors.length ? '\n' + errors.join('\n') : ''}`);
      }
    } catch(e: any) { setOcrResult(`Hata: ${e.message}`); }
    setOcrLoading(false);
    fetchProgress();
  };

  const resetOcr = async () => {
    if (!selectedSourceId) return;
    if (!confirm('Bu kaynağa ait işlenmiş (OCR yapılmış) tüm sayfalar silinecek ve verileri sıfırlanacaktır. Tekrar OCR yapılması gerekecek. Emin misiniz?')) return;
    setOcrLoading(true); setOcrResult('');
    try {
      const res = await fetch('/api/issues', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: Number(selectedSourceId), mode: 'reset_ocr' })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOcrResult(`${data.reset} sayının OCR verisi sıfırlandı.`);
      fetchProgress();
    } catch(e: any) { setOcrResult(`Hata: ${e.message}`); }
    setOcrLoading(false);
  };

  const runManualOcr = async () => {
    if (!manualIssueId) return;
    setOcrLoading(true); setOcrResult('');
    try {
      const pages = await processIssuePages(Number(manualIssueId));
      setOcrResult(`İşlem tamamlandı. ${pages} sayfa eklendi.`);
    } catch(e: any) { setOcrResult(`Hata: ${e.message}`); }
    setOcrLoading(false);
    fetchProgress();
  };

  return (
    <div className="container">
      <header className="header" style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Admin Paneli</h2>
        <Link href="/" className="btn btn-outline" style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
          ← Ana Sayfa
        </Link>
      </header>

      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {['Kaynaklar', 'Scrape', 'OCR İşle', 'İstatistik'].map((tab, idx) => (
          <button 
            key={tab} 
            className={`btn ${activeTab === idx + 1 ? '' : 'btn-outline'}`}
            onClick={() => setActiveTab(idx + 1)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 1 && (
        <div>
          <div className="card mb-8">
            <h3>{editingId ? 'Kaynağı Düzenle' : 'Yeni Kaynak Ekle'}</h3>
            <form onSubmit={saveSource} className="grid grid-cols-2 mt-4" style={{ gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>Gazete Adı:</label>
                <input required value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>Ana URL (base_url):</label>
                <input required value={formData.base_url || ''} onChange={e => setFormData({...formData, base_url: e.target.value})} placeholder="https://nek.istanbul.edu.tr" />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>Index Sayfası URL (index_url):</label>
                <input required value={formData.index_url || ''} onChange={e => setFormData({...formData, index_url: e.target.value})} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>PDF Link Selector:</label>
                <input required value={formData.pdf_link_selector || ''} onChange={e => setFormData({...formData, pdf_link_selector: e.target.value})} placeholder="table td a[href$='.pdf']" />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>Tarih Selector (opsiyonel):</label>
                <input value={formData.date_label_selector || ''} onChange={e => setFormData({...formData, date_label_selector: e.target.value})} placeholder="Boş bırakılırsa link metni kullanılır" />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>Notlar:</label>
                <textarea 
                  value={formData.notes || ''} 
                  onChange={e => setFormData({...formData, notes: e.target.value})} 
                  rows={2}
                  placeholder="Bu kaynak hakkında notlar..."
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem' }}>
                <button type="submit">{editingId ? 'Güncelle' : 'Ekle'}</button>
                {editingId && <button type="button" className="btn-outline" onClick={() => {setEditingId(null); setFormData({});}}>İptal</button>}
              </div>
            </form>
          </div>

          <div className="card">
            <h3>Mevcut Kaynaklar</h3>
            {sources.length === 0 ? (
              <p style={{ color: '#94a3b8', marginTop: '1rem' }}>Henüz kaynak eklenmemiş.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>ID</th><th>Adı</th><th>Index / Selectors</th><th>İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map(s => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td>{s.name}<br/><small style={{color:'#64748b'}}>{s.base_url}</small></td>
                      <td style={{fontSize:'0.85rem'}}>
                        <strong>URL:</strong> {s.index_url.length > 40 ? s.index_url.substring(0,40) + '...' : s.index_url}<br/>
                        <strong>PDF:</strong> {s.pdf_link_selector}<br/>
                        <strong>Tarih:</strong> {s.date_label_selector || <em style={{color:'#64748b'}}>Yok (link metni)</em>}
                      </td>
                      <td>
                        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                          <button className="btn-outline" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }} onClick={() => {setEditingId(s.id); setFormData(s);}}>Düzenle</button>
                          <button className="btn-outline" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }} onClick={() => testScraper(s.id)} disabled={testLoading}>
                            {testLoading ? '...' : 'Selektörü Test Et'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {testResults && (
              <div className="mt-4" style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '1rem' }}>
                <h4 style={{ marginBottom: '0.5rem' }}>Test Sonucu (İlk 5):</h4>
                {testResults.length === 0 ? (
                  <p style={{ color: '#f87171' }}>Selektör ile hiçbir link bulunamadı. Selektörü kontrol edin.</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {testResults.map((r, i) => (
                      <li key={i} style={{ marginTop: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                        <strong style={{color:'var(--accent-color)'}}>{r.date_label}</strong><br/>
                        <span style={{color:'var(--primary-color)', fontSize: '0.85rem', wordBreak: 'break-all'}}>{r.pdf_url}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button className="btn-outline mt-4" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }} onClick={() => setTestResults(null)}>Kapat</button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 2 && (
        <div>
          <div className="card mb-8" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div className="flex gap-4 items-center">
              <label>Kaynak Seç:</label>
              <select value={selectedSourceId} onChange={e => { setSelectedSourceId(e.target.value); setCurrentPage(1); }} style={{width:'300px'}}>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button onClick={runScrape} disabled={scrapeLoading || !selectedSourceId}>
              {scrapeLoading ? 'Çekiliyor...' : 'Linkleri Çek'}
            </button>
          </div>

          {scrapeResult && <div className="card mb-8 snippet-preview">{scrapeResult}</div>}

          <div className="card mb-8" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => deleteIssues('all')}
              disabled={deleteLoading || !selectedSourceId}
              style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}
            >
              {deleteLoading ? '...' : 'Tüm Sayıları Sil'}
            </button>
            <button
              onClick={() => deleteIssues('processed')}
              disabled={deleteLoading || !selectedSourceId}
              style={{ background: '#ea580c', borderColor: '#ea580c', color: '#fff' }}
            >
              {deleteLoading ? '...' : 'İşlenmişleri Sil'}
            </button>
          </div>

          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h3>Son Eklenen Sayılar (Sayfa {currentPage})</h3>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Toplam: {totalIssues}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>ID</th><th>Tarih / Etiket</th><th>PDF Link</th><th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {issues.map(i => (
                  <tr key={i.id}>
                    <td>{i.id}</td>
                    <td>{i.date_label}</td>
                    <td style={{fontSize:'0.85rem', color: 'var(--primary-color)', wordBreak: 'break-all'}}>{i.pdf_url}</td>
                    <td>
                      {parseInt(i.pages_count) > 0 ? 
                        <strong style={{color: '#4ade80'}}>İşlendi ({i.pages_count} sayfa)</strong> : 
                        <span style={{color: '#f87171'}}>Bekliyor</span>
                      }
                    </td>
                  </tr>
                ))}
                {issues.length === 0 && <tr><td colSpan={4} style={{color:'#94a3b8'}}>Kayıt bulunamadı. Önce &quot;Linkleri Çek&quot; ile sayıları ekleyin.</td></tr>}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {totalIssues > ISSUES_PER_PAGE && (
              <div className="mt-8 flex justify-center items-center gap-2 flex-wrap">
                <button 
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="btn btn-outline"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                >
                  Önceki
                </button>

                {(() => {
                  const pages = [];
                  const totalPages = Math.ceil(totalIssues / ISSUES_PER_PAGE);
                  
                  // Google-like pagination logic
                  let start = Math.max(1, currentPage - 2);
                  let end = Math.min(totalPages, start + 4);
                  if (end === totalPages) start = Math.max(1, end - 4);

                  if (start > 1) {
                    pages.push(<button key={1} onClick={() => setCurrentPage(1)} className="btn btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>1</button>);
                    if (start > 2) pages.push(<span key="dots1" style={{ color: '#94a3b8' }}>...</span>);
                  }

                  for (let i = start; i <= end; i++) {
                    pages.push(
                      <button 
                        key={i} 
                        onClick={() => setCurrentPage(i)}
                        className={currentPage === i ? "btn" : "btn btn-outline"}
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', minWidth: '35px' }}
                      >
                        {i}
                      </button>
                    );
                  }

                  if (end < totalPages) {
                    if (end < totalPages - 1) pages.push(<span key="dots2" style={{ color: '#94a3b8' }}>...</span>);
                    pages.push(<button key={totalPages} onClick={() => setCurrentPage(totalPages)} className="btn btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>{totalPages}</button>);
                  }

                  return pages;
                })()}

                <button 
                  disabled={currentPage === Math.ceil(totalIssues / ISSUES_PER_PAGE)}
                  onClick={() => setCurrentPage(p => p + 1)}
                  className="btn btn-outline"
                  style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                >
                  Sonraki
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 3 && (
        <div>
          {/* Progress Bar */}
          {progress && progress.total > 0 && (
            <div className="card mb-8">
              <div className="flex justify-between items-center mb-4">
                <h3>OCR İlerleme Durumu</h3>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  {progress.completed} / {progress.total} tamamlandı (%{progress.percent})
                </span>
              </div>
              {/* Progress bar track */}
              <div style={{
                width: '100%',
                height: '28px',
                background: 'rgba(0,0,0,0.4)',
                borderRadius: '14px',
                overflow: 'hidden',
                border: '1px solid var(--border-color)',
                position: 'relative'
              }}>
                {/* Progress bar fill */}
                <div style={{
                  width: `${progress.percent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #22c55e, #4ade80)',
                  borderRadius: '14px',
                  transition: 'width 0.5s ease-in-out',
                  boxShadow: '0 0 12px rgba(74, 222, 128, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: progress.percent > 3 ? 'auto' : '0'
                }}>
                  {progress.percent > 8 && (
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
                      %{progress.percent}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex justify-between mt-4" style={{ fontSize: '0.85rem' }}>
                <span style={{ color: '#f87171' }}>Bekliyor: {progress.pending}</span>
                <span style={{ color: '#4ade80' }}>Tamamlandı: {progress.completed}</span>
                <span style={{ color: '#94a3b8' }}>Toplam: {progress.total}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2">
            <div className="card">
              <h3>Toplu OCR İşlemi</h3>
              <p className="mt-4 mb-4" style={{color: '#94a3b8', fontSize: '0.9rem'}}>
                Seçili kaynak için &apos;Bekliyor&apos; durumundaki sayıları sırayla indirip OCR işleminden geçirir.
              </p>
              <div className="flex gap-4 items-center mb-4">
                <select value={selectedSourceId} onChange={e => setSelectedSourceId(e.target.value)}>
                  {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="flex gap-4 items-center mb-4">
                <label>Limit (Kaç Sayı):</label>
                <input type="number" min={1} max={100} value={batchLimit} onChange={e => setBatchLimit(parseInt(e.target.value) || 10)} style={{width:'100px'}} />
              </div>
              <button onClick={runBatchOcr} disabled={ocrLoading || !selectedSourceId} style={{width:'100%'}}>
                {ocrLoading ? 'İşleniyor...' : 'Toplu İşle'}
              </button>

              {batchProgress && (() => {
                const { issuesTotal, issuesDone, currentLabel, pagesTotal, pagesDone, errors } = batchProgress;
                const pageFrac = pagesTotal > 0 ? pagesDone / pagesTotal : 0;
                const overall = issuesTotal > 0
                  ? Math.min(1, (issuesDone + pageFrac) / issuesTotal)
                  : 0;
                const pct = Math.round(overall * 100);
                const done = issuesDone >= issuesTotal;
                return (
                  <div className="mt-4" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                    <div className="flex justify-between items-center mb-2" style={{ fontSize: '0.85rem' }}>
                      <span style={{ color: '#94a3b8' }}>
                        Sayı {Math.min(issuesDone + (done ? 0 : 1), issuesTotal)}/{issuesTotal}
                        {!done && pagesTotal > 0 && ` — sayfa ${pagesDone}/${pagesTotal}`}
                      </span>
                      <span style={{ color: '#94a3b8' }}>%{pct}</span>
                    </div>
                    <div style={{
                      width: '100%',
                      height: '22px',
                      background: 'rgba(0,0,0,0.4)',
                      borderRadius: '11px',
                      overflow: 'hidden',
                      border: '1px solid var(--border-color)',
                    }}>
                      <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: errors > 0
                          ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                          : 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                        borderRadius: '11px',
                        transition: 'width 0.4s ease-in-out',
                        boxShadow: '0 0 10px rgba(139, 92, 246, 0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        {pct > 8 && (
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#fff' }}>%{pct}</span>
                        )}
                      </div>
                    </div>
                    {currentLabel && !done && (
                      <div className="mt-2" style={{ fontSize: '0.78rem', color: '#64748b', wordBreak: 'break-word' }}>
                        İşleniyor: {currentLabel}
                      </div>
                    )}
                    {done && (
                      <div className="mt-2" style={{ fontSize: '0.8rem', color: errors > 0 ? '#fbbf24' : '#4ade80' }}>
                        ✓ Tamamlandı — {issuesDone - errors}/{issuesTotal} başarılı
                        {errors > 0 && `, ${errors} hata`}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="card">
              <h3>Manuel Sayı İşle</h3>
              <p className="mt-4 mb-4" style={{color: '#94a3b8', fontSize: '0.9rem'}}>
                Belirli bir ID&apos;ye sahip sayıyı zorla OCR işlemine sokar.
              </p>
              <div className="flex gap-4 items-center mb-4">
                <label>Sayı (Issue) ID:</label>
                <input type="number" min={1} value={manualIssueId} onChange={e => setManualIssueId(e.target.value)} />
              </div>
              <button onClick={runManualOcr} disabled={ocrLoading || !manualIssueId} className="btn-outline" style={{width:'100%'}}>
                {ocrLoading ? 'İşleniyor...' : 'Tekil İşle'}
              </button>
            </div>

            <div className="card mt-4" style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ color: '#ea580c' }}>İşlenmişleri Sıfırla</h3>
                  <p className="mt-2" style={{color: '#94a3b8', fontSize: '0.9rem', maxWidth: '600px'}}>
                    Bu butona basarsanız, seçili kaynağa ait daha önce işlenmiş (OCR yapılmış) tüm arka plan metin verileri ve resim bilgileri silinecektir. Silinen verilerin yeniden oluşturulması için o sayıların OCR taramasından tekrar geçmesi gerekecektir. Gazete linkleri veritabanında kalmaya devam eder, bu işlem sadece işlenmiş verileri hedefler.
                  </p>
                </div>
                <button
                  onClick={resetOcr}
                  disabled={ocrLoading || !selectedSourceId}
                  style={{ background: '#ea580c', borderColor: '#ea580c', color: '#fff', padding: '0.8rem 1.6rem' }}
                >
                  {ocrLoading ? 'Sıfırlanıyor...' : 'Seçili Kaynağın OCR Verilerini Sıfırla'}
                </button>
              </div>
            </div>

            {ocrResult && (
               <div className="card mt-4" style={{ gridColumn: 'span 2' }}>
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{ocrResult}</pre>
               </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 4 && (
        <div>
          {!stats ? (
            <div className="spinner"></div>
          ) : (
            <>
              <div className="grid grid-cols-4 mb-8">
                <div className="card" style={{ textAlign: 'center' }}>
                  <h4 style={{color:'#94a3b8'}}>Toplam Kaynak</h4>
                  <p style={{fontSize:'2.5rem', fontWeight:'700', color:'var(--primary-color)'}}>{stats.totals.total_sources}</p>
                </div>
                <div className="card" style={{ textAlign: 'center' }}>
                  <h4 style={{color:'#94a3b8'}}>Toplam Sayı (Issue)</h4>
                  <p style={{fontSize:'2.5rem', fontWeight:'700', color:'var(--primary-color)'}}>{stats.totals.total_issues}</p>
                </div>
                <div className="card" style={{ textAlign: 'center' }}>
                  <h4 style={{color:'#94a3b8'}}>Toplam Sayfa</h4>
                  <p style={{fontSize:'2.5rem', fontWeight:'700', color:'var(--primary-color)'}}>{stats.totals.total_pages}</p>
                </div>
                <div className="card" style={{ textAlign: 'center' }}>
                  <h4 style={{color:'#94a3b8'}}>İşlenmiş Sayfa (OCR)</h4>
                  <p style={{fontSize:'2.5rem', fontWeight:'700', color:'#4ade80'}}>{stats.totals.total_processed_pages}</p>
                </div>
              </div>

              <div className="card">
                <h3>Kaynak Bazlı Kırılım</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Kaynak Adı</th><th>Sayı (Issue) Adedi</th><th>Sayfa (Page) Adedi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.breakdown.map((b:any, i:number) => (
                      <tr key={i}>
                        <td>{b.name}</td>
                        <td>{b.issue_count}</td>
                        <td>{b.page_count}</td>
                      </tr>
                    ))}
                    {stats.breakdown.length === 0 && <tr><td colSpan={3} style={{color:'#94a3b8'}}>Henüz kaynak yok.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}
