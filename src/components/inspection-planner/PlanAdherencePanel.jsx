import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Upload, RefreshCw, AlertTriangle, Loader2, Undo2, FileSpreadsheet, MapPin, Users, CalendarClock,
} from 'lucide-react'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel } from '../../lib/exportUtils'
import { addDays, todayStr } from '../../lib/inspectionPlanner'
import { summarizeAdherence, adherenceBy, PLAN_STATES, PLAN_STATE_META } from '../../lib/schedulePlan'
import {
  loadAdherence, loadPlanCoverage, loadUnplannedAssets, loadPlanFleet, loadPlanPeople,
  listPlanBatches, undoPlanBatch, reschedulePlan,
} from '../../lib/api/schedulePlanning'
import PlanUploadModal from './PlanUploadModal'

const TONE_CLASS = {
  good: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  danger: 'bg-red-500/10 text-red-600 border-red-500/30',
  warning: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  info: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  quiet: 'bg-[var(--input-bg)] text-[var(--text-dim)] border-[var(--input-border)]',
}

/**
 * Planning board: what was planned, what got done, what was missed, and which
 * vehicles the plan does not reach at all.
 *
 * Adherence is computed on the server from the inspections themselves, so a
 * plan can never sit on a stale status. This component groups and presents
 * what it is given and never re-derives a state locally.
 */
