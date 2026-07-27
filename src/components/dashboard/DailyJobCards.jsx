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
  if (!loading && !snap) return null

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
          <button onClick={load} disabled={loading}
            className="btn-secondary text-xs px-2 py-1 inline-flex items-center gap-1 disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="card text-sm text-red-400">{error}</div>
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
            <div className="card overflow-x-auto">
              <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                Out of production now, longest first
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                    <th className="py-2 pr-3 font-semibold">Asset</th>
                    <th className="py-2 px-3 font-semibold">Job card</th>
                    <th className="py-2 px-3 font-semibold">Site</th>
                    <th className="py-2 px-3 font-semibold">Complaint</th>
                    <th className="py-2 px-3 font-semibold text-right">Down for</th>
                    <th className="py-2 pl-3 font-semibold">State</th>
                  </tr>
                </thead>
                <tbody>
                  {stillOut.map((r) => (
                    <tr key={r.work_order_no} className="border-b border-[var(--hairline)]/60">
                      <td className="py-2 pr-3">
                        <Link to={`/assets/${encodeURIComponent(r.asset_no || '')}`}
                          className="text-[var(--text-primary)] font-medium hover:text-[var(--accent)]">
                          {r.asset_no || 'N/A'}
                        </Link>
                        {r.plate_no ? <span className="text-[11px] text-[var(--text-dim)] ml-1.5">{r.plate_no}</span> : null}
                      </td>
                      <td className="py-2 px-3 text-[var(--text-secondary)]">{r.work_order_no}</td>
                      <td className="py-2 px-3 text-[var(--text-secondary)]">{r.site || 'N/A'}</td>
                      <td className="py-2 px-3 text-[var(--text-tertiary)] max-w-[280px] truncate" title={r.complaint || ''}>
                        {r.complaint || 'N/A'}
                      </td>
                      <td className={`py-2 px-3 text-right font-medium ${
                        Number(r.hours_out) > 48 ? 'text-red-400' : 'text-[var(--text-primary)]'}`}>
                        {dur(r.hours_out)}
                      </td>
                      <td className="py-2 pl-3">
                        {/* Not started is the actionable state: it is queueing, not being fixed */}
                        {r.not_started
                          ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">Not started</span>
                          : <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">In workshop</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
