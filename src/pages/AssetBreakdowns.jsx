/**
 * Breakdown Register - which machines are down, why, and for how long.
 *
 * The owner's monthly asset sheet has always carried a breakdown tab beside the
 * master list, and none of it reached the system: the register could say a
 * machine was "BREAKDOWN" but not what was wrong with it, how long it had been
 * down, who was fixing it, or whether it had missed the date it was promised
 * back. That is the difference between knowing availability is poor and being
 * able to do something about it.
 *
 * Every number on this page is computed over the FILTERED rows, so the tiles and
 * the table always describe the same machines. All arithmetic lives in the pure
 * engine `src/lib/assetBreakdowns.js` - the export and the tests read the same
 * functions, so a figure on screen and the same figure in Excel cannot drift.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Wrench, Clock, RefreshCw, Filter, X, Plus, Download,
  FileText, CheckCircle2, RotateCcw, Search, MapPin, Timer,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmptyState from '../components/EmptyState'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listAssetBreakdowns, saveAssetBreakdown, markReturnedToService,
  reopenAssetBreakdown,
} from '../lib/api/assetBreakdowns'
import {
  EMPTY_BREAKDOWN_FILTERS, filterBreakdowns, breakdownSummary, severityBands,
  byGroup, repeatOffenders, breakdownFindings, breakdownExportRows,
} from '../lib/assetBreakdowns'
import {
  breakdownRegisterRows, breakdownSiteOptions, activeBreakdownFilterCount, siteBars,
  overdueShare, NOT_RECORDED,
} from '../lib/assetBreakdownsAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

// Finding tones as classes, not hex: every text-*-300 here has an html.light
// override in index.css, so the message keeps contrast on a white page. The
// old inline #fca5a5 / #fcd34d / #93c5fd washed out to near-invisible there.
const TONE_CLASS = {
  danger: 'bg-red-500/10 border-red-500/40 text-red-300',
  warning: 'bg-amber-500/10 border-amber-500/40 text-amber-300',
  info: 'bg-sky-500/10 border-sky-500/40 text-sky-300',
}

const SEVERITY_TONE = {
  critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#22c55e',
}

/**
 * A headline number that doubles as a filter.
 *
 * Three utilities on the old `.card` version were DEAD the moment this became a
 * Card, and one of them was invisible: `p-4` (Card sets padding inline, so it is
 * `pad="tight"` now, which is the same 1rem) and `hover:border-white/20` - a
 * variant prefix does not save a class from an inline declaration, so the hover
 * cue simply never rendered. `interactive` replaces it and adds the
 * focus-visible ring the hand-rolled version never had.
 *
 * The selected border stays an inline `borderColor`, not a class and not the
 * tone prop, because it must beat Card's own inline border. It is applied ONLY
 * when active: passing `borderColor: undefined` would delete Card's value and
 * drop the border back to currentColor.
 */
function Tile({ label, value, sub, icon: Icon, active, onClick, tone }) {
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Card
      as={Cmp}
      onClick={onClick}
      pad="tight"
      interactive={!!onClick}
      className="text-left w-full"
      style={active ? { borderColor: 'var(--accent)' } : undefined}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        {Icon && <Icon className="w-4 h-4" style={{ color: tone || 'var(--text-dim)' }} />}
      </div>
      <div className="text-2xl font-semibold" style={{ color: tone || 'var(--text-primary)' }}>
        {value === null || value === undefined ? 'N/A' : value}
      </div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{sub}</div>}
    </Card>
  )
}

const BLANK_FORM = {
  asset_no: '', site: '', details: '', reported_on: '', expected_return: '',
  repair_location: '', remark: '', breakdown_days: '',
}

