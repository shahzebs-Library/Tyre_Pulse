/**
 * Today's job cards, for the front page.
 *
 * The headline is not "how many jobs" but WHAT IS STILL DOWN. An asset that
 * left production and has not come back is the number a plant manager needs
 * first thing, and nothing in the app surfaced it before the job card export
 * brought in the Production Out / Production In pair.
 *
 * Waiting time is shown separately from repair time on purpose. They have
 * different owners: waiting is a scheduling problem, repair is a workshop one,
 * and a single "downtime" figure hides which of the two is actually costing the
 * fleet its availability.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Wrench, AlertTriangle, Clock, CheckCircle2, RefreshCw, ArrowRight, Timer,
} from 'lucide-react'
import { getDailyJobCards } from '../../lib/api/jobCards'
import { toUserMessage } from '../../lib/safeError'
import EnterpriseTable from '../ui/EnterpriseTable'
import { compareValues, isBlank } from '../../lib/consoleTable'

const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))
const blank = (v) => (isBlank(v) ? undefined : v)
const sortable = { sortingFn: valueSort, sortUndefined: 'last' }
const stateLabel = (r) => (r.not_started ? 'Not started' : 'In workshop')

const stillOutColumns = [
  {
    id: 'asset_no', header: 'Asset', accessorFn: (r) => blank(r.asset_no), ...sortable,
    meta: { exportValue: (r) => r.asset_no || 'N/A' },
    cell: ({ row: { original: r } }) => (
      <span>
        <Link to={`/asset-management/${encodeURIComponent(r.asset_no || '')}`}
          className="text-[var(--text-primary)] font-medium hover:text-[var(--accent)] hover:underline">
          {r.asset_no || 'N/A'}
        </Link>
        {r.plate_no ? <span className="text-[11px] text-[var(--text-dim)] ml-1.5">{r.plate_no}</span> : null}
      </span>
    ),
  },
  { id: 'work_order_no', header: 'Job card', accessorFn: (r) => blank(r.work_order_no), ...sortable },
  {
    id: 'site', header: 'Site', accessorFn: (r) => blank(r.site), ...sortable,
    meta: { filterVariant: 'select', exportValue: (r) => r.site || 'N/A' },
    cell: ({ getValue }) => getValue() || 'N/A',
  },
  {
    id: 'complaint', header: 'Complaint', accessorFn: (r) => blank(r.complaint), ...sortable,
    meta: { exportValue: (r) => r.complaint || 'N/A' },
    cell: ({ getValue }) => (
      <span className="block max-w-[280px] truncate text-[var(--text-tertiary)]" title={getValue() || ''}>{getValue() || 'N/A'}</span>
    ),
  },
  {
    id: 'hours_out', header: 'Down for', accessorFn: (r) => (Number.isFinite(Number(r.hours_out)) && r.hours_out != null ? Number(r.hours_out) : undefined),
    ...sortable, meta: { align: 'right', exportHeader: 'Down for', exportValue: (r) => dur(r.hours_out) },
    cell: ({ getValue }) => (
      <span className={`font-medium ${Number(getValue()) > 48 ? 'text-red-500' : 'text-[var(--text-primary)]'}`}>{dur(getValue())}</span>
    ),
  },
  {
    id: 'state', header: 'State', accessorFn: stateLabel, ...sortable,
    meta: { filterVariant: 'select' },
    // Not started is the actionable state: it is queueing, not being fixed
    cell: ({ row: { original: r } }) => (r.not_started
      ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">Not started</span>
      : <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-500">In workshop</span>),
  },
]

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Number(v).toLocaleString('en-US'))
/** Hours are meaningless past a couple of days; show what a person would say. */
const dur = (h) => {
  const n = Number(h)
  if (h == null || !Number.isFinite(n)) return 'N/A'
  if (n < 1) return `${Math.round(n * 60)} min`
  if (n < 48) return `${n.toFixed(1)} h`
  return `${Math.floor(n / 24)} d ${Math.round(n % 24)} h`
}

