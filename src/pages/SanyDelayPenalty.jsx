/**
 * SanyDelayPenalty (route /sany-delay-penalty) - the standalone KSA repair-delay
 * penalty ledger (V464).
 *
 * Rule: a vehicle sent to a SANY workshop whose repair exceeded 5 days is charged
 * 43 SAR per hour of total repair downtime; the company then DEDUCTS that from the
 * SANY invoice. This is a SEPARATE figure - it never feeds Cost per M3 (which uses
 * the SANY invoice gross). Workflow: pull job-card candidates (repairs over N days),
 * tick the ones sent to SANY, save them as penalty rows (hours x 43), then mark each
 * as deducted against a SANY invoice. All money is SAR (KSA), never blended.
 *
 * Analytics (KPIs, breakdowns, data-quality flags) come from the pure engine
 * src/lib/sanyDelayPenaltyAnalytics.js. Nothing here is recomputed inline.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Timer, Search, Plus, Trash2, FileSpreadsheet, FileText, RefreshCcw, Info, AlertCircle,
  AlertTriangle, Receipt, Clock, ShieldAlert, CheckCircle2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import {
  listDelayPenalties, getDelayCandidates, createDelayPenalties, createDelayPenalty,
  updateDelayPenalty, deleteDelayPenalty, penaltyFromCandidate,
  DEFAULT_RATE_PER_HOUR, DEFAULT_MIN_DAYS,
} from '../lib/api/sanyDelayPenalty'
import {
  PENALTY_STATUSES, DRAFT_OVERDUE_DAYS, ISSUE_LABELS, evaluateCandidate, summarizeCandidates,
  summarizeLedger, groupPenalties, monthlyTrend, repeatAssets, filterLedger, siteOptions,
  ledgerExportRows, rowIssues, ageDays,
} from '../lib/sanyDelayPenaltyAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

/**
 * Country this page works in, taken from the working context. On the
 * All-countries view there is nothing to inherit, so it opens UNSET and the user
 * picks a country - a silent 'KSA' default would book penalty rows against a
 * country nobody chose (and every row here is written in SAR).
 */
const defaultCountryFor = (active) => (active && active !== 'All' ? active : '')

