'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';

type Source = {
  id: number; name: string; base_url: string; index_url: string;
  pdf_link_selector: string; date_label_selector: string; notes: string;
};

type Issue = {
  id: number; date_label: string; pdf_url: string;
  pages_count?: string | number; page_count?: number;
  ocr_dpi?: number; status?: string;
};

const TR_MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, şubat: 2, mart: 3, nisan: 4, mayis: 5, mayıs: 5,
  haziran: 6, temmuz: 7, agustos: 8, ağustos: 8, eylul: 9, eylül: 9,
  ekim: 10, kasim: 11, kasım: 11, aralik: 12, aralık: 12,
  // Ottoman / old Turkish
  kanunuevvel: 12, kânunuevvel: 12, 'kanun-i evvel': 12, 'kânun-ı evvel': 12, 'birinci kanun': 12, 'birincikanun': 12,
  kanunusani: 1, kânunusani: 1, 'kanun-i sani': 1, 'kânun-ı sani': 1, 'ikinci kanun': 1, 'ikincikanun': 1,
  tesrinievvel: 10, teşrinievvel: 10, 'tesrin-i evvel': 10, 'teşrin-i evvel': 10, 'birinci tesrin': 10, 'birinciteşrin': 10,
  tesrinisani: 11, teşrinisani: 11, 'tesrin-i sani': 11, 'teşrin-i sani': 11, 'ikinci tesrin': 11, 'ikinciteşrin': 11,
};

const MONTH_NAME: Record<number, string> = {
  1: 'Ocak', 2: 'Şubat', 3: 'Mart', 4: 'Nisan', 5: 'Mayıs', 6: 'Haziran',
  7: 'Temmuz', 8: 'Ağustos', 9: 'Eylül', 10: 'Ekim', 11: 'Kasım', 12: 'Aralık',
};