function Tile({ label, value, sub, tone = 'plain', icon: Icon }) {
  const tones = {
    plain: 'text-[var(--text-primary)]',
    bad: 'text-red-400',
    warn: 'text-amber-400',
    good: 'text-emerald-400',
  }
  return (
    <div className="card">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        {Icon ? <Icon size={12} /> : null} {label}
      </div>
      <p className={`text-2xl font-bold leading-tight mt-0.5 ${tones[tone] || tones.plain}`}>{value}</p>
      {sub ? <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p> : null}
    </div>
  )
}

export default function DailyJobCards({ country }) {
  const [snap, setSnap] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const res = await getDailyJobCards({ country })
      setSnap(res && res.ok ? res : null)
    } catch (e) {
      setError(toUserMessage(e, 'Could not load today’s job cards.'))
    } finally { setLoading(false) }
  }, [country])

  useEffect(() => { load() }, [load])

  const k = snap?.kpis
  const stillOut = useMemo(() => (Array.isArray(snap?.still_out_list) ? snap.still_out_list : []), [snap])

  // Nothing imported yet, or nothing to say. Better silent than an empty shell.
  // A failed read must say so (with Retry), never vanish as if nothing existed.
  if (!loading && !snap && !error) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
          <Wrench size={15} /> Job cards today
        </h2>
        <div className="flex items-center gap-2">
          <Link to="/workshop-live" className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1">
            Workshop board <ArrowRight size={12} />
          </Link>
          <button type="button" onClick={load} disabled={loading}
            className="btn-secondary text-xs px-3 min-h-[44px] inline-flex items-center gap-1 disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="card text-sm flex flex-wrap items-center gap-3" role="alert">
          <span className="text-red-500">{error}</span>
          <button type="button" onClick={load} className="btn-secondary text-xs px-3 min-h-[44px] inline-flex items-center gap-1">
            <RefreshCw size={12} aria-hidden="true" /> Retry
          </button>
        </div>
      ) : loading ? (
        <div className="card text-sm text-[var(--text-muted)]">Loading today&apos;s job cards.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Tile label="Still out of production" value={num(k?.still_out)}
              sub={k?.still_out_assets ? `${num(k.still_out_assets)} assets` : 'Nothing down'}
              tone={k?.still_out > 0 ? 'bad' : 'good'} icon={AlertTriangle} />
            <Tile label="Longest one down" value={dur(k?.longest_out_hours)}
              tone={Number(k?.longest_out_hours) > 48 ? 'bad' : 'plain'} icon={Timer} />
            <Tile label="Opened today" value={num(k?.opened_today)} icon={Wrench}
              sub={`${num(k?.breakdowns_today)} breakdown, ${num(k?.scheduled_today)} scheduled`} />
            <Tile label="Closed today" value={num(k?.closed_today)} tone="good" icon={CheckCircle2} />
            {/* Waiting is usually the bigger and more fixable half */}
            <Tile label="Avg wait before work" value={dur(k?.avg_wait_hours)} icon={Clock}
              tone={Number(k?.avg_wait_hours) > 4 ? 'warn' : 'plain'}
              sub="Production out to workshop in" />
            <Tile label="Avg repair time" value={dur(k?.avg_repair_hours)} icon={Wrench}
              sub="Workshop in to workshop out" />
          </div>

          {stillOut.length > 0 ? (
            <div className="card">
              <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                Out of production now, longest first
              </p>
              <EnterpriseTable
                columns={stillOutColumns}
                data={stillOut}
                getRowId={(r) => String(r.work_order_no)}
                initialPageSize={25}
                searchPlaceholder="Search asset, job card, site, complaint"
                exportFileName="Job Cards Out Of Production"
                reportMeta={{ title: 'Job cards out of production' }}
                emptyMessage="No job cards match this search."
              />
            </div>
          ) : (
            <div className="card text-sm text-[var(--text-muted)]">
              Nothing is out of production right now.
            </div>
          )}
        </>
      )}
    </section>
  )
}