export default function AssetBreakdowns() {
  const { country } = useSettings()
  const { role, isSuperAdmin } = useAuth()
  const canEdit = isSuperAdmin || ['Admin', 'Manager', 'Director'].includes(role)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [filters, setFilters] = useState(EMPTY_BREAKDOWN_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [returning, setReturning] = useState(null)
  const [reopening, setReopening] = useState(null)

  // One clock for the whole render, so every "days down" on screen is measured
  // from the same instant rather than drifting row by row.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    setLoading(true); setError(''); setUnavailable(false)
    try {
      const res = await listAssetBreakdowns({ country })
      if (!res.ok) { setUnavailable(true); setRows([]) } else setRows(res.rows)
      setNow(Date.now())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the breakdown register.'))
    } finally { setLoading(false) }
  }, [country])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => filterBreakdowns(rows, filters, now), [rows, filters, now])
  const summary = useMemo(() => breakdownSummary(filtered, now), [filtered, now])
  const bands = useMemo(() => severityBands(filtered, now), [filtered, now])
  const bySite = useMemo(() => siteBars(byGroup(filtered, 'site', now)), [filtered, now])
  const repeats = useMemo(() => repeatOffenders(rows, now), [rows, now])
  // The chip strip names the worst 20 repeat machines; the full list is a
  // search away (each chip filters the register to that asset).
  const repeatChips = useMemo(() => repeats.slice(0, 20), [repeats])
  const findings = useMemo(() => breakdownFindings(filtered, summary, now), [filtered, summary, now])
  const siteOptions = useMemo(() => breakdownSiteOptions(rows), [rows])
  const activeFilterCount = activeBreakdownFilterCount(filters)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  // Longest down first; unmeasurable downtime sorts last, never as zero.
  const sorted = useMemo(() => breakdownRegisterRows(filtered, now), [filtered, now])
  const lateShare = overdueShare(summary)
  // A failed read must not look like an empty register.
  const failed = Boolean(error)

  const doExport = async (kind) => {
    const { columns, headers, rows: out } = breakdownExportRows(sorted, now)
    const name = reportFileName('TyrePulse Breakdown Register')
    try {
      if (kind === 'excel') await exportToExcel(out, columns, headers, name)
      else await exportToPdf(out, columns.map((k, i) => ({ key: k, header: headers[i] })), 'Breakdown Register', name, 'landscape')
    } catch (e) {
      setNotice(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setFormError('')
    try {
      await saveAssetBreakdown({ ...form, country: form.country || country })
      setForm(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save this breakdown.'))
    } finally { setBusy(false) }
  }

  const doReturn = async () => {
    if (!returning?.returned_on) return
    setBusy(true)
    try {
      await markReturnedToService(returning.id, returning.returned_on, returning.remark)
      setReturning(null)
      await load()
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not record the return to service.'))
    } finally { setBusy(false) }
  }

  // Reopening used to be a bare `.then(load)` with no catch, so a refused write
  // failed silently and the row simply stayed closed. It now has its own busy
  // guard per row and reports a failure in words.
  const doReopen = useCallback(async (id) => {
    setReopening(id)
    try {
      await reopenAssetBreakdown(id)
      await load()
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not reopen this breakdown.'))
    } finally { setReopening(null) }
  }, [load])

  const columns = useMemo(() => [
    {
      id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 120,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 font-medium text-[var(--text-primary)]">
          {row.original._severity && <span className="w-2 h-2 rounded-full" style={{ background: SEVERITY_TONE[row.original._severity] }} aria-hidden="true" />}
          {row.original.asset_no}
        </span>
      ),
    },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || '', size: 120, cell: ({ getValue }) => getValue() || NOT_RECORDED },
    {
      id: 'fault', header: 'Fault', accessorFn: (r) => r.details || '', size: 280,
      cell: ({ getValue }) => <span className="block max-w-md text-[var(--text-secondary)]">{getValue() || NOT_RECORDED}</span>,
    },
    {
      id: 'down', header: 'Days down', accessorFn: (r) => r._down, size: 110, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => (
        <span className={`tabular-nums ${row.original._down == null ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>{row.original._downLabel}</span>
      ),
    },
    {
      id: 'expected', header: 'Expected back', accessorFn: (r) => r.expected_return || '', size: 140,
      cell: ({ row }) => {
        const r = row.original
        return (
          <span className={r._overdue ? 'text-red-400' : 'text-[var(--text-secondary)]'}>
            {r.expected_return || 'Not stated'}
            {r._returnLabel && <span className="block text-[11px]">{r._returnLabel}</span>}
          </span>
        )
      },
    },
    { id: 'repair', header: 'Repaired at', accessorFn: (r) => r._repairLabel, size: 140 },
    { id: 'state', header: 'State', accessorFn: (r) => r._state, size: 140 },
    { id: 'note', header: 'Note', accessorFn: (r) => r.remark || '', size: 180, cell: ({ getValue }) => <span className="text-[11px] text-[var(--text-dim)]">{getValue()}</span> },
    {
      id: 'actions', header: '', enableSorting: false, size: 170, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        if (!canEdit) return null
        return (
          <div className="flex justify-end">
            {r.returned_to_service ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); doReopen(r.id) }} disabled={reopening === r.id}
                className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[44px]" aria-label={`Reopen breakdown for ${r.asset_no}`}>
                <RotateCcw className="w-3 h-3" aria-hidden="true" /> {reopening === r.id ? 'Reopening...' : 'Reopen'}
              </button>
            ) : (
              <button type="button" onClick={(e) => { e.stopPropagation(); setReturning({ id: r.id, asset_no: r.asset_no, returned_on: '', remark: r.remark || '' }) }}
                className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[44px]" aria-label={`Mark ${r.asset_no} back in service`}>
                <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Back in service
              </button>
            )}
          </div>
        )
      },
    },
  ], [canEdit, doReopen, reopening])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Breakdown Register"
        subtitle="Machines out of service, what is wrong with them, and how long they have been down"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={load} disabled={loading} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              aria-expanded={showFilters}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"
            >
              <Filter className="w-4 h-4" aria-hidden="true" />
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </button>
            <button type="button" onClick={() => doExport('excel')} disabled={!sorted.length}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <Download className="w-4 h-4" aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} disabled={!sorted.length}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <FileText className="w-4 h-4" aria-hidden="true" /> PDF
            </button>
            {canEdit && (
              <button type="button" onClick={() => { setFormError(''); setForm({ ...BLANK_FORM }) }} disabled={unavailable}
                className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
                <Plus className="w-4 h-4" aria-hidden="true" /> Report a breakdown
              </button>
            )}
          </div>
        )}
      />

      {/* `p-4` was dead here (Card pads inline) - `pad="tight"` is the same
          1rem. The red edge moves to `tone`, which is the one route that
          reaches the border. Row direction is inline for the same reason:
          Card is `flex flex-col` and a plain `flex-row` loses. */}
      {error && (
        <Card tone="crit" pad="tight" className="items-start justify-between gap-3 flex-wrap"
          style={{ flexDirection: 'row' }}>
          <div role="alert">
            <p className="text-sm font-medium text-red-300">Could not load the breakdown register.</p>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{error} The figures on this page are unavailable until it loads.</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-xs min-h-[44px]">Retry</button>
        </Card>
      )}

      {notice && (
        <Card pad="tight" className="items-start justify-between gap-3" style={{ flexDirection: 'row' }}>
          <p className="text-sm text-amber-300" role="status">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)]" aria-label="Dismiss message">
            <X className="w-4 h-4" />
          </button>
        </Card>
      )}

      {/* Not `clip`: the only out-of-flow content here is a native <select>,
          whose option list the browser paints outside the page's overflow
          context, so a card can never cut it off. */}
      {showFilters && (
        <Card pad="tight">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Search</span>
              <div className="relative mt-1">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} aria-hidden="true" />
                <input
                  value={filters.search}
                  onChange={(e) => setFilter('search', e.target.value)}
                  placeholder="Asset, fault or note"
                  className="input w-full pl-8 min-h-[44px]"
                />
              </div>
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Site</span>
              <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)}
                className="input w-full mt-1 min-h-[44px]">
                <option value="">All sites</option>
                {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Repaired at</span>
              <select value={filters.repairLocation} onChange={(e) => setFilter('repairLocation', e.target.value)}
                className="input w-full mt-1 min-h-[44px]">
                <option value="">Anywhere</option>
                <option value="In">In-house workshop</option>
                <option value="Out">Outside workshop</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>State</span>
              <select value={filters.state} onChange={(e) => setFilter('state', e.target.value)}
                className="input w-full mt-1 min-h-[44px]">
                <option value="open">Currently down</option>
                <option value="overdue">Past the promised date</option>
                <option value="returned">Back in service</option>
                <option value="all">Everything recorded</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
            <p className="text-[11px]" style={{ color: 'var(--text-dim)' }} aria-live="polite">
              Showing {filtered.length} of {rows.length} recorded breakdowns.
            </p>
            <button type="button" onClick={() => setFilters(EMPTY_BREAKDOWN_FILTERS)}
              className="btn-secondary text-xs inline-flex items-center gap-1 min-h-[44px]">
              <X className="w-3 h-3" aria-hidden="true" /> Clear filters
            </button>
          </div>
        </Card>
      )}

      {unavailable ? (
        <EmptyState
          icon={Wrench}
          title="Breakdown register not available"
          description="This workspace has not been set up for breakdown tracking yet. Nothing has been lost - once the register is provisioned, breakdowns recorded on the monthly asset sheet appear here."
        />
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Machines down" value={failed || loading ? null : summary.open} icon={Wrench}
              sub={!failed && summary.assets ? `${summary.assets} distinct assets` : null}
              tone={summary.open ? SEVERITY_TONE.high : undefined}
              active={filters.state === 'open'}
              onClick={() => setFilter('state', 'open')} />
            <Tile label="Past promised date" value={failed || loading ? null : summary.overdue} icon={AlertTriangle}
              sub={lateShare == null || failed ? null : `${lateShare}% of machines down`}
              tone={summary.overdue ? SEVERITY_TONE.critical : undefined}
              active={filters.state === 'overdue'}
              onClick={() => setFilter('state', 'overdue')} />
            <Tile label="Average days down" value={failed || loading ? null : summary.avgDownDays} icon={Clock}
              sub={summary.avgDownDays == null ? (failed ? null : 'Nothing measurable is down') : 'Across machines down now'} />
            <Tile label="Longest down" value={failed || loading ? null : summary.worst} icon={Timer}
              sub={summary.worst == null ? null : 'days'} />
            <Tile label="At outside workshop" value={failed || loading ? null : summary.outsideWorkshop} icon={MapPin}
              active={filters.repairLocation === 'Out'}
              onClick={() => setFilter('repairLocation', filters.repairLocation === 'Out' ? '' : 'Out')} />
            <Tile label="Waiting for parts" value={failed || loading ? null : summary.waitingParts} icon={Clock}
              sub="Held by supply, not workshop" />
          </div>

          {!failed && findings.length > 0 && (
            <Card pad="tight" className="space-y-2">
              <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>What needs attention</h2>
              {findings.map((f, i) => (
                <div key={i} className={`rounded-lg px-3 py-2 text-sm border ${TONE_CLASS[f.tone] || TONE_CLASS.info}`}>
                  {f.text}
                </div>
              ))}
            </Card>
          )}

          {!failed && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card pad="tight">
                <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>How long they have been down</h2>
                {bands.every((b) => !b.count) ? (
                  <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No machines are down in this view.</p>
                ) : bands.map((b) => (
                  <button type="button" key={b.key}
                    onClick={() => setFilter('severity', filters.severity === b.key ? '' : b.key)}
                    aria-pressed={filters.severity === b.key}
                    className={`w-full flex items-center gap-3 px-2 min-h-[44px] text-left rounded-lg hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${filters.severity === b.key ? 'bg-[var(--input-bg)]' : ''}`}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEVERITY_TONE[b.key] }} aria-hidden="true" />
                    <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>{b.label}</span>
                    <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>{b.count}</span>
                  </button>
                ))}
              </Card>

              <Card pad="tight">
                <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Where they are down</h2>
                {!bySite.length ? (
                  <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Nothing to show in this view.</p>
                ) : bySite.map((g) => (
                  <button type="button" key={g.key}
                    onClick={() => setFilter('site', filters.site === g.key ? '' : g.key)}
                    aria-pressed={filters.site === g.key}
                    className={`w-full text-left px-2 py-1.5 min-h-[44px] rounded-lg hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${filters.site === g.key ? 'bg-[var(--input-bg)]' : ''}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{g.key}</span>
                      <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{g.days} days lost</span>
                      <span className="text-sm font-medium w-8 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{g.count}</span>
                    </div>
                    <div className="h-1.5 mt-1 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                      <div className="h-full rounded-full" style={{ width: `${g.widthPct}%`, background: 'var(--accent)' }} />
                    </div>
                  </button>
                ))}
              </Card>
            </div>
          )}

          {!failed && repeats.length > 0 && (
            <Card pad="tight">
              <h2 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Machines that keep breaking down</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--text-dim)' }}>
                Counted over every breakdown recorded, not just the current view - a repeat is what separates a bad day from a bad machine.
              </p>
              <div className="flex flex-wrap gap-2">
                {repeatChips.map((a) => (
                  <button type="button" key={a.asset_no}
                    onClick={() => setFilters({ ...EMPTY_BREAKDOWN_FILTERS, state: 'all', search: a.asset_no })}
                    className="px-3 min-h-[44px] rounded-lg text-xs hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                    style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}>
                    {a.asset_no}, {a.breakdowns} times, {a.days} days
                  </button>
                ))}
              </div>
            </Card>
          )}

          <EnterpriseTable
            columns={columns}
            data={sorted}
            getRowId={(r) => String(r.id)}
            loading={loading}
            error={failed ? error : null}
            onRetry={load}
            enableExport={false}
            searchPlaceholder="Search this view"
            initialPageSize={25}
            viewKey="asset-breakdowns"
            emptyMessage={rows.length
              ? 'No breakdown matches these filters.'
              : 'No breakdown has been recorded yet.'}
          />
        </>
      )}

      {/* This overlay had NO backdrop close, NO X and NO Escape - the only way
          out was a Cancel button that stayed live while a save was in flight,
          so a record could be dismissed mid-write with no way to learn whether
          it had been written. Modal supplies all three close paths and every
          one of them, plus Cancel, now runs through the same `busy` guard.
          `submit` clears `busy` in a `finally`, so this can never become
          unclosable. The submit button stays inside the form. */}
      {form && (
        <Modal
          open
          onClose={() => { if (!busy) setForm(null) }}
          title="Report a breakdown"
          size="md"
        >
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Asset number</span>
                <input required value={form.asset_no} onChange={(e) => setForm({ ...form, asset_no: e.target.value })}
                  className="input w-full mt-1" placeholder="TM422" />
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Site</span>
                <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })}
                  className="input w-full mt-1" list="bd-sites" />
                <datalist id="bd-sites">{siteOptions.map((s) => <option key={s} value={s} />)}</datalist>
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Down since</span>
                <input required type="date" value={form.reported_on}
                  onChange={(e) => setForm({ ...form, reported_on: e.target.value })} className="input w-full mt-1" />
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Expected back</span>
                <input type="date" value={form.expected_return}
                  onChange={(e) => setForm({ ...form, expected_return: e.target.value })} className="input w-full mt-1" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>What is wrong</span>
                <textarea required rows={3} value={form.details}
                  onChange={(e) => setForm({ ...form, details: e.target.value })} className="input w-full mt-1" />
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Repaired at</span>
                <select value={form.repair_location} onChange={(e) => setForm({ ...form, repair_location: e.target.value })}
                  className="input w-full mt-1">
                  <option value="">Not decided</option>
                  <option value="In">In-house workshop</option>
                  <option value="Out">Outside workshop</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Note</span>
                <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })}
                  className="input w-full mt-1" placeholder="Waiting spare parts" />
              </label>
            </div>
            {formError && <p className="text-sm text-red-300" role="alert">{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => { if (!busy) setForm(null) }} disabled={busy} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary text-sm">
                {busy ? 'Saving...' : 'Record breakdown'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Form-less confirm, so the buttons belong in `footer`. Same story as
          the dialog above: the hand-rolled version offered only an unguarded
          Cancel, and `doReturn` clears `busy` in a `finally`. */}
      {returning && (
        <Modal
          open
          onClose={() => { if (!busy) setReturning(null) }}
          title={`${returning.asset_no} back in service`}
          size="sm"
          footer={(
            <>
              <button onClick={() => { if (!busy) setReturning(null) }} disabled={busy} className="btn-secondary text-sm">Cancel</button>
              <button onClick={doReturn} disabled={busy || !returning.returned_on} className="btn-primary text-sm">
                {busy ? 'Saving...' : 'Confirm return'}
              </button>
            </>
          )}
        >
          <div className="space-y-3">
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
              Enter the day it actually returned, not today. Recording it late would make the downtime read shorter than it was.
            </p>
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Returned on</span>
              <input required type="date" value={returning.returned_on}
                onChange={(e) => setReturning({ ...returning, returned_on: e.target.value })}
                className="input w-full mt-1" />
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}
