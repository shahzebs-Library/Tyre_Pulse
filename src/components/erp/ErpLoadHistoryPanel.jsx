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
import EnterpriseTable from '../ui/EnterpriseTable'
import { compareValues, isBlank } from '../../lib/consoleTable'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const BAND = { fresh: ['Fresh', 'text-green-500'], stale: ['Late', 'text-amber-500'], silent: ['Silent', 'text-red-500'], never: ['No data', 'text-[var(--text-muted)]'] }
const EXPORT_COLS = ['created_at', 'module', 'country', 'sheet', 'total_rows', 'imported_rows', 'error_rows', 'duplicate_rows', 'outcome']
const EXPORT_HEADERS = ['Uploaded', 'Feed', 'Country', 'Sheet', 'Rows read', 'Imported', 'Errors', 'Duplicates', 'Outcome']
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = v => (isBlank(v) ? undefined : v)
const sortable = { sortingFn: valueSort, sortUndefined: 'last' }
const naCell = ({ getValue }) => getValue() ?? 'N/A'
const uploadedAt = v => (v ? String(v).replace('T', ' ').slice(0, 16) : undefined)

const FRESH_COLUMNS = [
  { id: 'country', header: 'Country', accessorFn: f => blank(f.country), ...sortable, meta: { filterVariant: 'select' }, cell: naCell },
  { id: 'feed', header: 'Feed', accessorFn: f => blank(f.label), ...sortable, cell: naCell },
  {
    id: 'lastDate', header: 'Last data', accessorFn: f => blank(f.lastDate), ...sortable,
    meta: { exportValue: f => f.lastDate || 'N/A' },
    cell: ({ row: { original: f } }) => <>{f.lastDate || 'N/A'}{f.daysSince != null && <span className="text-[var(--text-muted)]"> ({f.daysSince}d)</span>}</>,
  },
  { id: 'missingDays', header: 'Missed days', accessorFn: f => (f.missingDays == null ? undefined : f.missingDays), ...sortable, meta: { align: 'right', exportValue: f => (f.missingDays == null ? 'N/A' : f.missingDays) }, cell: naCell },
  {
    id: 'band', header: 'State', accessorFn: f => BAND[f.band]?.[0] || f.band, ...sortable, meta: { filterVariant: 'select' },
    cell: ({ row: { original: f } }) => <span className={BAND[f.band]?.[1]}>{BAND[f.band]?.[0] || f.band}</span>,
  },
]

const BATCH_COLUMNS = [
  { id: 'created_at', header: 'Uploaded', accessorFn: b => uploadedAt(b.created_at), ...sortable, cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() ?? 'N/A'}</span> },
  { id: 'module', header: 'Feed', accessorFn: b => moduleLabel(b.module), ...sortable },
  { id: 'country', header: 'Country', accessorFn: b => blank(b.country), ...sortable, cell: naCell },
  { id: 'result', header: 'Result', accessorFn: b => importRowSummary(b), ...sortable },
  { id: 'error_rows', header: 'Errors', accessorFn: b => Number(b.error_rows) || 0, ...sortable, meta: { align: 'right' } },
  { id: 'outcome', header: 'Outcome', accessorFn: b => OUTCOME_META[importRowOutcome(b)]?.label, ...sortable, cell: naCell },
]

const REJECT_COLUMNS = [
  { id: 'created_at', header: 'Date', accessorFn: r => blank(String(r.created_at || '').slice(0, 10)), ...sortable, cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() ?? 'N/A'}</span> },
  { id: 'work_order_no', header: 'Job card', accessorFn: r => blank(r.work_order_no), ...sortable, cell: naCell },
  { id: 'item', header: 'Item', accessorFn: r => blank(r.item_description || r.item_code), ...sortable, cell: naCell },
  { id: 'uploaded_country', header: 'Uploaded as', accessorFn: r => blank(r.uploaded_country), ...sortable, meta: { filterVariant: 'select' }, cell: naCell },
  { id: 'detected_country', header: 'Belongs to', accessorFn: r => blank(r.detected_country), ...sortable, meta: { filterVariant: 'select' }, cell: naCell },
]

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
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[44px]" onClick={retry} disabled={state.loading}><RefreshCw size={13} aria-hidden="true" className={state.loading ? 'animate-spin' : ''} /> Refresh</button>
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[44px]" onClick={() => doExport('excel')} disabled={!shown.length}><FileSpreadsheet size={13} aria-hidden="true" /> Excel</button>
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[44px]" onClick={() => doExport('pdf')} disabled={!shown.length}><FileText size={13} aria-hidden="true" /> PDF</button>
      </div>
    </div>
    {state.loading && <div className="card text-sm text-[var(--text-muted)]" role="status">Loading load history...</div>}
    {state.error && <div className="card text-sm" role="alert"><p className="text-red-500">{state.error}</p><button type="button" className="btn-secondary mt-2 min-h-[44px]" onClick={retry}>Retry</button></div>}
    {state.data && <>
      {failed.length > 0 && <p className="text-xs text-amber-500">Could not read {failed.map(f => FAILED_LABEL[f]).join(', ')}. <button type="button" className="underline min-h-[44px] px-1" onClick={retry}>Retry</button></p>}
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
            : <EnterpriseTable
                columns={FRESH_COLUMNS}
                data={freshness}
                getRowId={f => `${f.country}:${f.src}`}
                initialPageSize={25}
                enableColumnVisibility={false}
                searchPlaceholder="Search country or feed"
                exportFileName="ERP Feed Freshness"
                reportMeta={{ title: 'Feed freshness (last 30 days)' }}
                emptyMessage="No feeds match this search."
              />}
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
          : <EnterpriseTable
              columns={BATCH_COLUMNS}
              data={shown}
              getRowId={b => String(b.id)}
              initialPageSize={25}
              enableGlobalFilter={false}
              enableExport={false}
              emptyMessage="No batches match these filters."
            />}
        {exportError && <p className="text-xs text-red-500" role="alert">{exportError}</p>}
      </div>

      <div className="card space-y-2">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] flex items-center gap-1.5"><XCircle size={13} className="text-red-400" /> Lines refused by the upload guard ({failed.includes('rejects') ? 'N/A' : rej.total})</h3>
        {!rej.total ? <p className="text-sm text-[var(--text-muted)]">{failed.includes('rejects') ? 'Rejected lines could not be read.' : 'No expense lines have been refused.'}</p> : <>
          <div className="flex flex-wrap gap-2 text-xs">{rej.byPair.map(p => <span key={p.label} className="px-2 py-1 rounded-lg border border-[var(--hairline)]">{p.label}: {p.count}</span>)}</div>
          <div className="flex flex-wrap gap-2 text-xs">{rej.byReason.map(p => <span key={p.label} className="px-2 py-1 rounded-lg border border-[var(--hairline)] text-[var(--text-muted)]">{p.label}: {p.count}</span>)}</div>
          <EnterpriseTable
            columns={REJECT_COLUMNS}
            data={rejects}
            getRowId={r => String(r.id)}
            initialPageSize={25}
            searchPlaceholder="Search job card, item, country"
            exportFileName="ERP Rejected Lines"
            reportMeta={{ title: 'Lines refused by the upload guard' }}
            emptyMessage="No rejected lines match this search."
          />
        </>}
      </div>
    </>}
  </section>
}

