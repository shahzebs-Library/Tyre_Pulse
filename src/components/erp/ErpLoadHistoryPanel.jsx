/**
 * ErpLoadHistoryPanel - what actually reached the system: upload batches by
 * feed, freshness per country and feed, and lines the upload guard refused.
 * Real rows only; a source that fails to load says so instead of showing zero.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { Activity, RefreshCw, FileSpreadsheet, FileText, XCircle, Clock, Database } from 'lucide-react'
import { useSettings } from '../../contexts/SettingsContext'
import { loadErpHistory, HISTORY_MAX } from '../../lib/api/erpSyncHistory'
import { OUTCOME_META, importRowSummary, importRowOutcome } from '../../lib/api/importHistory'
import { batchFeedSummary, historyKpis, feedFreshness, rejectSummary, filterBatches, batchExportRows, moduleLabel } from '../../lib/erpSyncAnalytics'
import { toUserMessage } from '../../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const BAND = { fresh: ['Fresh', 'text-green-500'], stale: ['Late', 'text-amber-500'], silent: ['Silent', 'text-red-500'], never: ['No data', 'text-[var(--text-muted)]'] }
const EXPORT_COLS = ['created_at', 'module', 'country', 'sheet', 'total_rows', 'imported_rows', 'error_rows', 'duplicate_rows', 'outcome']
const EXPORT_HEADERS = ['Uploaded', 'Feed', 'Country', 'Sheet', 'Rows read', 'Imported', 'Errors', 'Duplicates', 'Outcome']
const FAILED_LABEL = { batches: 'upload batches', rejects: 'rejected lines', coverage: 'feed freshness' }

function Tile({ label, value, tone = '' }) {
  return <div className="rounded-xl p-3" style={{ background: 'var(--panel-overlay)', border: '1px solid var(--hairline)' }}><p className="text-[11px] text-[var(--text-muted)]">{label}</p><p className={`text-xl font-bold mt-0.5 ${tone}`}>{value == null ? 'N/A' : value.toLocaleString()}</p></div>
}

export default function ErpLoadHistoryPanel() {
  const { activeCountry } = useSettings()
  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [attempt, setAttempt] = useState(0)
  const [module, setModule] = useState('all')
  const [outcome, setOutcome] = useState('all')
  const [search, setSearch] = useState('')
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    let live = true
    setState({ loading: true, error: '', data: null })
    loadErpHistory({ country: activeCountry })
      .then(data => { if (live) setState({ loading: false, error: '', data }) })
      .catch(err => { if (live) setState({ loading: false, error: toUserMessage(err, 'Load history could not be read.'), data: null }) })
    return () => { live = false }
  }, [activeCountry, attempt])
  const retry = useCallback(() => setAttempt(n => n + 1), [])

  const batches = useMemo(() => state.data?.batches.rows || [], [state.data])
  const rejects = useMemo(() => state.data?.rejects.rows || [], [state.data])
  const freshness = useMemo(() => feedFreshness(state.data?.coverage), [state.data])
  const feeds = useMemo(() => batchFeedSummary(batches), [batches])
  const failed = state.data?.failed || []
  const kpis = useMemo(() => historyKpis(batches, rejects, freshness), [batches, rejects, freshness])
  const rej = useMemo(() => rejectSummary(rejects), [rejects])
  const shown = useMemo(() => filterBatches(batches, { module, outcome, search }), [batches, module, outcome, search])
  const chart = useMemo(() => ({
    labels: feeds.map(f => f.label),
    datasets: [
      { label: 'Imported rows', data: feeds.map(f => f.imported), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 4 },
      { label: 'Error rows', data: feeds.map(f => f.errors), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
    ],
  }), [feeds])

  async function doExport(kind) {
    setExportError('')
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await import('../../lib/exportUtils')
      const rows = batchExportRows(shown).map(r => ({ ...r, outcome: OUTCOME_META[r.outcome]?.label || r.outcome }))
      const name = reportFileName('ERP Load History')
      if (kind === 'excel') await exportToExcel(rows, EXPORT_COLS, EXPORT_HEADERS, name)
      else await exportToPdf(rows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'ERP Load History', name, 'landscape')
    } catch (err) { setExportError(toUserMessage(err, 'The export could not be created.')) }
  }

  return <section className="space-y-4" aria-label="Load history">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Activity size={14} className="text-green-400" /> Load history and feed freshness</h2>
      <div className="flex gap-2">
        <button className="btn-secondary text-xs inline-flex items-center gap-1" onClick={retry} disabled={state.loading}><RefreshCw size={13} /> Refresh</button>
        <button className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => doExport('excel')} disabled={!shown.length}><FileSpreadsheet size={13} /> Excel</button>
        <button className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => doExport('pdf')} disabled={!shown.length}><FileText size={13} /> PDF</button>
      </div>
    </div>
    {state.loading && <div className="card text-sm text-[var(--text-muted)]">Loading load history...</div>}
    {state.error && <div className="card text-sm"><p className="text-red-500">{state.error}</p><button className="btn-secondary mt-2" onClick={retry}>Retry</button></div>}
    {state.data && <>
      {failed.length > 0 && <p className="text-xs text-amber-500">Could not read {failed.map(f => FAILED_LABEL[f]).join(', ')}. <button className="underline" onClick={retry}>Retry</button></p>}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label="Upload batches" value={failed.includes('batches') ? null : kpis.batches} />
        <Tile label="Rows imported" value={failed.includes('batches') ? null : kpis.imported} tone="text-green-500" />
        <Tile label="Never approved" value={failed.includes('batches') ? null : kpis.unfinished} tone={kpis.unfinished ? 'text-amber-500' : ''} />
        <Tile label="Imported nothing" value={failed.includes('batches') ? null : kpis.nothing} tone={kpis.nothing ? 'text-red-500' : ''} />
        <Tile label="Rejected lines" value={failed.includes('rejects') ? null : kpis.rejects} />
        <Tile label="Late or silent feeds" value={failed.includes('coverage') ? null : kpis.staleFeeds} tone={kpis.staleFeeds ? 'text-amber-500' : ''} />
      </div>
      {(state.data.batches.truncated || state.data.rejects.truncated) && <p className="text-xs text-[var(--text-muted)]">Showing the newest {HISTORY_MAX.toLocaleString()} records. Older history is in Import History.</p>}
      <p className="text-[11px] text-[var(--text-muted)]">Batches cover in-app uploads only. Loads made directly in the database leave no batch; they still show under feed freshness.</p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1.5"><Database size={13} /> Rows per feed</h3>
          {feeds.length ? <div style={{ height: 240 }}><Bar data={chart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: 'var(--text-muted)', boxWidth: 10 } } }, scales: { x: { ticks: { color: 'var(--text-muted)' }, grid: { display: false } }, y: { ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' } } } }} /></div>
            : <p className="text-sm text-[var(--text-muted)] py-10 text-center">No upload batches recorded{activeCountry && activeCountry !== 'All' ? ` for ${activeCountry}` : ''}.</p>}
        </div>
        <div className="card">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1.5"><Clock size={13} /> Feed freshness (last 30 days)</h3>
          {!freshness.length ? <p className="text-sm text-[var(--text-muted)] py-10 text-center">No watched feeds reported. Configure them in the console Import History.</p>
            : <div className="max-h-64 overflow-y-auto"><table className="w-full text-xs"><thead><tr className="text-left text-[var(--text-muted)]"><th className="p-1.5">Country</th><th className="p-1.5">Feed</th><th className="p-1.5">Last data</th><th className="p-1.5">Missed days</th><th className="p-1.5">State</th></tr></thead><tbody>
              {freshness.map(f => <tr key={`${f.country}:${f.src}`} className="border-t border-[var(--hairline)]"><td className="p-1.5">{f.country}</td><td className="p-1.5">{f.label}</td><td className="p-1.5">{f.lastDate || 'N/A'}{f.daysSince != null && <span className="text-[var(--text-muted)]"> ({f.daysSince}d)</span>}</td><td className="p-1.5">{f.missingDays == null ? 'N/A' : f.missingDays}</td><td className={`p-1.5 ${BAND[f.band][1]}`}>{BAND[f.band][0]}</td></tr>)}
            </tbody></table></div>}
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <input className="input flex-1 min-w-[180px]" aria-label="Search batches" placeholder="Search feed, sheet, country" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="input" aria-label="Feed" value={module} onChange={e => setModule(e.target.value)}><option value="all">All feeds</option>{feeds.map(f => <option key={f.module} value={f.module}>{f.label}</option>)}</select>
          <select className="input" aria-label="Outcome" value={outcome} onChange={e => setOutcome(e.target.value)}><option value="all">Any outcome</option>{Object.entries(OUTCOME_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </div>
        {!batches.length ? <p className="text-sm text-[var(--text-muted)] text-center py-4">No uploads recorded yet. <Link className="underline" to="/data-intake">Open Data Intake</Link></p>
          : !shown.length ? <p className="text-sm text-[var(--text-muted)] text-center py-4">No batches match these filters.</p>
          : <div className="overflow-x-auto max-h-96"><table className="w-full text-xs"><thead><tr className="text-left text-[var(--text-muted)]"><th className="p-1.5">Uploaded</th><th className="p-1.5">Feed</th><th className="p-1.5">Country</th><th className="p-1.5">Result</th><th className="p-1.5">Errors</th><th className="p-1.5">Outcome</th></tr></thead><tbody>
            {shown.slice(0, 300).map(b => <tr key={b.id} className="border-t border-[var(--hairline)]"><td className="p-1.5 whitespace-nowrap">{b.created_at ? String(b.created_at).replace('T', ' ').slice(0, 16) : 'N/A'}</td><td className="p-1.5">{moduleLabel(b.module)}</td><td className="p-1.5">{b.country || 'N/A'}</td><td className="p-1.5">{importRowSummary(b)}</td><td className="p-1.5">{Number(b.error_rows) || 0}</td><td className="p-1.5">{OUTCOME_META[importRowOutcome(b)]?.label}</td></tr>)}
          </tbody></table>{shown.length > 300 && <p className="text-[11px] text-[var(--text-muted)] p-2">Showing 300 of {shown.length}. Export for the full list.</p>}</div>}
        {exportError && <p className="text-xs text-red-500">{exportError}</p>}
      </div>

      <div className="card space-y-2">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5"><XCircle size={13} className="text-red-400" /> Lines refused by the upload guard ({failed.includes('rejects') ? 'N/A' : rej.total})</h3>
        {!rej.total ? <p className="text-sm text-[var(--text-muted)]">{failed.includes('rejects') ? 'Rejected lines could not be read.' : 'No expense lines have been refused.'}</p> : <>
          <div className="flex flex-wrap gap-2 text-xs">{rej.byPair.map(p => <span key={p.label} className="px-2 py-1 rounded-lg border border-[var(--hairline)]">{p.label}: {p.count}</span>)}</div>
          <div className="flex flex-wrap gap-2 text-xs">{rej.byReason.map(p => <span key={p.label} className="px-2 py-1 rounded-lg border border-[var(--hairline)] text-[var(--text-muted)]">{p.label}: {p.count}</span>)}</div>
          <div className="overflow-x-auto max-h-64"><table className="w-full text-xs"><thead><tr className="text-left text-[var(--text-muted)]"><th className="p-1.5">Date</th><th className="p-1.5">Job card</th><th className="p-1.5">Item</th><th className="p-1.5">Uploaded as</th><th className="p-1.5">Belongs to</th></tr></thead><tbody>
            {rejects.slice(0, 100).map(r => <tr key={r.id} className="border-t border-[var(--hairline)]"><td className="p-1.5 whitespace-nowrap">{String(r.created_at || '').slice(0, 10) || 'N/A'}</td><td className="p-1.5">{r.work_order_no || 'N/A'}</td><td className="p-1.5">{r.item_description || r.item_code || 'N/A'}</td><td className="p-1.5">{r.uploaded_country || 'N/A'}</td><td className="p-1.5">{r.detected_country || 'N/A'}</td></tr>)}
          </tbody></table></div>
        </>}
      </div>
    </>}
  </section>
}