const COUNTRY_REQUIRED_HINT = 'Select a country. You are viewing all countries.'
const fmtSar = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 'N/A' : `SAR ${Math.round(Number(v)).toLocaleString()}`)
const fmtHrs = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 'N/A' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`)
const fmtPct = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${v}%`)
const fmtDate = (v) => (v ? String(v).slice(0, 10) : 'N/A')
const monthStart = (ym) => (ym ? `${ym}-01` : null)
const monthEnd = (ym) => {
  if (!ym) return null
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

const LEDGER_EXPORT_KEYS = ['asset_no', 'site', 'work_order_no', 'period', 'downtime_hours', 'downtime_days', 'rate_per_hour', 'penalty_amount', 'status', 'sany_invoice_no', 'age_days', 'issues']
const LEDGER_EXPORT_HEADERS = ['Asset', 'Site', 'Job Card', 'Month', 'Downtime (h)', 'Downtime (days)', 'Rate/h (SAR)', 'Penalty (SAR)', 'Status', 'SANY Invoice', 'Age (days)', 'Data issues']

export default function SanyDelayPenalty() {
  const { activeCountry } = useSettings()
  const [country, setCountry] = useState(defaultCountryFor(activeCountry))
  const [fromM, setFromM] = useState('')
  const [toM, setToM] = useState('')
  const [minDays, setMinDays] = useState(DEFAULT_MIN_DAYS)

  const [ledger, setLedger] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')

  const [candidates, setCandidates] = useState(null) // null = not searched yet
  const [candLoading, setCandLoading] = useState(false)
  const [candError, setCandError] = useState('')
  const [selected, setSelected] = useState({}) // candKey -> candidate

  // Ledger filters (client-side over the loaded window)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [invoiceFilter, setInvoiceFilter] = useState('all')
  const [issuesOnly, setIssuesOnly] = useState(false)

  const loadLedger = useCallback(() => {
    let cancelled = false
    // With no country chosen there is no scope to read: an unfiltered read would
    // blend the three countries' rows under this page's fixed SAR formatting.
    if (!country) { setLedger([]); setLoading(false); setLoadError(''); return () => { cancelled = true } }
    setLoading(true); setLoadError('')
    listDelayPenalties({ country, from: monthStart(fromM), to: monthEnd(toM) })
      .then((rows) => { if (!cancelled) setLedger(rows) })
      .catch((e) => { if (!cancelled) setLoadError(toUserMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, fromM, toM])

  useEffect(() => loadLedger(), [loadLedger])

  const now = useMemo(() => new Date(), [ledger]) // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(() => summarizeLedger(ledger, { now }), [ledger, now])
  const bySite = useMemo(() => groupPenalties(ledger, (r) => r.site, { limit: 6 }), [ledger])
  const repeats = useMemo(() => repeatAssets(ledger).slice(0, 6), [ledger])
  const trend = useMemo(() => monthlyTrend(ledger).slice(-12), [ledger])
  const sites = useMemo(() => siteOptions(ledger), [ledger])
  const filteredLedger = useMemo(
    () => filterLedger(ledger, { search, status: statusFilter, site: siteFilter, invoice: invoiceFilter, issues: issuesOnly }),
    [ledger, search, statusFilter, siteFilter, invoiceFilter, issuesOnly],
  )
  const candSummary = useMemo(() => summarizeCandidates(candidates || [], { minDays, rate: DEFAULT_RATE_PER_HOUR }), [candidates, minDays])

  async function findCandidates() {
    // The candidate RPC falls back to KSA when it is handed no country, so this
    // must not run until the user has actually chosen one.
    if (!country) { setError(COUNTRY_REQUIRED_HINT); return }
    setCandLoading(true); setCandError(''); setNotice(''); setSelected({})
    try {
      const res = await getDelayCandidates({ country, from: monthStart(fromM), to: monthEnd(toM), minDays })
      setCandidates(res.ok ? res.candidates : [])
      if (!res.ok) setCandError('Could not load job-card candidates. The repair-downtime source may be empty for this window.')
    } catch (e) {
      setCandError(toUserMessage(e)); setCandidates([])
    } finally {
      setCandLoading(false)
    }
  }

  const candKey = (c) => `${c.work_order_no || ''}|${c.asset_no || ''}|${c.production_out_at || ''}`

  // Work orders already on the ledger, so a candidate is not added twice.
  const onLedger = useMemo(() => new Set(ledger.map((r) => String(r.work_order_no || '').trim()).filter(Boolean)), [ledger])

  function toggle(c) {
    const k = candKey(c)
    setSelected((prev) => {
      const next = { ...prev }
      if (next[k]) delete next[k]; else next[k] = c
      return next
    })
  }
  function toggleAll() {
    if (!candidates?.length) return
    const allSel = candidates.every((c) => selected[candKey(c)])
    setSelected(allSel ? {} : Object.fromEntries(candidates.map((c) => [candKey(c), c])))
  }

  async function addSelected() {
    if (!country) { setError(COUNTRY_REQUIRED_HINT); return }
    const rows = Object.values(selected).map((c) => penaltyFromCandidate(c, { rate: DEFAULT_RATE_PER_HOUR, country }))
    if (!rows.length) return
    setNotice(''); setError('')
    const res = await createDelayPenalties(rows)
    if (res.error) setError(toUserMessage(res.error))
    else setNotice(`Added ${res.inserted} penalty row(s)${res.failed ? `, ${res.failed} failed` : ''}.`)
    setSelected({}); setCandidates(null); loadLedger()
  }

  async function setStatus(id, status) {
    const res = await updateDelayPenalty(id, { status })
    if (res.error) setError(toUserMessage(res.error)); else loadLedger()
  }
  async function setInvoice(id, value) {
    const sany_invoice_no = String(value || '').trim()
    const current = ledger.find((r) => r.id === id)
    if (current && String(current.sany_invoice_no || '') === sany_invoice_no) return
    const res = await updateDelayPenalty(id, { sany_invoice_no })
    if (res.error) setError(toUserMessage(res.error))
    else setLedger((prev) => prev.map((r) => (r.id === id ? { ...r, sany_invoice_no: sany_invoice_no || null } : r)))
  }
  async function remove(id) {
    if (!window.confirm('Delete this penalty row? This cannot be undone.')) return
    const res = await deleteDelayPenalty(id)
    if (res.error) setError(toUserMessage(res.error)); else loadLedger()
  }

  // Manual add
  const [manual, setManual] = useState(null)
  async function saveManual() {
    if (!manual) return
    if (!country) { setError(COUNTRY_REQUIRED_HINT); return }
    const hours = Number(manual.downtime_hours)
    const rate = Number(manual.rate_per_hour || DEFAULT_RATE_PER_HOUR)
    if (!Number.isFinite(hours) || hours <= 0) { setError('Downtime hours must be a number greater than 0.'); return }
    if (!Number.isFinite(rate) || rate <= 0) { setError('Rate per hour must be a number greater than 0.'); return }
    const res = await createDelayPenalty({ ...manual, country, currency: 'SAR', status: 'draft', source: 'manual', downtime_hours: hours, rate_per_hour: rate })
    if (res.ok) { setManual(null); loadLedger() } else setError(toUserMessage(res.error))
  }

  function exportLedger(kind) {
    if (!filteredLedger.length) return
    const rows = ledgerExportRows(filteredLedger, { now })
    const fname = reportFileName('TyrePulse', 'SANY delay penalty', country)
    if (kind === 'excel') exportToExcel(rows, LEDGER_EXPORT_KEYS, LEDGER_EXPORT_HEADERS, fname, 'SANY Delay Penalty')
    else exportToPdf(rows, LEDGER_EXPORT_KEYS.map((k, i) => ({ key: k, header: LEDGER_EXPORT_HEADERS[i] })), `SANY Delay Penalty (${country})`, fname, 'landscape')
  }

  function exportCandidates() {
    if (!candidates?.length) return
    const rows = candidates.map((c) => {
      const ev = evaluateCandidate(c, { minDays, rate: DEFAULT_RATE_PER_HOUR })
      return {
        asset_no: c.asset_no || '', site: c.site || '', work_order_no: c.work_order_no || '',
        out: fmtDate(c.production_out_at), in: fmtDate(c.production_in_at),
        hours: ev.hours ?? '', days: ev.days ?? '', penalty: ev.penalty == null ? '' : Math.round(ev.penalty),
        on_ledger: onLedger.has(String(c.work_order_no || '').trim()) ? 'Yes' : 'No',
      }
    })
    const keys = ['asset_no', 'site', 'work_order_no', 'out', 'in', 'hours', 'days', 'penalty', 'on_ledger']
    const headers = ['Asset', 'Site', 'Job Card', 'Out', 'In', 'Downtime (h)', 'Downtime (days)', 'Penalty (SAR)', 'Already on ledger']
    exportToExcel(rows, keys, headers, reportFileName('TyrePulse', 'SANY delay candidates', country), 'Candidates')
  }

  const selectedCount = Object.keys(selected).length
  const selectedTotal = Object.values(selected).reduce((s, c) => s + (evaluateCandidate(c, { minDays: 0 }).penalty ?? 0), 0)
  const allSelected = !!candidates?.length && candidates.every((c) => selected[candKey(c)])

  const candidateColumns = useMemo(() => [
    {
      id: 'select',
      header: () => <input type="checkbox" aria-label="Select all candidates" checked={allSelected} onChange={toggleAll} />,
      enableSorting: false,
      size: 40,
      meta: { export: false },
      cell: ({ row }) => <input type="checkbox" aria-label="Select candidate" checked={!!selected[candKey(row.original)]} onChange={() => toggle(row.original)} />,
    },
    { id: 'asset_no', header: 'Asset', accessorFn: (c) => c.asset_no || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (c) => c.site || 'N/A', meta: { filterVariant: 'select' } },
    { id: 'work_order_no', header: 'Job Card', accessorFn: (c) => c.work_order_no || 'N/A' },
    { id: 'out', header: 'Out', accessorFn: (c) => fmtDate(c.production_out_at) },
    { id: 'in', header: 'In', accessorFn: (c) => fmtDate(c.production_in_at) },
    {
      id: 'days', header: 'Days', meta: { align: 'right' },
      accessorFn: (c) => evaluateCandidate(c, { minDays }).days ?? -1,
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() < 0 ? 'N/A' : getValue()}</span>,
    },
    {
      id: 'hours', header: 'Downtime', meta: { align: 'right' },
      accessorFn: (c) => evaluateCandidate(c, { minDays }).hours ?? -1,
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() < 0 ? 'N/A' : fmtHrs(getValue())}</span>,
    },
    {
      id: 'penalty', header: 'Penalty', meta: { align: 'right' },
      accessorFn: (c) => evaluateCandidate(c, { minDays, rate: DEFAULT_RATE_PER_HOUR }).penalty ?? -1,
      cell: ({ getValue }) => <span className="tabular-nums font-semibold">{getValue() < 0 ? 'N/A' : fmtSar(getValue())}</span>,
    },
    {
      id: 'on_ledger', header: 'Ledger',
      accessorFn: (c) => (onLedger.has(String(c.work_order_no || '').trim()) ? 'Already added' : ''),
      cell: ({ getValue }) => (getValue() ? <span className="text-xs text-amber-400">{getValue()}</span> : null),
    },
  ], [selected, allSelected, minDays, onLedger]) // eslint-disable-line react-hooks/exhaustive-deps

  const ledgerColumns = useMemo(() => [
    { id: 'asset_no', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A' },
    { id: 'work_order_no', header: 'Job Card', accessorFn: (r) => r.work_order_no || 'N/A' },
    { id: 'period', header: 'Month', accessorFn: (r) => String(r.period_date || '').slice(0, 7) || 'N/A' },
    {
      id: 'downtime', header: 'Downtime', meta: { align: 'right' },
      accessorFn: (r) => Number(r.downtime_hours) || 0,
      cell: ({ row }) => <span className="tabular-nums">{fmtHrs(row.original.downtime_hours)}</span>,
    },
    {
      id: 'penalty', header: 'Penalty', meta: { align: 'right' },
      accessorFn: (r) => Number(r.penalty_amount) || 0,
      cell: ({ row }) => <span className="tabular-nums font-semibold">{fmtSar(row.original.penalty_amount)}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r.status || 'draft', enableSorting: true,
      cell: ({ row }) => (
        <select aria-label="Penalty status" value={row.original.status || 'draft'} onChange={(e) => setStatus(row.original.id, e.target.value)} className="rounded-md border border-[var(--border-subtle)] bg-transparent px-1.5 py-0.5 text-xs">
          {PENALTY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      ),
    },
    {
      id: 'invoice', header: 'SANY Invoice', accessorFn: (r) => r.sany_invoice_no || '',
      cell: ({ row }) => (
        <input aria-label="SANY invoice number" defaultValue={row.original.sany_invoice_no || ''} placeholder="Invoice no" onBlur={(e) => setInvoice(row.original.id, e.target.value)} className="w-28 rounded-md border border-[var(--border-subtle)] bg-transparent px-1.5 py-0.5 text-xs" />
      ),
    },
    {
      id: 'age', header: 'Age', meta: { align: 'right' },
      accessorFn: (r) => ageDays(r, now) ?? -1,
      cell: ({ row, getValue }) => {
        const a = getValue()
        if (a < 0) return 'N/A'
        const overdue = (row.original.status || 'draft') === 'draft' && a > DRAFT_OVERDUE_DAYS
        return <span className={`tabular-nums ${overdue ? 'text-amber-400 font-semibold' : ''}`}>{a}d</span>
      },
    },
    {
      id: 'issues', header: 'Data check', accessorFn: (r) => rowIssues(r).length,
      cell: ({ row }) => {
        const iss = rowIssues(row.original)
        return iss.length
          ? <span className="inline-flex items-center gap-1 text-xs text-amber-400" title={iss.map((k) => ISSUE_LABELS[k] || k).join('; ')}><AlertTriangle size={12} /> {iss.length}</span>
          : <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={12} /> OK</span>
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => <button type="button" aria-label="Delete penalty row" onClick={() => remove(row.original.id)} className="text-red-400"><Trash2 size={14} /></button>,
    },
  ], [ledger, now]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxTrend = Math.max(1, ...trend.map((t) => t.penalty))
  const inputCls = 'rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-sm'

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="SANY Delay Penalty (KSA)"
        subtitle="43 SAR per hour of repair downtime for vehicles at a SANY workshop over 5 days, deducted from the SANY invoice"
        actions={
          <button type="button" onClick={loadLedger} className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm">
            <RefreshCcw size={14} /> Refresh
          </button>
        }
      />

      <p className="mb-4 flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <Info size={14} className="mt-0.5 shrink-0" />
        This penalty is a SEPARATE figure that you deduct from the SANY invoice. It is NOT added to Cost per M3 (that uses the SANY invoice gross). Rate is fixed at {DEFAULT_RATE_PER_HOUR} SAR/hour of total repair downtime. Every amount is SAR; a row in another currency is flagged and left out of the totals.
      </p>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <div className="inline-flex rounded-lg border border-[var(--border-subtle)] p-0.5">
            {COUNTRIES.map((c) => (
              <button key={c} type="button" onClick={() => setCountry(c)}
                className={`px-3 py-1.5 text-sm rounded-md ${country === c ? 'bg-[var(--accent)] text-white' : ''}`}
                style={country === c ? undefined : { color: 'var(--text-secondary)' }}>{c}</button>
            ))}
          </div>
          {!country && (
            <p className="mt-1 text-xs text-amber-300">{COUNTRY_REQUIRED_HINT}</p>
          )}
        </div>
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>From
          <input type="month" value={fromM} onChange={(e) => setFromM(e.target.value)} className={`ml-2 ${inputCls}`} />
        </label>
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>To
          <input type="month" value={toM} onChange={(e) => setToM(e.target.value)} className={`ml-2 ${inputCls}`} />
        </label>
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Over (days)
          <input type="number" min="1" value={minDays} onChange={(e) => setMinDays(Number(e.target.value) || DEFAULT_MIN_DAYS)} className={`ml-2 w-16 ${inputCls}`} />
        </label>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          <AlertCircle size={14} /> {error}
          <button type="button" onClick={() => setError('')} className="ml-auto rounded border border-red-500/40 px-2 py-0.5 text-xs">Dismiss</button>
        </div>
      )}
      {notice && <div className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{notice}</div>}

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Receipt} label="Penalty to deduct" value={fmtSar(summary.toDeduct)} hint="Draft + deducted rows. Waived rows are excluded." />
        <Kpi icon={Clock} label="Outstanding (draft)" value={fmtSar(summary.outstanding)} sub={`${summary.countByStatus.draft} row(s) not yet deducted`} />
        <Kpi icon={CheckCircle2} label="Already deducted" value={fmtSar(summary.byStatus.deducted)} sub={`${fmtPct(summary.deductedPct)} of the penalty`} />
        <Kpi icon={Timer} label="Total downtime" value={fmtHrs(summary.hours)} sub={summary.avgDowntimeDays == null ? 'Average N/A' : `Average ${summary.avgDowntimeDays} days per repair`} />
        <Kpi icon={AlertTriangle} label={`Drafts over ${DRAFT_OVERDUE_DAYS} days`} value={summary.overdueDrafts} sub={summary.overdueDrafts ? fmtSar(summary.overdueDraftAmount) : 'None overdue'} tone={summary.overdueDrafts ? 'warn' : ''} />
        <Kpi icon={FileText} label="Invoice coverage" value={fmtPct(summary.invoiceCoveragePct)} sub={`${summary.distinctInvoices} SANY invoice(s) referenced`} />
        <Kpi icon={ShieldAlert} label="Rows with data issues" value={summary.issueRows} sub={summary.unpriced ? `${summary.unpriced} row(s) with no penalty amount` : 'All rows priced'} tone={summary.issueRows ? 'warn' : ''} />
        <Kpi icon={Receipt} label="Waived" value={fmtSar(summary.byStatus.waived)} sub={`${summary.countByStatus.waived} row(s), ${summary.count} total`} />
      </div>
      {summary.foreignCurrency > 0 && (
        <p className="mb-4 text-xs text-amber-400">{summary.foreignCurrency} row(s) are in a currency other than SAR and are left out of every total above.</p>
      )}

      {/* Breakdowns */}
      {country && ledger.length > 0 && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Panel title="Penalty by site">
            {bySite.map((g) => <BarRow key={g.key} label={g.key} value={g.penalty} max={bySite[0]?.penalty || 1} text={fmtSar(g.penalty)} sub={`${g.rows} row(s)`} />)}
          </Panel>
          <Panel title="Repeat assets (2 or more penalties)">
            {repeats.length === 0
              ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No asset has been penalised more than once in this window.</p>
              : repeats.map((g) => <BarRow key={g.key} label={g.key} value={g.penalty} max={repeats[0]?.penalty || 1} text={fmtSar(g.penalty)} sub={`${g.rows} repairs, ${fmtHrs(g.hours)}`} />)}
          </Panel>
          <Panel title="Monthly penalty (waived excluded)">
            {trend.length === 0
              ? <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No rows carry a month.</p>
              : trend.map((t) => <BarRow key={t.month} label={t.month} value={t.penalty} max={maxTrend} text={fmtSar(t.penalty)} sub={`deducted ${fmtSar(t.deducted)}`} />)}
          </Panel>
        </div>
      )}

      {/* Candidates */}
      <section className="mb-6 rounded-xl border border-[var(--border-subtle)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold"><Search size={18} /> Job-card candidates (repairs over {minDays} days)</h3>
          <div className="flex items-center gap-2">
            {candidates?.length > 0 && (
              <button type="button" onClick={exportCandidates} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs"><FileSpreadsheet size={12} /> Excel</button>
            )}
            <button type="button" onClick={findCandidates} disabled={!country || candLoading} className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed">
              <Search size={14} /> {candLoading ? 'Searching...' : 'Find candidates'}
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Repairs whose downtime (Production Out to Production In) exceeded {minDays} days. The job card does not record whether the vehicle went to a SANY workshop, so you confirm that by ticking the row. Penalty = downtime hours x {DEFAULT_RATE_PER_HOUR} SAR.
        </p>

        {!country ? (
          <div className="py-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>{COUNTRY_REQUIRED_HINT}</div>
        ) : candidates == null && !candLoading ? (
          <div className="py-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Press "Find candidates" to list repairs over {minDays} days.</div>
        ) : (
          <>
            {candidates?.length > 0 && (
              <div className="mb-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <MiniStat label="Candidates" value={candSummary.count} />
                <MiniStat label={`Over ${minDays} days`} value={candSummary.eligible} />
                <MiniStat label="Potential penalty" value={fmtSar(candSummary.potentialPenalty)} />
                <MiniStat label="Longest repair" value={candSummary.longestDays == null ? 'N/A' : `${candSummary.longestDays} days`} />
              </div>
            )}
            {candSummary.unmeasurable > 0 && (
              <p className="mb-2 text-xs text-amber-400">{candSummary.unmeasurable} candidate(s) have no measurable downtime and cannot be priced.</p>
            )}
            {selectedCount > 0 && (
              <div className="mb-2 flex justify-end">
                <button type="button" onClick={addSelected} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white">
                  <Plus size={14} /> Add {selectedCount} as penalty ({fmtSar(selectedTotal)})
                </button>
              </div>
            )}
            <EnterpriseTable
              columns={candidateColumns}
              data={candidates || []}
              getRowId={candKey}
              loading={candLoading}
              error={candError || null}
              onRetry={findCandidates}
              emptyMessage={`No repairs over ${minDays} days found for ${country} in this window.`}
              searchPlaceholder="Search asset, site or job card"
              enableExport={false}
              initialPageSize={25}
            />
          </>
        )}
      </section>

      {/* Ledger */}
      <section className="rounded-xl border border-[var(--border-subtle)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold"><Timer size={18} /> Penalty ledger</h3>
          <div className="flex items-center gap-2">
            <button type="button" disabled={!country} onClick={() => setManual(manual ? null : { downtime_hours: '', rate_per_hour: DEFAULT_RATE_PER_HOUR })} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"><Plus size={12} /> Manual add</button>
            <button type="button" disabled={!filteredLedger.length} onClick={() => exportLedger('excel')} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs disabled:opacity-50"><FileSpreadsheet size={12} /> Excel</button>
            <button type="button" disabled={!filteredLedger.length} onClick={() => exportLedger('pdf')} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs disabled:opacity-50"><FileText size={12} /> PDF</button>
          </div>
        </div>

        {manual && (
          <div className="mb-3 grid grid-cols-2 md:grid-cols-6 gap-2 rounded-lg border border-[var(--border-subtle)] p-3">
            <input aria-label="Asset" placeholder="Asset" onChange={(e) => setManual({ ...manual, asset_no: e.target.value })} className={inputCls} />
            <input aria-label="Site" placeholder="Site" onChange={(e) => setManual({ ...manual, site: e.target.value })} className={inputCls} />
            <input aria-label="Job card" placeholder="Job Card" onChange={(e) => setManual({ ...manual, work_order_no: e.target.value })} className={inputCls} />
            <input aria-label="Month" type="month" onChange={(e) => setManual({ ...manual, period_date: monthStart(e.target.value) })} className={inputCls} />
            <input aria-label="Downtime hours" type="number" placeholder="Downtime h" value={manual.downtime_hours} onChange={(e) => setManual({ ...manual, downtime_hours: e.target.value })} className={inputCls} />
            <button type="button" onClick={saveManual} className="rounded-md bg-[var(--accent)] px-3 py-1 text-sm text-white">Save ({fmtSar((Number(manual.downtime_hours) || 0) * (manual.rate_per_hour || DEFAULT_RATE_PER_HOUR))})</button>
          </div>
        )}

        {country && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input aria-label="Search ledger" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search asset, site, job card, invoice" className={`${inputCls} min-w-[220px] flex-1`} />
            <select aria-label="Status filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls}>
              <option value="all">All statuses</option>
              {PENALTY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Site filter" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className={inputCls}>
              <option value="all">All sites</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Invoice filter" value={invoiceFilter} onChange={(e) => setInvoiceFilter(e.target.value)} className={inputCls}>
              <option value="all">Any invoice</option>
              <option value="with">With SANY invoice</option>
              <option value="without">No SANY invoice</option>
            </select>
            <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} /> Data issues only
            </label>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{filteredLedger.length} of {ledger.length} shown</span>
          </div>
        )}

        {!country ? (
          <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>{COUNTRY_REQUIRED_HINT}</div>
        ) : (
          <EnterpriseTable
            columns={ledgerColumns}
            data={filteredLedger}
            getRowId={(r) => String(r.id)}
            loading={loading}
            error={loadError || null}
            onRetry={loadLedger}
            enableGlobalFilter={false}
            enableExport={false}
            emptyMessage={ledger.length ? 'No penalty rows match these filters.' : 'No penalty rows yet. Find job-card candidates above and add the ones sent to SANY.'}
            initialPageSize={25}
          />
        )}
      </section>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, hint, tone }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-3" title={hint || undefined}>
      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        {Icon && <Icon size={14} />}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-400' : ''}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] px-2 py-1.5">
      <div style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-3">
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function BarRow({ label, value, max, text, sub }) {
  const pct = Math.max(2, Math.round((Math.max(0, value) / (max || 1)) * 100))
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="truncate">{label}</span>
        <span className="tabular-nums font-semibold">{text}</span>
      </div>
      <div className="mt-1 h-1.5 rounded bg-[var(--border-subtle)]">
        <div className="h-1.5 rounded bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
      {sub && <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  )
}