export default function PlanAdherencePanel({ country, profileId, canCreate, canEdit, canExport }) {
  const today = todayStr()
  const [from, setFrom] = useState(() => addDays(todayStr(), -30))
  const [to, setTo] = useState(() => addDays(todayStr(), 30))
  const [horizon, setHorizon] = useState(30)

  const [rows, setRows] = useState([])
  const [coverage, setCoverage] = useState([])
  const [gap, setGap] = useState({ rows: [], total: 0, truncated: false })
  const [batches, setBatches] = useState([])
  const [fleet, setFleet] = useState([])
  const [people, setPeople] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [stateFilter, setStateFilter] = useState('All')
  const [siteFilter, setSiteFilter] = useState('All')
  const [busyRow, setBusyRow] = useState('')

  const countryChosen = Boolean(country && country !== 'All')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [adherence, cover, unplanned, batchList] = await Promise.all([
        loadAdherence({ country, from, to }),
        loadPlanCoverage({ country, horizonDays: horizon }),
        loadUnplannedAssets({ country, horizonDays: horizon, limit: 300 }),
        listPlanBatches({ country }),
      ])
      setRows(adherence)
      setCoverage(cover)
      setGap(unplanned)
      setBatches(batchList)
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the plan board. Retry.'))
    } finally {
      setLoading(false)
    }
  }, [country, from, to, horizon])

  useEffect(() => { refresh() }, [refresh])

  // The fleet and staff lists are only needed to check an upload, so they are
  // fetched when the dialog opens rather than on every visit to the tab.
  const openUpload = useCallback(async () => {
    setError(''); setPreparing(true)
    try {
      const [fleetResult, peopleResult] = await Promise.all([
        loadPlanFleet({ country }),
        loadPlanPeople({ country }),
      ])
      setFleet(fleetResult.rows)
      setPeople(peopleResult.rows)
      setUploadOpen(true)
    } catch (err) {
      setError(toUserMessage(err, 'Could not load the fleet register for checking.'))
    } finally {
      setPreparing(false)
    }
  }, [country])

  const summary = useMemo(() => summarizeAdherence(rows), [rows])
  const bySite = useMemo(() => adherenceBy(rows, 'site'), [rows])
  const byPerson = useMemo(
    () => adherenceBy(rows, 'assigned_name', { fallback: 'Nobody assigned' }), [rows],
  )

  const siteOptions = useMemo(() => {
    const names = [...new Set(rows.map(row => String(row.site || '').trim()).filter(Boolean))].sort()
    return ['All', ...names]
  }, [rows])

  const visible = useMemo(() => rows.filter(row => {
    if (stateFilter !== 'All' && row.plan_state !== stateFilter) return false
    if (siteFilter !== 'All' && String(row.site || '') !== siteFilter) return false
    return true
  }), [rows, stateFilter, siteFilter])

  const exportBoard = useCallback(async () => {
    setError('')
    try {
      const columns = ['asset_no', 'site', 'scheduled_date', 'inspection_time', 'assigned_name', 'team',
        'inspection_type', 'priority', 'plan_state', 'matched_date', 'matched_inspector', 'days_late', 'plan_ref']
      const headers = ['Asset', 'Site', 'Planned date', 'Time', 'Assigned to', 'Team',
        'Type', 'Priority', 'State', 'Inspected on', 'Inspected by', 'Days late', 'Upload ref']
      await exportToExcel(visible, columns, headers, `inspection-plan-${from}-to-${to}`, 'Plan')
    } catch (err) {
      setError(toUserMessage(err, 'Could not build the export.'))
    }
  }, [visible, from, to])

  const undo = useCallback(async planRef => {
    setBusyRow(planRef); setError(''); setNotice('')
    try {
      const outcome = await undoPlanBatch(planRef, { country })
      setNotice(`${planRef}: withdrew ${outcome.removed} plans. ${outcome.reason || ''}`.trim())
      await refresh()
    } catch (err) {
      setError(toUserMessage(err, 'Could not undo that upload.'))
    } finally {
      setBusyRow('')
    }
  }, [country, refresh])

  const moveToTomorrow = useCallback(async row => {
    setBusyRow(row.id); setError(''); setNotice('')
    try {
      const next = addDays(today, 1)
      await reschedulePlan(row.id, next)
      setNotice(`${row.asset_no} moved to ${next}.`)
      await refresh()
    } catch (err) {
      setError(toUserMessage(err, 'Could not move that plan.'))
    } finally {
      setBusyRow('')
    }
  }, [today, refresh])

  return (
    <section className="space-y-4">
      <header className="card p-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-[var(--text-secondary)]">From</span>
            <input type="date" className="input" value={from} max={to} onChange={event => setFrom(event.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block text-[var(--text-secondary)]">To</span>
            <input type="date" className="input" value={to} min={from} onChange={event => setTo(event.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block text-[var(--text-secondary)]">Coverage horizon</span>
            <select className="input" value={horizon} onChange={event => setHorizon(Number(event.target.value))}>
              {[7, 14, 30, 60, 90].map(days => <option key={days} value={days}>Next {days} days</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Refresh
          </button>
          {canExport ? (
            <button type="button" className="btn-secondary" onClick={exportBoard} disabled={!visible.length}>
              <FileSpreadsheet size={16} /> Export
            </button>
          ) : null}
          {canCreate ? (
            <button type="button" className="btn-primary" onClick={openUpload} disabled={!countryChosen || preparing}>
              {preparing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload plan
            </button>
          ) : null}
        </div>
      </header>

      {!countryChosen ? (
        <p className="card p-3 text-sm text-[var(--text-secondary)]">
          Choose a single country to upload a plan. The board below still reads everything you can see.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="card p-3 text-sm text-[var(--danger,#dc2626)] flex flex-wrap items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{error}</span>
          <button type="button" className="btn-secondary py-0.5 px-2 text-xs" onClick={refresh}>Retry</button>
        </p>
      ) : null}

      {notice ? <p role="status" className="card p-3 text-sm">{notice}</p> : null}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Tile label="Planned" value={loading ? null : summary.planned} hint="In the chosen window" />
        <Tile label="Done" value={loading ? null : summary.Done} hint={`${summary.onTime} on the day`} />
        <Tile label="Missed" value={loading ? null : summary.Missed} tone="danger" hint="Window closed, no inspection" />
        <Tile label="Due now" value={loading ? null : summary.Due} hint="Inside its window today" />
        <Tile label="Upcoming" value={loading ? null : summary.Upcoming} hint="Still ahead" />
        <Tile
          label="Adherence"
          value={loading ? null : summary.adherence}
          suffix="%"
          tone={summary.adherence == null ? 'quiet' : summary.adherence >= 90 ? 'good' : summary.adherence >= 70 ? 'warning' : 'danger'}
          hint={summary.adherence == null ? 'Nothing has come due yet' : `${summary.Done} of ${summary.judged} judged`}
        />
      </div>

      <section className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold inline-flex items-center gap-2"><MapPin size={16} /> Plan coverage by site</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {gap.total} active {gap.total === 1 ? 'vehicle has' : 'vehicles have'} no plan in the next {horizon} days
          </p>
        </div>
        {loading ? <p className="text-sm text-[var(--text-secondary)]">Loading coverage.</p>
          : !coverage.length ? <p className="text-sm text-[var(--text-secondary)]">No active vehicles found for this scope.</p>
            : (
              <div className="overflow-auto max-h-72">
                <table className="w-full text-sm">
                  <caption className="sr-only">Active vehicles per site and how many are covered by a plan</caption>
                  <thead className="sticky top-0 bg-[var(--surface-raised,var(--panel))]">
                    <tr>
                      <th scope="col" className="text-start p-2 font-medium">Site</th>
                      <th scope="col" className="text-end p-2 font-medium">Active</th>
                      <th scope="col" className="text-end p-2 font-medium">Planned</th>
                      <th scope="col" className="text-end p-2 font-medium">Inspected recently</th>
                      <th scope="col" className="text-end p-2 font-medium">Never inspected</th>
                      <th scope="col" className="text-end p-2 font-medium">No plan, overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.map(row => (
                      <tr key={row.site} className="border-t border-[var(--hairline)]">
                        <td className="p-2 font-medium">{row.site}</td>
                        <td className="p-2 text-end">{row.active_assets}</td>
                        <td className="p-2 text-end">{row.planned_assets}</td>
                        <td className="p-2 text-end">{row.inspected_recently}</td>
                        <td className="p-2 text-end">{row.never_inspected}</td>
                        <td className={`p-2 text-end font-semibold ${row.overdue_assets ? 'text-[var(--danger,#dc2626)]' : ''}`}>
                          {row.overdue_assets}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        <p className="text-xs text-[var(--text-dim)]">
          Counted from the fleet register, so a vehicle nobody has ever inspected still appears here.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="By site" icon={<MapPin size={16} />} rows={bySite} loading={loading} />
        <Breakdown title="By person" icon={<Users size={16} />} rows={byPerson} loading={loading} />
      </div>

      <section className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Planned inspections</h3>
          <div className="flex flex-wrap gap-2">
            <select className="input" value={stateFilter} onChange={event => setStateFilter(event.target.value)} aria-label="Filter by state">
              <option value="All">All states</option>
              {PLAN_STATES.map(state => <option key={state} value={state}>{PLAN_STATE_META[state].label}</option>)}
            </select>
            <select className="input" value={siteFilter} onChange={event => setSiteFilter(event.target.value)} aria-label="Filter by site">
              {siteOptions.map(site => <option key={site} value={site}>{site === 'All' ? 'All sites' : site}</option>)}
            </select>
          </div>
        </div>

        {loading ? <p className="text-sm text-[var(--text-secondary)]">Loading plans.</p>
          : !rows.length ? (
            <div className="space-y-2">
              <p className="text-sm">No inspections are planned between {from} and {to}.</p>
              <p className="text-sm text-[var(--text-secondary)]">
                Inspections are still being recorded; they are simply not planned in advance, so nothing can
                be reported as missed yet. Upload a plan to start measuring adherence.
              </p>
            </div>
          )
            : !visible.length ? <p className="text-sm">No plans match these filters.</p>
              : (
                <div className="overflow-auto max-h-[28rem]">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Planned inspections and the inspection that fulfilled each one</caption>
                    <thead className="sticky top-0 bg-[var(--surface-raised,var(--panel))]">
                      <tr>
                        {['State', 'Asset', 'Site', 'Planned', 'Assigned to', 'Team', 'Inspected on', 'Late', ''].map((head, index) => (
                          <th key={head || index} scope="col" className="text-start p-2 font-medium whitespace-nowrap">{head}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(row => (
                        <tr key={row.id} className="border-t border-[var(--hairline)]">
                          <td className="p-2"><StateBadge state={row.plan_state} /></td>
                          <td className="p-2 font-medium">{row.asset_no}</td>
                          <td className="p-2">{row.site || '-'}</td>
                          <td className="p-2 whitespace-nowrap">{row.scheduled_date} {row.inspection_time || ''}</td>
                          <td className="p-2">
                            {row.assigned_name || row.inspector_name
                              || <span className="text-[var(--danger,#dc2626)]">Nobody assigned</span>}
                          </td>
                          <td className="p-2">{row.team || '-'}</td>
                          <td className="p-2 whitespace-nowrap">
                            {row.matched_date
                              ? <>{row.matched_date}{row.matched_inspector ? <span className="text-[var(--text-dim)]"> by {row.matched_inspector}</span> : null}</>
                              : '-'}
                          </td>
                          <td className="p-2 text-end">{row.days_late ? `${row.days_late}d` : '-'}</td>
                          <td className="p-2 text-end">
                            {canEdit && row.plan_state === 'Missed' ? (
                              <button
                                type="button" className="btn-secondary py-1 px-2 text-xs whitespace-nowrap"
                                onClick={() => moveToTomorrow(row)} disabled={busyRow === row.id}
                              >
                                {busyRow === row.id
                                  ? <Loader2 size={13} className="animate-spin" />
                                  : <CalendarClock size={13} />} Move to tomorrow
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

        <p className="text-xs text-[var(--text-dim)]">
          A plan counts as done when that vehicle has an inspection dated inside its window. Inspections are
          not linked back to a plan, so a visit made for another reason can close one.
        </p>
      </section>

      {batches.length ? (
        <section className="card p-4 space-y-2">
          <h3 className="font-semibold">Recent uploads</h3>
          <ul className="divide-y divide-[var(--hairline)]">
            {batches.map(batch => (
              <li key={batch.plan_ref} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <strong>{batch.plan_ref}</strong>
                  <span className="text-[var(--text-secondary)]"> · {batch.count} plans</span>
                </span>
                {canCreate ? (
                  <button
                    type="button" className="btn-secondary py-1 px-2 text-xs"
                    onClick={() => undo(batch.plan_ref)} disabled={busyRow === batch.plan_ref}
                  >
                    {busyRow === batch.plan_ref ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Undo
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-[var(--text-dim)]">
            Undo withdraws only plans nobody has acted on. A plan already matched to an inspection is kept.
          </p>
        </section>
      ) : null}

      <PlanUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        country={country}
        fleet={fleet}
        people={people}
        today={today}
        profileId={profileId}
        onCommitted={refresh}
      />
    </section>
  )
}

function Tile({ label, value, suffix = '', tone = 'quiet', hint }) {
  return (
    <div className="card p-4">
      <span className="block text-sm text-[var(--panel-ink-3)]">{label}</span>
      <strong className={`mt-1 block text-2xl ${tone === 'danger' && value ? 'text-[var(--danger,#dc2626)]' : ''}`}>
        {value == null ? 'N/A' : `${value}${suffix}`}
      </strong>
      {hint ? <span className="mt-1 block text-xs text-[var(--text-dim)]">{hint}</span> : null}
    </div>
  )
}

function StateBadge({ state }) {
  const meta = PLAN_STATE_META[state] || PLAN_STATE_META.Upcoming
  return (
    <span
      title={meta.hint}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASS[meta.tone]}`}
    >
      {meta.label}
    </span>
  )
}

function Breakdown({ title, icon, rows, loading }) {
  return (
    <section className="card p-4 space-y-2">
      <h3 className="font-semibold inline-flex items-center gap-2">{icon} {title}</h3>
      {loading ? <p className="text-sm text-[var(--text-secondary)]">Loading.</p>
        : !rows.length ? <p className="text-sm text-[var(--text-secondary)]">Nothing planned in this window.</p>
          : (
            <div className="overflow-auto max-h-64">
              <table className="w-full text-sm">
                <caption className="sr-only">{title}, worst first</caption>
                <thead className="sticky top-0 bg-[var(--surface-raised,var(--panel))]">
                  <tr>
                    <th scope="col" className="text-start p-2 font-medium">Name</th>
                    <th scope="col" className="text-end p-2 font-medium">Planned</th>
                    <th scope="col" className="text-end p-2 font-medium">Done</th>
                    <th scope="col" className="text-end p-2 font-medium">Missed</th>
                    <th scope="col" className="text-end p-2 font-medium">Adherence</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.name} className="border-t border-[var(--hairline)]">
                      <td className="p-2">{row.name}</td>
                      <td className="p-2 text-end">{row.planned}</td>
                      <td className="p-2 text-end">{row.Done}</td>
                      <td className={`p-2 text-end ${row.Missed ? 'text-[var(--danger,#dc2626)] font-semibold' : ''}`}>{row.Missed}</td>
                      <td className="p-2 text-end">{row.adherence == null ? 'N/A' : `${row.adherence}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </section>
  )
}