function normalize(s: string) {
  return s.toLocaleLowerCase('tr-TR')
    .replace(/â/g, 'a').replace(/û/g, 'u').replace(/î/g, 'i')
    .replace(/[_/\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateLabel(label: string): { year: number | null; month: number | null } {
  if (!label) return { year: null, month: null };
  const n = normalize(label);
  const ym = n.match(/\b(1[6-9]\d{2}|20\d{2})\b/);
  const year = ym ? parseInt(ym[1], 10) : null;
  let month: number | null = null;
  const sorted = Object.keys(TR_MONTHS).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (n.includes(key)) { month = TR_MONTHS[key]; break; }
  }
  return { year, month };
}

type YearGroup = { year: number | null; months: Map<number | null, Issue[]> };

function groupIssues(issues: Issue[]): YearGroup[] {
  const byYear = new Map<number | null, Map<number | null, Issue[]>>();
  for (const iss of issues) {
    const { year, month } = parseDateLabel(iss.date_label);
    if (!byYear.has(year)) byYear.set(year, new Map());
    const mmap = byYear.get(year)!;
    if (!mmap.has(month)) mmap.set(month, []);
    mmap.get(month)!.push(iss);
  }
  const yearKeys = Array.from(byYear.keys()).sort((a, b) => {
    if (a === null) return 1; if (b === null) return -1; return a - b;
  });
  return yearKeys.map(y => {
    const mmap = byYear.get(y)!;
    const monthKeys = Array.from(mmap.keys()).sort((a, b) => {
      if (a === null) return 1; if (b === null) return -1; return a - b;
    });
    const sortedMap = new Map<number | null, Issue[]>();
    for (const mk of monthKeys) sortedMap.set(mk, mmap.get(mk)!);
    return { year: y, months: sortedMap };
  });
}

function isProcessed(i: Issue) { return parseInt(String(i.pages_count || 0)) > 0; }

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState(1);
  const [sources, setSources] = useState<Source[]>([]);

  const [formData, setFormData] = useState<Partial<Source>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testResults, setTestResults] = useState<any[] | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);

  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeResult, setScrapeResult] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [batchLimit, setBatchLimit] = useState(10);
  const [ocrDpi, setOcrDpi] = useState(150);
  const [manualIssueId, setManualIssueId] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState('');
  const [currentProcessingId, setCurrentProcessingId] = useState<number | null>(null);
  const [selectedProcessed, setSelectedProcessed] = useState<Set<number>>(new Set());
  const [procFilter, setProcFilter] = useState('');

  const [progress, setProgress] = useState<{ total: number; completed: number; pending: number; percent: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [batchProgress, setBatchProgress] = useState<{
    issuesTotal: number; issuesDone: number; currentLabel: string;
    pagesTotal: number; pagesDone: number; errors: number;
  } | null>(null);

  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    loadSources();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if ((activeTab === 2 || activeTab === 3) && selectedSourceId) {
      loadAllIssues(selectedSourceId);
    }
    if (activeTab === 4) loadStats();
  }, [activeTab, selectedSourceId]);

  const loadSources = async () => {
    try {
      const res = await fetch('/api/sources');
      const data = await res.json();
      if (Array.isArray(data)) {
        setSources(data);
        if (data.length > 0 && !selectedSourceId) setSelectedSourceId(data[0].id.toString());
      }
    } catch (e) { console.error(e); }
  };

  const loadAllIssues = async (id: string) => {
    setLoadingIssues(true);
    try {
      const res = await fetch(`/api/issues?source_id=${id}&page=1&limit=10000`);
      const data = await res.json();
      setIssues(data.issues || []);
    } catch (e) { console.error(e); }
    setLoadingIssues(false);
  };

  const loadStats = async () => {
    try {
      const res = await fetch('/api/stats');
      setStats(await res.json());
    } catch (e) { console.error(e); }
  };

  // ----- Source form -----
  const saveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: Partial<Source> = { ...formData };
      if (!payload.base_url && payload.index_url) {
        try { payload.base_url = new URL(payload.index_url).origin; } catch {}
      }
      if (!payload.pdf_link_selector) payload.pdf_link_selector = "a[href$='.pdf']";
      if (!payload.date_label_selector) payload.date_label_selector = '';
      if (!payload.notes) payload.notes = '';

      const isEdit = !!editingId;
      const url = isEdit ? `/api/sources/${editingId}` : '/api/sources';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(`Kayıt hatası: ${data.error || res.statusText}`);
      } else {
        setFormData({}); setEditingId(null); setShowAdvanced(false);
        loadSources();
      }
    } catch (e: any) { alert(`Kayıt hatası: ${e.message}`); }
  };

  const deleteSource = async (id: number, name: string) => {
    if (!confirm(`"${name}" kaynağı ve TÜM sayılar/sayfalar silinecek. Emin misiniz?`)) return;
    if (!confirm('Son onay: GERİ ALINAMAZ. Devam?')) return;
    try {
      const res = await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { alert(`Silme hatası: ${data.error || res.statusText}`); return; }
      if (editingId === id) { setEditingId(null); setFormData({}); }
      if (selectedSourceId === String(id)) setSelectedSourceId('');
      await loadSources();
    } catch (e: any) { alert(`Silme hatası: ${e.message}`); }
  };

  const testScraper = async (id: number) => {
    setTestLoading(true); setTestResults(null);
    try {
      const res = await fetch(`/api/test-scrape?source_id=${id}`);
      const data = await res.json();
      if (data.error) alert(data.error);
      else setTestResults(data.results);
    } catch (e) {}
    setTestLoading(false);
  };

  // ----- Scrape -----
  const runScrape = async () => {
    if (!selectedSourceId) return;
    setScrapeLoading(true); setScrapeResult('');
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: Number(selectedSourceId) }),
      });
      const data = await res.json();
      if (data.error) setScrapeResult(`Hata: ${data.error}`);
      else {
        setScrapeResult(`${data.total_found} link bulundu, ${data.inserted} yeni sayı eklendi.`);
        loadAllIssues(selectedSourceId);
      }
    } catch (e: any) { setScrapeResult(`Hata: ${e.message}`); }
    setScrapeLoading(false);
  };

  const deleteIssues = async (mode: 'all' | 'processed') => {
    if (!selectedSourceId) return;
    const msg = mode === 'all' ? 'TÜM sayılar silinecek. Emin misiniz?' : 'İŞLENMİŞ tüm sayılar silinecek. Emin misiniz?';
    if (!confirm(msg)) return;
    setDeleteLoading(true);
    try {
      const res = await fetch('/api/issues', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: Number(selectedSourceId), mode }),
      });
      const data = await res.json();
      if (data.error) setScrapeResult(`Hata: ${data.error}`);
      else setScrapeResult(`${data.deleted} sayı silindi.`);
      await loadAllIssues(selectedSourceId);
    } catch (e: any) { setScrapeResult(`Hata: ${e.message}`); }
    setDeleteLoading(false);
  };

  // ----- Progress -----
  const fetchProgress = useCallback(async () => {
    if (!selectedSourceId) return;
    try {
      const res = await fetch(`/api/progress?source_id=${selectedSourceId}`);
      const data = await res.json();
      if (!data.error) {
        setProgress(data);
        if (data.pending === 0 && pollRef.current) {
          clearInterval(pollRef.current); pollRef.current = null;
        }
      }
    } catch (e) { console.error(e); }
  }, [selectedSourceId]);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    fetchProgress();
    pollRef.current = setInterval(fetchProgress, 5000);
  }, [fetchProgress]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    if (activeTab === 3 && selectedSourceId) fetchProgress();
    if (activeTab !== 3) stopPolling();
  }, [activeTab, selectedSourceId, fetchProgress, stopPolling]);

  // ----- OCR -----
  const processIssuePages = async (
    issueId: number, label?: string,
    onPage?: (cur: number, total: number) => void
  ) => {
    setCurrentProcessingId(issueId);
    const prep = await fetch('/api/process-issue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue_id: issueId }),
    });
    const prepData = await prep.json();
    if (prepData.error) { setCurrentProcessingId(null); throw new Error(prepData.error); }
    const pageCount: number = prepData.page_count;
    const tag = label ? `${label} (ID ${issueId})` : `Issue ${issueId}`;
    onPage?.(0, pageCount);

    const CONCURRENCY = ocrDpi >= 200 ? 1 : ocrDpi >= 150 ? 2 : 3;
    let nextPage = 1; let done = 0;
    const errors: string[] = [];

    const worker = async () => {
      while (true) {
        const page = nextPage++;
        if (page > pageCount) return;
        setOcrResult(`${tag}: sayfa ${page}/${pageCount} işleniyor...`);
        try {
          const res = await fetch('/api/process-page', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ issue_id: issueId, page_number: page, dpi: ocrDpi }),
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
        } catch (e: any) { errors.push(`sayfa ${page}: ${e.message}`); }
        done++;
        onPage?.(done, pageCount);
        fetchProgress();
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pageCount) }, worker));
    setCurrentProcessingId(null);
    if (errors.length) throw new Error(errors.join('; '));
    return pageCount;
  };

  const runBatchOcr = async () => {
    if (!selectedSourceId) return;
    setOcrLoading(true); setOcrResult('');
    setBatchProgress({ issuesTotal: batchLimit, issuesDone: 0, currentLabel: 'Sıralama hazırlanıyor...', pagesTotal: 0, pagesDone: 0, errors: 0 });
    startPolling();
    try {
      const res = await fetch('/api/process-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: Number(selectedSourceId), limit: batchLimit }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const issueList: { id: number; date_label: string }[] = data.issues || [];
      if (issueList.length === 0) setOcrResult('İşlenecek sayı bulunamadı.');
      else {
        setBatchProgress({ issuesTotal: issueList.length, issuesDone: 0, currentLabel: '', pagesTotal: 0, pagesDone: 0, errors: 0 });
        let processed = 0;
        const errors: string[] = [];
        for (const iss of issueList) {
          setBatchProgress(p => p && { ...p, currentLabel: iss.date_label || `Issue ${iss.id}`, pagesTotal: 0, pagesDone: 0 });
          try {
            await processIssuePages(iss.id, iss.date_label, (cur, total) => {
              setBatchProgress(p => p && { ...p, pagesDone: cur, pagesTotal: total });
            });
            processed++;
            setBatchProgress(p => p && { ...p, issuesDone: p.issuesDone + 1 });
          } catch (e: any) {
            errors.push(`Issue ${iss.id}: ${e.message}`);
            setBatchProgress(p => p && { ...p, issuesDone: p.issuesDone + 1, errors: p.errors + 1 });
          }
        }
        setOcrResult(`${processed}/${issueList.length} sayı tamamlandı. Hata: ${errors.length}${errors.length ? '\n' + errors.join('\n') : ''}`);
      }
    } catch (e: any) { setOcrResult(`Hata: ${e.message}`); }
    setOcrLoading(false);
    fetchProgress();
    if (selectedSourceId) loadAllIssues(selectedSourceId);
  };

  const deleteSingleIssue = async (issueId: number, label: string, mode: 'single' | 'reset_single') => {
    const msg = mode === 'single'
      ? `"${label}" (ID ${issueId}) silinecek. Emin misiniz?`
      : `"${label}" (ID ${issueId}) OCR verisi silinip Bekliyor yapılacak. Emin misiniz?`;
    if (!confirm(msg)) return;
    try {
      const res = await fetch('/api/issues', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue_id: issueId, mode }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`Hata: ${data.error || res.statusText}`); return; }
      if (selectedSourceId) await loadAllIssues(selectedSourceId);
      fetchProgress();
    } catch (e: any) { alert(`Hata: ${e.message}`); }
  };

  const bulkDeleteProcessed = async (mode: 'single' | 'reset_single') => {
    if (selectedProcessed.size === 0) return;
    const msg = mode === 'single'
      ? `Seçili ${selectedProcessed.size} sayı tamamen silinecek. Emin misiniz?`
      : `Seçili ${selectedProcessed.size} sayının OCR verisi sıfırlanacak. Emin misiniz?`;
    if (!confirm(msg)) return;
    for (const id of Array.from(selectedProcessed)) {
      try {
        await fetch('/api/issues', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issue_id: id, mode }),
        });
      } catch (e) {}
    }
    setSelectedProcessed(new Set());
    if (selectedSourceId) await loadAllIssues(selectedSourceId);
    fetchProgress();
  };

  const resetOcr = async () => {
    if (!selectedSourceId) return;
    if (!confirm('Seçili kaynağın tüm OCR verileri silinecek. Emin misiniz?')) return;
    setOcrLoading(true); setOcrResult('');
    try {
      const res = await fetch('/api/issues', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: Number(selectedSourceId), mode: 'reset_ocr' }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOcrResult(`${data.reset} sayının OCR verisi sıfırlandı.`);
      fetchProgress();
      if (selectedSourceId) loadAllIssues(selectedSourceId);
    } catch (e: any) { setOcrResult(`Hata: ${e.message}`); }
    setOcrLoading(false);
  };

  const runManualOcr = async () => {
    if (!manualIssueId) return;
    setOcrLoading(true); setOcrResult('');
    try {
      const pages = await processIssuePages(Number(manualIssueId));
      setOcrResult(`İşlem tamamlandı. ${pages} sayfa eklendi.`);
    } catch (e: any) { setOcrResult(`Hata: ${e.message}`); }
    setOcrLoading(false);
    fetchProgress();
    if (selectedSourceId) loadAllIssues(selectedSourceId);
  };

  // ----- Derived -----
  const grouped = useMemo(() => groupIssues(issues), [issues]);
  const processedList = useMemo(() => {
    const f = procFilter.trim().toLocaleLowerCase('tr-TR');
    return issues.filter(isProcessed).filter(i => !f || (i.date_label || '').toLocaleLowerCase('tr-TR').includes(f) || String(i.id).includes(f));
  }, [issues, procFilter]);
  const totalIssues = issues.length;
  const processedCount = issues.filter(isProcessed).length;

  const toggleSelected = (id: number) => {
    setSelectedProcessed(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const toggleAllProcessed = () => {
    setSelectedProcessed(s => s.size === processedList.length ? new Set() : new Set(processedList.map(i => i.id)));
  };

  return (
    <div className="container">
      <header className="header" style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h2>Admin Paneli</h2>
        <Link href="/" className="btn btn-outline" style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>← Ana Sayfa</Link>
      </header>

      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {['Kaynaklar', 'Scrape', 'OCR İşle', 'İstatistik'].map((tab, idx) => (
          <button key={tab} className={`btn ${activeTab === idx + 1 ? '' : 'btn-outline'}`} onClick={() => setActiveTab(idx + 1)}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 1 && (
        <div>
          <div className="card mb-8">
            <h3>{editingId ? 'Kaynağı Düzenle' : 'Yeni Kaynak Ekle'}</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Sadece gazete adı ve PDF index sayfası URL&apos;si ver. Tüm PDF&apos;ler otomatik bulunur.
            </p>
            <form onSubmit={saveSource} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>Gazete Adı:</label>
                <input required value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Cumhuriyet" />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>Index Sayfası URL:</label>
                <input required value={formData.index_url || ''} onChange={e => setFormData({ ...formData, index_url: e.target.value })} placeholder="https://nek.istanbul.edu.tr/ekos/GAZETE/gazete.php?gazete=cumhuriyet" />
              </div>

              <label className="simple-switch">
                <input type="checkbox" checked={showAdvanced} onChange={e => setShowAdvanced(e.target.checked)} style={{ width: 'auto' }} />
                Gelişmiş ayarlar
              </label>

              {showAdvanced && (
                <div style={{ display: 'grid', gap: '1rem', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>Ana URL (base_url) — boş bırakılırsa index&apos;ten türetilir:</label>
                    <input value={formData.base_url || ''} onChange={e => setFormData({ ...formData, base_url: e.target.value })} placeholder="https://nek.istanbul.edu.tr" />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>PDF Link Selector (varsayılan: a[href$=&apos;.pdf&apos;]):</label>
                    <input value={formData.pdf_link_selector || ''} onChange={e => setFormData({ ...formData, pdf_link_selector: e.target.value })} placeholder="a[href$='.pdf']" />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>Tarih Selector (ops.):</label>
                    <input value={formData.date_label_selector || ''} onChange={e => setFormData({ ...formData, date_label_selector: e.target.value })} placeholder="Boş = link metni" />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: '#94a3b8' }}>Notlar:</label>
                    <textarea value={formData.notes || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={2} placeholder="Notlar..." style={{ resize: 'vertical' }} />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit">{editingId ? 'Güncelle' : 'Ekle'}</button>
                {editingId && <button type="button" className="btn-outline" onClick={() => { setEditingId(null); setFormData({}); setShowAdvanced(false); }}>İptal</button>}
              </div>
            </form>
          </div>

          <div className="card">
            <h3>Mevcut Kaynaklar</h3>
            {sources.length === 0 ? (
              <p style={{ color: '#94a3b8', marginTop: '1rem' }}>Henüz kaynak eklenmemiş.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
                {sources.map(s => (
                  <div key={s.id} className="proc-row" style={{ gridTemplateColumns: '1fr auto' }}>
                    <div>
                      <strong style={{ fontSize: '1rem' }}>{s.name}</strong>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', wordBreak: 'break-all', marginTop: '0.15rem' }}>{s.index_url}</div>
                    </div>
                    <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                      <button className="btn-outline" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }} onClick={() => { setEditingId(s.id); setFormData(s); setShowAdvanced(true); }}>Düzenle</button>
                      <button className="btn-outline" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }} onClick={() => testScraper(s.id)} disabled={testLoading}>
                        {testLoading ? '...' : 'Test'}
                      </button>
                      <button onClick={() => deleteSource(s.id, s.name)} style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}>Sil</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {testResults && (
              <div className="mt-4" style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '1rem' }}>
                <h4 style={{ marginBottom: '0.5rem' }}>Test (İlk 5):</h4>
                {testResults.length === 0 ? (
                  <p style={{ color: '#f87171' }}>Link bulunamadı. Selektörü kontrol et.</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {testResults.map((r, i) => (
                      <li key={i} style={{ marginTop: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                        <strong style={{ color: 'var(--accent-color)' }}>{r.date_label}</strong><br />
                        <span style={{ color: 'var(--primary-color)', fontSize: '0.85rem', wordBreak: 'break-all' }}>{r.pdf_url}</span>
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
              <label>Kaynak:</label>
              <select value={selectedSourceId} onChange={e => setSelectedSourceId(e.target.value)} style={{ width: '260px' }}>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button onClick={runScrape} disabled={scrapeLoading || !selectedSourceId}>
              {scrapeLoading ? 'Çekiliyor...' : 'Linkleri Çek'}
            </button>
          </div>

          {scrapeResult && <div className="card mb-8 snippet-preview">{scrapeResult}</div>}

          <div className="card mb-8" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button onClick={() => deleteIssues('all')} disabled={deleteLoading || !selectedSourceId} style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}>
              {deleteLoading ? '...' : 'Tüm Sayıları Sil'}
            </button>
            <button onClick={() => deleteIssues('processed')} disabled={deleteLoading || !selectedSourceId} style={{ background: '#ea580c', borderColor: '#ea580c', color: '#fff' }}>
              {deleteLoading ? '...' : 'İşlenmişleri Sil'}
            </button>
          </div>

          <div className="card">
            <div className="flex justify-between items-center mb-4" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3>Sayılar</h3>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                Toplam: {totalIssues} · İşlenmiş: <strong style={{ color: '#4ade80' }}>{processedCount}</strong>
              </span>
            </div>

            {loadingIssues ? <div className="spinner"></div> : grouped.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>Kayıt yok. &quot;Linkleri Çek&quot; ile başla.</p>
            ) : (
              <div>
                {grouped.map((yg, yi) => {
                  const totalInYear = Array.from(yg.months.values()).reduce((a, b) => a + b.length, 0);
                  return (
                    <details key={yi} className="year-group" open={grouped.length <= 3}>
                      <summary>
                        <span>
                          {yg.year ?? 'Bilinmiyor'}
                          <span className="count-badge">{totalInYear}</span>
                        </span>
                      </summary>
                      <div className="month-grid">
                        {Array.from(yg.months.entries()).map(([m, list], mi) => (
                          <div key={mi} className="month-box" style={{ animationDelay: `${mi * 0.03}s` }}>
                            <div className="month-box-title">
                              <span>{m ? MONTH_NAME[m] : 'Ay yok'}</span>
                              <span style={{ color: '#64748b' }}>{list.length}</span>
                            </div>
                            <ul className="issue-compact-list">
                              {list.map(i => (
                                <li key={i.id} className={`issue-compact-row ${isProcessed(i) ? 'done' : ''}`}>
                                  <span className="ic-date">{isProcessed(i) ? '✓' : '○'} {i.date_label}</span>
                                  <span className="ic-id">#{i.id}</span>
                                  <a href={i.pdf_url} target="_blank" rel="noopener noreferrer" className="ic-link">Tıklayınız</a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 3 && (
        <div>
          {progress && progress.total > 0 && (
            <div className="card mb-8">
              <div className="flex justify-between items-center mb-4">
                <h3>OCR İlerleme</h3>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{progress.completed} / {progress.total} (%{progress.percent})</span>
              </div>
              <div className="progress-fancy">
                <div className={`progress-fancy-fill ${progress.pending === 0 ? 'success' : ''}`} style={{ width: `${progress.percent}%` }}>
                  {progress.percent > 8 && <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>%{progress.percent}</span>}
                </div>
              </div>
              <div className="flex justify-between mt-4" style={{ fontSize: '0.85rem' }}>
                <span style={{ color: '#f87171' }}>Bekliyor: {progress.pending}</span>
                <span style={{ color: '#4ade80' }}>Tamamlandı: {progress.completed}</span>
                <span style={{ color: '#94a3b8' }}>Toplam: {progress.total}</span>
              </div>
            </div>
          )}

          {batchProgress && (
            <div className="card mb-8" style={{ borderColor: '#8b5cf6', animation: 'pulseGlow 3s ease-in-out infinite' }}>
              {(() => {
                const { issuesTotal, issuesDone, currentLabel, pagesTotal, pagesDone, errors } = batchProgress;
                const pageFrac = pagesTotal > 0 ? pagesDone / pagesTotal : 0;
                const overall = issuesTotal > 0 ? Math.min(1, (issuesDone + pageFrac) / issuesTotal) : 0;
                const pct = Math.round(overall * 100);
                const done = issuesDone >= issuesTotal;
                return (
                  <>
                    <div className="flex justify-between items-center mb-4">
                      <h3 style={{ color: '#a78bfa' }}>Toplu İşlem</h3>
                      <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                        Sayı {Math.min(issuesDone + (done ? 0 : 1), issuesTotal)}/{issuesTotal}
                        {!done && pagesTotal > 0 && ` · sayfa ${pagesDone}/${pagesTotal}`} (%{pct})
                      </span>
                    </div>
                    <div className="progress-fancy">
                      <div className={`progress-fancy-fill ${done && errors === 0 ? 'success' : ''}`} style={{ width: `${pct}%` }}>
                        {pct > 8 && <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>%{pct}</span>}
                      </div>
                    </div>
                    <div className="flex justify-between mt-4" style={{ fontSize: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ color: '#a78bfa' }}>
                        {done ? (errors > 0 ? '⚠️' : '✓') : '⏳'} {done ? `Tamamlandı — ${issuesDone - errors}/${issuesTotal} başarılı${errors > 0 ? `, ${errors} hata` : ''}` : currentLabel ? `İşleniyor: ${currentLabel}` : 'Başlıyor...'}
                      </span>
                      <button type="button" onClick={() => setBatchProgress(null)} className="btn-outline" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }} disabled={!done}>Kapat</button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          <div className="grid grid-cols-2">
            <div className="card">
              <h3>Toplu OCR</h3>
              <p className="mt-4 mb-4" style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                Bekliyor durumundaki sayıları sırayla OCR işle.
              </p>
              <div className="flex gap-4 items-center mb-4">
                <select value={selectedSourceId} onChange={e => setSelectedSourceId(e.target.value)}>
                  {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="flex gap-4 items-center mb-4">
                <label>Limit:</label>
                <input type="number" min={1} max={100} value={batchLimit} onChange={e => setBatchLimit(parseInt(e.target.value) || 10)} style={{ width: '100px' }} />
              </div>
              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label>DPI:</label>
                  <span style={{ fontSize: '0.85rem', color: '#a78bfa', fontWeight: 700 }}>{ocrDpi}</span>
                </div>
                <input type="range" min={100} max={200} step={10} value={ocrDpi} onChange={e => setOcrDpi(parseInt(e.target.value))} style={{ width: '100%', display: 'block' }} />
                <div className="flex justify-between" style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                  <span>100 hızlı</span><span>150 önerilen</span><span>200 kaliteli</span>
                </div>
              </div>
              <button onClick={runBatchOcr} disabled={ocrLoading || !selectedSourceId} style={{ width: '100%' }}>
                {ocrLoading ? '⏳ İşleniyor...' : '▶ Toplu İşle'}
              </button>
            </div>

            <div className="card">
              <h3>Manuel</h3>
              <p className="mt-4 mb-4" style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                Tekil sayı ID&apos;si ile zorla OCR.
              </p>
              <div className="flex gap-4 items-center mb-4">
                <label>Issue ID:</label>
                <input type="number" min={1} value={manualIssueId} onChange={e => setManualIssueId(e.target.value)} />
              </div>
              <button onClick={runManualOcr} disabled={ocrLoading || !manualIssueId} className="btn-outline" style={{ width: '100%' }}>
                {ocrLoading ? '⏳ İşleniyor...' : 'Tekil İşle'}
              </button>
            </div>

            <div className="card mt-4" style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h3 style={{ color: '#ea580c' }}>İşlenmişleri Sıfırla</h3>
                  <p className="mt-2" style={{ color: '#94a3b8', fontSize: '0.9rem', maxWidth: '600px' }}>
                    Seçili kaynağın tüm OCR verisi silinir. Linkler kalır. Tekrar OCR gerekir.
                  </p>
                </div>
                <button onClick={resetOcr} disabled={ocrLoading || !selectedSourceId} style={{ background: '#ea580c', borderColor: '#ea580c', color: '#fff', padding: '0.8rem 1.6rem' }}>
                  {ocrLoading ? 'Sıfırlanıyor...' : 'Sıfırla'}
                </button>
              </div>
            </div>

            {ocrResult && (
              <div className="card mt-4" style={{ gridColumn: 'span 2' }}>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{ocrResult}</pre>
              </div>
            )}

            <div className="card mt-4" style={{ gridColumn: 'span 2' }}>
              <div className="flex justify-between items-center mb-4" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <h3>İşlenmiş PDF&apos;ler</h3>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{processedList.length} / {processedCount}</span>
              </div>

              <div className="flex gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
                <input placeholder="Ara (tarih / ID)..." value={procFilter} onChange={e => setProcFilter(e.target.value)} style={{ maxWidth: '280px' }} />
                <button className="btn-outline" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }} onClick={toggleAllProcessed} disabled={processedList.length === 0}>
                  {selectedProcessed.size === processedList.length && processedList.length > 0 ? 'Seçimi Kaldır' : 'Tümünü Seç'}
                </button>
                <button onClick={() => bulkDeleteProcessed('reset_single')} disabled={selectedProcessed.size === 0}
                        style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', background: '#ea580c', borderColor: '#ea580c', color: '#fff' }}>
                  Seçilenleri OCR Sıfırla ({selectedProcessed.size})
                </button>
                <button onClick={() => bulkDeleteProcessed('single')} disabled={selectedProcessed.size === 0}
                        style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}>
                  Seçilenleri Sil ({selectedProcessed.size})
                </button>
              </div>

              {processedList.length === 0 ? (
                <p style={{ color: '#94a3b8' }}>İşlenmiş sayı yok.</p>
              ) : (
                <div>
                  {processedList.map((i, idx) => {
                    const isCurrent = currentProcessingId === i.id;
                    const sel = selectedProcessed.has(i.id);
                    return (
                      <div key={i.id} className={`proc-row ${sel ? 'selected' : ''} ${isCurrent ? 'processing' : ''}`} style={{ animationDelay: `${Math.min(idx, 20) * 0.02}s` }}>
                        <input type="checkbox" checked={sel} onChange={() => toggleSelected(i.id)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                        <div>
                          <strong>{i.date_label}</strong>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>ID {i.id}</div>
                        </div>
                        <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                          {i.pages_count}{i.page_count ? `/${i.page_count}` : ''} sayfa
                        </span>
                        <span style={{ fontSize: '0.8rem' }}>
                          {i.ocr_dpi ? <span style={{ color: '#a78bfa', fontWeight: 600 }}>{i.ocr_dpi} DPI</span> : <em style={{ color: '#64748b' }}>—</em>}
                        </span>
                        <span style={{ fontSize: '0.8rem' }}>
                          {i.status === 'completed' ? <strong style={{ color: '#4ade80' }}>✓</strong>
                            : i.status === 'partial' ? <span style={{ color: '#fbbf24' }}>Kısmi</span>
                            : <span style={{ color: '#94a3b8' }}>{i.status || '—'}</span>}
                        </span>
                        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                          <a href={i.pdf_url} target="_blank" rel="noopener noreferrer" className="btn-outline" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', textDecoration: 'none' }}>Aç</a>
                          <button onClick={() => deleteSingleIssue(i.id, i.date_label, 'reset_single')} className="btn-outline" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', borderColor: '#ea580c', color: '#fb923c' }}>Sıfırla</button>
                          <button onClick={() => deleteSingleIssue(i.id, i.date_label, 'single')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}>Sil</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
                  <h4 style={{ color: '#94a3b8' }}>Toplam Kaynak</h4>
                  <p style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--primary-color)' }}>{stats.totals.total_sources}</p>
                </div>
                <div className="card" style={{ textAlign: 'center' }}>
                  <h4 style={{ color: '#94a3b8' }}>Toplam Sayı</h4>
                  <p style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--primary-color)' }}>{stats.totals.total_issues}</p>
                </div>
                <div className="card" style={{ textAlign: 'center' }}>
                  <h4 style={{ color: '#94a3b8' }}>Toplam Sayfa</h4>
                  <p style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--primary-color)' }}>{stats.totals.total_pages}</p>
                </div>
                <div className="card" style={{ textAlign: 'center' }}>
                  <h4 style={{ color: '#94a3b8' }}>İşlenmiş Sayfa</h4>
                  <p style={{ fontSize: '2.5rem', fontWeight: 700, color: '#4ade80' }}>{stats.totals.total_processed_pages}</p>
                </div>
              </div>

              <div className="card">
                <h3>Kaynak Bazlı Kırılım</h3>
                <table>
                  <thead>
                    <tr><th>Kaynak</th><th>Sayı</th><th>Sayfa</th></tr>
                  </thead>
                  <tbody>
                    {stats.breakdown.map((b: any, i: number) => (
                      <tr key={i}><td>{b.name}</td><td>{b.issue_count}</td><td>{b.page_count}</td></tr>
                    ))}
                    {stats.breakdown.length === 0 && <tr><td colSpan={3} style={{ color: '#94a3b8' }}>Henüz kaynak yok.</td></tr>}
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
