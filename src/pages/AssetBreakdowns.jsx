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
  downDays, daysToReturn, isOverdue, severityOf, repairLabel,
} from '../lib/assetBreakdowns'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const TONE = {
  danger: { bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.30)', text: '#fca5a5' },
  warning: { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.30)', text: '#fcd34d' },
  info: { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.30)', text: '#93c5fd' },
}

const SEVERITY_TONE = {
  critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#22c55e',
}

function Tile({ label, value, sub, icon: Icon, active, onClick, tone }) {
  const Cmp = onClick ? 'button' : 'div'
  return (
    <Cmp
      onClick={onClick}
      className={`card p-4 text-left w-full ${onClick ? 'hover:border-white/20 transition-colors' : ''}`}
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
    </Cmp>
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
  const [unavailable, setUnavailable] = useState(false)
  const [filters, setFilters] = useState(EMPTY_BREAKDOWN_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [returning, setReturning] = useState(null)

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
  const bySite = useMemo(() => byGroup(filtered, 'site', now), [filtered, now])
  const repeats = useMemo(() => repeatOffenders(rows, now), [rows, now])
  const findings = useMemo(() => breakdownFindings(filtered, summary, now), [filtered, summary, now])

  const siteOptions = useMemo(
    () => [...new Set(rows.map((r) => r?.site).filter(Boolean))].sort(),
    [rows],
  )

  const activeFilterCount = useMemo(
    () => Object.entries(filters).filter(([k, v]) => (k === 'state' ? v !== 'open' : !!v)).length,
    [filters],
  )
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (downDays(b, now) || 0) - (downDays(a, now) || 0)),
    [filtered, now],
  )

  const doExportExcel = () => {
    const { columns, headers, rows: out } = breakdownExportRows(sorted, now)
    exportToExcel(out, columns, headers, reportFileName('TyrePulse Breakdown Register'))
  }

  const doExportPdf = () => {
    const { columns, headers, rows: out } = breakdownExportRows(sorted, now)
    exportToPdf(
      out,
      columns.map((k, i) => ({ key: k, header: headers[i] })),
      'Breakdown Register',
      reportFileName('TyrePulse Breakdown Register'),
      'landscape',
    )
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
      setError(toUserMessage(err, 'Could not record the return to service.'))
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Breakdown Register"
        subtitle="Machines out of service, what is wrong with them, and how long they have been down"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button
              onClick={() => setShowFilters((s) => !s)}
              className="btn-secondary text-sm inline-flex items-center gap-1.5"
            >
              <Filter className="w-4 h-4" />
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
            </button>
            <button onClick={doExportExcel} disabled={!sorted.length}
              className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <Download className="w-4 h-4" /> Excel
            </button>
            <button onClick={doExportPdf} disabled={!sorted.length}
              className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <FileText className="w-4 h-4" /> PDF
            </button>
            {canEdit && (
              <button onClick={() => { setFormError(''); setForm({ ...BLANK_FORM }) }}
                className="btn-primary text-sm inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Report a breakdown
              </button>
            )}
          </div>
        )}
      />

      {error && (
        <div className="card p-4 flex items-start justify-between gap-3"
          style={{ background: TONE.danger.bg, borderColor: TONE.danger.border }}>
          <p className="text-sm" style={{ color: TONE.danger.text }}>{error}</p>
          <button onClick={load} className="btn-secondary text-xs">Retry</button>
        </div>
      )}

      {showFilters && (
        <div className="card p-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Search</span>
              <div className="relative mt-1">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5" style={{ color: 'var(--text-dim)' }} />
                <input
                  value={filters.search}
                  onChange={(e) => setFilter('search', e.target.value)}
                  placeholder="Asset, fault or note"
                  className="input w-full pl-8"
                />
              </div>
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Site</span>
              <select value={filters.site} onChange={(e) => setFilter('site', e.target.value)}
                className="input w-full mt-1">
                <option value="">All sites</option>
                {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Repaired at</span>
              <select value={filters.repairLocation} onChange={(e) => setFilter('repairLocation', e.target.value)}
                className="input w-full mt-1">
                <option value="">Anywhere</option>
                <option value="In">In-house workshop</option>
                <option value="Out">Outside workshop</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>State</span>
              <select value={filters.state} onChange={(e) => setFilter('state', e.target.value)}
                className="input w-full mt-1">
                <option value="open">Currently down</option>
                <option value="overdue">Past the promised date</option>
                <option value="returned">Back in service</option>
                <option value="all">Everything recorded</option>
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between mt-3">
            <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
              Showing {filtered.length} of {rows.length} recorded breakdowns.
            </p>
            <button onClick={() => setFilters(EMPTY_BREAKDOWN_FILTERS)}
              className="btn-secondary text-xs inline-flex items-center gap-1">
              <X className="w-3 h-3" /> Clear filters
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          Loading the breakdown register...
        </div>
      ) : unavailable ? (
        <EmptyState
          icon={Wrench}
          title="Breakdown register not available"
          description="This workspace has not been set up for breakdown tracking yet. Nothing has been lost - once the register is provisioned, breakdowns recorded on the monthly asset sheet appear here."
        />
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <Tile label="Machines down" value={summary.open} icon={Wrench}
              sub={summary.assets ? `${summary.assets} distinct assets` : null}
              tone={summary.open ? SEVERITY_TONE.high : undefined}
              active={filters.state === 'open'}
              onClick={() => setFilter('state', 'open')} />
            <Tile label="Past promised date" value={summary.overdue} icon={AlertTriangle}
              tone={summary.overdue ? SEVERITY_TONE.critical : undefined}
              active={filters.state === 'overdue'}
              onClick={() => setFilter('state', 'overdue')} />
            <Tile label="Average days down" value={summary.avgDownDays} icon={Clock}
              sub={summary.avgDownDays == null ? 'Nothing is down' : 'Across machines down now'} />
            <Tile label="Longest down" value={summary.worst} icon={Timer}
              sub={summary.worst == null ? null : 'days'} />
            <Tile label="At outside workshop" value={summary.outsideWorkshop} icon={MapPin}
              active={filters.repairLocation === 'Out'}
              onClick={() => setFilter('repairLocation', filters.repairLocation === 'Out' ? '' : 'Out')} />
            <Tile label="Waiting for parts" value={summary.waitingParts} icon={Clock}
              sub="Held by supply, not workshop" />
          </div>

          {findings.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>What needs attention</h3>
              {findings.map((f, i) => (
                <div key={i} className="rounded-lg px-3 py-2 text-sm"
                  style={{ background: TONE[f.tone]?.bg, border: `1px solid ${TONE[f.tone]?.border}`, color: TONE[f.tone]?.text }}>
                  {f.text}
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>How long they have been down</h3>
              {bands.every((b) => !b.count) ? (
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>No machines are down in this view.</p>
              ) : bands.map((b) => (
                <button key={b.key}
                  onClick={() => setFilter('severity', filters.severity === b.key ? '' : b.key)}
                  className="w-full flex items-center gap-3 py-1.5 text-left">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEVERITY_TONE[b.key] }} />
                  <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>{b.label}</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{b.count}</span>
                </button>
              ))}
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Where they are down</h3>
              {!bySite.length ? (
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Nothing to show in this view.</p>
              ) : bySite.slice(0, 8).map((g) => (
                <button key={g.key}
                  onClick={() => setFilter('site', filters.site === g.key ? '' : g.key)}
                  className="w-full flex items-center gap-3 py-1.5 text-left">
                  <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{g.key}</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{g.days} days lost</span>
                  <span className="text-sm font-medium w-8 text-right" style={{ color: 'var(--text-primary)' }}>{g.count}</span>
                </button>
              ))}
            </div>
          </div>

          {repeats.length > 0 && (
            <div className="card p-4">
              <h3 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Machines that keep breaking down</h3>
              <p className="text-[11px] mb-3" style={{ color: 'var(--text-dim)' }}>
                Counted over every breakdown recorded, not just the current view - a repeat is what separates a bad day from a bad machine.
              </p>
              <div className="flex flex-wrap gap-2">
                {repeats.slice(0, 20).map((a) => (
                  <button key={a.asset_no}
                    onClick={() => setFilters({ ...EMPTY_BREAKDOWN_FILTERS, state: 'all', search: a.asset_no })}
                    className="px-2.5 py-1 rounded-lg text-xs"
                    style={{ background: 'var(--panel-2)', color: 'var(--text-secondary)' }}>
                    {a.asset_no} · {a.breakdowns} times · {a.days} days
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--panel-2)' }}>
                    {['Asset', 'Site', 'Fault', 'Days down', 'Expected back', 'Repaired at', 'Note', ''].map((h) => (
                      <th key={h} className="text-left px-3 py-2 text-xs font-medium"
                        style={{ color: 'var(--text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!sorted.length ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-sm" style={{ color: 'var(--text-dim)' }}>
                        {rows.length
                          ? 'No breakdown matches these filters.'
                          : 'No breakdown has been recorded yet.'}
                      </td>
                    </tr>
                  ) : sorted.map((r) => {
                    const d = downDays(r, now)
                    const dtr = daysToReturn(r, now)
                    const overdue = isOverdue(r, now)
                    const sev = severityOf(r, now)
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                          <span className="inline-flex items-center gap-2">
                            {sev && <span className="w-2 h-2 rounded-full" style={{ background: SEVERITY_TONE[sev] }} />}
                            {r.asset_no}
                          </span>
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{r.site || 'Not recorded'}</td>
                        <td className="px-3 py-2 max-w-md" style={{ color: 'var(--text-secondary)' }}>
                          {r.details || 'Not recorded'}
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{d ?? 'N/A'}</td>
                        <td className="px-3 py-2" style={{ color: overdue ? SEVERITY_TONE.critical : 'var(--text-secondary)' }}>
                          {r.expected_return || 'Not stated'}
                          {dtr != null && !r.returned_to_service && (
                            <span className="block text-[11px]">
                              {dtr < 0 ? `${Math.abs(dtr)} days late` : dtr === 0 ? 'due today' : `in ${dtr} days`}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{repairLabel(r.repair_location)}</td>
                        <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>{r.remark || ''}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {canEdit && (r.returned_to_service ? (
                            <button onClick={() => reopenAssetBreakdown(r.id).then(load)}
                              className="btn-secondary text-xs inline-flex items-center gap-1">
                              <RotateCcw className="w-3 h-3" /> Reopen
                            </button>
                          ) : (
                            <button onClick={() => setReturning({ id: r.id, asset_no: r.asset_no, returned_on: '', remark: r.remark || '' })}
                              className="btn-secondary text-xs inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Back in service
                            </button>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <form onSubmit={submit} className="card p-5 w-full max-w-lg space-y-3 max-h-[85vh] overflow-y-auto">
            <h3 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>Report a breakdown</h3>
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
            {formError && <p className="text-sm" style={{ color: TONE.danger.text }}>{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setForm(null)} className="btn-secondary text-sm">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary text-sm">
                {busy ? 'Saving...' : 'Record breakdown'}
              </button>
            </div>
          </form>
        </div>
      )}

      {returning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="card p-5 w-full max-w-md space-y-3">
            <h3 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
              {returning.asset_no} back in service
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
              Enter the day it actually returned, not today. Recording it late would make the downtime read shorter than it was.
            </p>
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Returned on</span>
              <input required type="date" value={returning.returned_on}
                onChange={(e) => setReturning({ ...returning, returned_on: e.target.value })}
                className="input w-full mt-1" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setReturning(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={doReturn} disabled={busy || !returning.returned_on} className="btn-primary text-sm">
                {busy ? 'Saving...' : 'Confirm return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
