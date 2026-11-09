import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { AlertTriangle, Download, Info, RefreshCw } from 'lucide-react'
import EnterpriseTable from '../ui/EnterpriseTable'
import { getTeamAnalytics } from '../../lib/api/workforceAnalyticsServer'
import { NOT_INSTALLED } from '../../lib/api/workforceAssignments'
import { exportSheetsToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const REASON_LABEL = {
  waiting_stock: 'Waiting for stock', waiting_equipment: 'Waiting for equipment', vehicle_unavailable: 'Vehicle unavailable',
  safety_hold: 'Safety hold', waiting_approval: 'Waiting for approval', waiting_manpower: 'Waiting for manpower',
  other: 'Other', not_recorded: 'Cause not recorded',
}
const reasonLabel = r => REASON_LABEL[r] || String(r || '').replace(/_/g, ' ')

const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function defaultRange () {
  const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 29)
  return { from: isoDay(from), to: isoDay(to) }
}
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const fmt = (v, digits = 0) => { const n = num(v); return n === null ? 'N/A' : n.toLocaleString(undefined, { maximumFractionDigits: digits }) }
const pct = v => { const n = num(v); return n === null ? 'N/A' : `${(n * 100).toFixed(1)}%` }
const when = v => (v ? new Date(v).toLocaleString() : 'N/A')

function Tile ({ label, value, hint }) {
  return (
    <div className="card p-3" data-testid="team-kpi">
      <div className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</div>
      {hint && <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{hint}</div>}
    </div>
  )
}

function Section ({ title, children, note }) {
  return (
    <section className="card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        {note && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{note}</p>}
      </div>
      {children}
    </section>
  )
}

const DEFINITIONS = [
  ['Window', 'Assignments created between the two dates, inclusive. Every figure covers every assignment you are allowed to see, not one page.'],
  ['Assigned', 'All assignments in the window currently held by the person (any status). Reassigned work counts for whoever holds it now.'],
  ['Active minutes', 'Time spent in progress, from the transition history. Blocked time and time waiting for review are excluded.'],
  ['Timed', 'Verified assignments with a transition history. Verified work closed without a history has no trustworthy times and is shown as untimed, never guessed.'],
  ['Rework rate', 'Returns from review divided by (verified + returns). N/A when nothing was verified or returned.'],
  ['Estimate vs actual', 'Sum of active minutes against sum of estimates, only for verified work that has both. The sample size is shown beside it.'],
  ['Blocked time', 'From each block to the event that ended it (resume, complete or cancel). Blocks still open are counted up to now, separately.'],
  ['Verification queue', 'Work submitted and waiting for review right now, for the chosen site, regardless of the window.'],
]

/**
 * Management analytics for team operations. Workflow facts from the server, not productivity scores.
 * @param {{ employeeById?: Map<string, {full_name?:string, employee_id?:string, role?:string, site?:string}> }} props
 */
export default function TeamAnalyticsPanel ({ employeeById }) {
  const [range, setRange] = useState(defaultRange)
  const [site, setSite] = useState('')
  const [applied, setApplied] = useState(() => ({ ...defaultRange(), site: '' }))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setData(await getTeamAnalytics({ from: applied.from || null, to: applied.to || null, site: applied.site || null }))
    } catch (e) {
      setData(null)
      setError(e?.message === NOT_INSTALLED ? { notInstalled: true, message: NOT_INSTALLED } : { message: toUserMessage(e, 'Team analytics could not be loaded') })
    } finally { setLoading(false) }
  }, [applied])
  useEffect(() => { load() }, [load])

  const invalidRange = range.from && range.to && range.from > range.to
  const apply = () => { if (!invalidRange) setApplied({ from: range.from, to: range.to, site: site.trim() }) }

  const nameOf = useCallback(id => {
    const p = employeeById?.get?.(id)
    return p?.full_name || p?.employee_id || 'Unknown employee'
  }, [employeeById])

  const employees = useMemo(() => (data?.per_employee || []).map(r => ({
    ...r, name: nameOf(r.profile_id), employee_code: employeeById?.get?.(r.profile_id)?.employee_id || '',
    est_n: r.estimate_vs_actual?.n ?? 0, est_ratio: num(r.estimate_vs_actual?.actual_to_estimate),
  })), [data, nameOf, employeeById])
  const sites = useMemo(() => (data?.per_site || []).map(r => ({ ...r, site_label: r.site || 'No site recorded', est_n: r.estimate_vs_actual?.n ?? 0, est_ratio: num(r.estimate_vs_actual?.actual_to_estimate) })), [data])
  const blockers = useMemo(() => data?.blocker_minutes_by_reason || [], [data])
  const totals = data?.totals || {}
  const evA = totals.estimate_vs_actual || {}

  const workloadChart = useMemo(() => {
    const top = employees.slice(0, 15)
    return {
      labels: top.map(r => r.name),
      datasets: [
        { label: 'Verified', data: top.map(r => r.verified || 0), backgroundColor: '#16a34a', stack: 'w' },
        { label: 'Submitted', data: top.map(r => r.submitted || 0), backgroundColor: '#38bdf8', stack: 'w' },
        { label: 'In progress', data: top.map(r => r.active || 0), backgroundColor: '#6366f1', stack: 'w' },
        { label: 'Not started', data: top.map(r => r.awaiting_start || 0), backgroundColor: '#94a3b8', stack: 'w' },
        { label: 'Blocked', data: top.map(r => r.blocked || 0), backgroundColor: '#f5a524', stack: 'w' },
        { label: 'Cancelled', data: top.map(r => r.cancelled || 0), backgroundColor: '#64748b', stack: 'w' },
      ],
    }
  }, [employees])
  const blockerChart = useMemo(() => ({
    labels: blockers.map(b => reasonLabel(b.reason)),
    datasets: [
      { label: 'Closed blocks (minutes)', data: blockers.map(b => num(b.closed_minutes) ?? 0), backgroundColor: '#f5a524', stack: 'b' },
      { label: 'Still blocked (minutes so far)', data: blockers.map(b => num(b.open_minutes) ?? 0), backgroundColor: '#f26161', stack: 'b' },
    ],
  }), [blockers])
  const barOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }

  const empColumns = useMemo(() => [
    { accessorKey: 'name', header: 'Employee', cell: ({ row }) => <span>{row.original.name}{row.original.employee_code ? <span style={{ color: 'var(--text-dim)' }}> ({row.original.employee_code})</span> : null}</span> },
    { accessorKey: 'assigned', header: 'Assigned', meta: { align: 'right' } },
    { accessorKey: 'active', header: 'In progress', meta: { align: 'right' } },
    { accessorKey: 'blocked', header: 'Blocked', meta: { align: 'right' } },
    { accessorKey: 'submitted', header: 'Submitted', meta: { align: 'right' } },
    { accessorKey: 'verified', header: 'Verified', meta: { align: 'right' } },
    { accessorKey: 'overdue_open', header: 'Overdue open', meta: { align: 'right' } },
    { accessorKey: 'rework_returns', header: 'Returns', meta: { align: 'right' } },
    { accessorKey: 'rework_rate', header: 'Rework rate', cell: i => pct(i.getValue()), meta: { align: 'right', exportValue: r => num(r.rework_rate) } },
    { accessorKey: 'avg_active_minutes', header: 'Avg active min', cell: i => fmt(i.getValue(), 1), meta: { align: 'right' } },
    { accessorKey: 'median_active_minutes', header: 'Median active min', cell: i => fmt(i.getValue(), 1), meta: { align: 'right' } },
    { accessorKey: 'timed_verified', header: 'Timed n', meta: { align: 'right' } },
    { accessorKey: 'est_ratio', header: 'Actual / estimate', cell: ({ row }) => `${fmt(row.original.est_ratio, 2)} (n=${row.original.est_n})`, meta: { align: 'right' } },
    { accessorKey: 'verified_with_record', header: 'Verified with record', meta: { align: 'right' } },
  ], [])
  const siteColumns = useMemo(() => [
    { accessorKey: 'site_label', header: 'Site' },
    { accessorKey: 'assigned', header: 'Assigned', meta: { align: 'right' } },
    { accessorKey: 'verified', header: 'Verified', meta: { align: 'right' } },
    { accessorKey: 'blocked', header: 'Blocked', meta: { align: 'right' } },
    { accessorKey: 'overdue_open', header: 'Overdue open', meta: { align: 'right' } },
    { accessorKey: 'rework_rate', header: 'Rework rate', cell: i => pct(i.getValue()), meta: { align: 'right' } },
    { accessorKey: 'median_active_minutes', header: 'Median active min', cell: i => fmt(i.getValue(), 1), meta: { align: 'right' } },
    { accessorKey: 'blocked_minutes_closed', header: 'Blocked min (closed)', cell: i => fmt(i.getValue(), 1), meta: { align: 'right' } },
    { accessorKey: 'est_ratio', header: 'Actual / estimate', cell: ({ row }) => `${fmt(row.original.est_ratio, 2)} (n=${row.original.est_n})`, meta: { align: 'right' } },
  ], [])

  async function exportExcel () {
    if (!data) return
    setExporting(true)
    try {
      const empKeys = ['name', 'employee_code', 'assigned', 'awaiting_start', 'active', 'blocked', 'submitted', 'verified', 'cancelled', 'overdue_open', 'rework_returns', 'rework_rate', 'avg_active_minutes', 'median_active_minutes', 'timed_verified', 'verified_untimed', 'est_n', 'est_ratio', 'verified_with_record', 'verified_missing_record', 'blocked_minutes_closed']
      const siteKeys = ['site_label', 'assigned', 'verified', 'blocked', 'overdue_open', 'rework_returns', 'rework_rate', 'median_active_minutes', 'blocked_minutes_closed', 'est_n', 'est_ratio']
      const blockRows = blockers.map(b => ({ cause: reasonLabel(b.reason), episodes: b.episodes, closed_episodes: b.closed_episodes, closed_minutes: num(b.closed_minutes), open_episodes: b.open_episodes, open_minutes: num(b.open_minutes), unmeasured_episodes: b.unmeasured_episodes }))
      const sheet = (name, rows, keys) => ({ name, rows: rows.map(r => Object.fromEntries(keys.map(k => [k, r[k] ?? null]))), columns: keys, headers: keys.map(k => k.replace(/_/g, ' ')) })
      await exportSheetsToExcel([
        sheet('Employees', employees, empKeys),
        sheet('Sites', sites, siteKeys),
        sheet('Blocked time', blockRows, Object.keys(blockRows[0] || { cause: null })),
        sheet('Definitions', DEFINITIONS.map(([metric, definition]) => ({ metric, definition })).concat([{ metric: 'Generated at', definition: when(data.data_freshness?.generated_at) }, { metric: 'Window', definition: `${applied.from || 'start'} to ${applied.to || 'today'}${applied.site ? `, site ${applied.site}` : ''}` }]), ['metric', 'definition']),
      ], reportFileName('Team Analytics', applied.from || '', applied.to || ''), {
        title: 'Team analytics (workflow facts, not productivity scores)',
        dateRange: `${applied.from || 'start'} to ${applied.to || 'today'}`,
        meta: applied.site ? { Site: applied.site } : undefined,
      })
    } catch (e) {
      setError({ message: toUserMessage(e, 'The export could not be created') })
    } finally { setExporting(false) }
  }

  const inputStyle = { background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
  const empty = data && (totals.assigned ?? 0) === 0

  return (
    <div className="space-y-4" data-testid="team-analytics-panel">
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>From
          <input type="date" aria-label="From date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="block mt-1 rounded px-2 py-1 text-sm" style={inputStyle} />
        </label>
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>To
          <input type="date" aria-label="To date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="block mt-1 rounded px-2 py-1 text-sm" style={inputStyle} />
        </label>
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Site
          <input type="text" aria-label="Site" placeholder="All sites" value={site} onChange={e => setSite(e.target.value)} className="block mt-1 rounded px-2 py-1 text-sm" style={inputStyle} />
        </label>
        <button type="button" onClick={apply} disabled={invalidRange || loading} className="btn btn-primary text-sm">Apply</button>
        <button type="button" onClick={load} disabled={loading} className="btn btn-secondary text-sm inline-flex items-center gap-1" aria-label="Refresh analytics"><RefreshCw size={14} /> Refresh</button>
        <button type="button" onClick={exportExcel} disabled={!data || empty || exporting} className="btn btn-secondary text-sm inline-flex items-center gap-1"><Download size={14} /> {exporting ? 'Exporting...' : 'Excel'}</button>
        {invalidRange && <span className="text-xs" style={{ color: '#f26161' }}>The start date must be on or before the end date.</span>}
      </div>

      <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-muted)' }}>
        <Info size={14} className="mt-0.5 shrink-0" />
        These are workflow facts recorded by the system (what was assigned, how long it was worked and blocked, what was returned). They are not productivity scores and do not rank people.
      </p>

      {loading && <div className="card p-6 text-sm" style={{ color: 'var(--text-muted)' }} role="status">Loading team analytics...</div>}

      {!loading && error && (
        <div className="card p-4 flex items-start gap-2" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: error.notInstalled ? '#f5a524' : '#f26161' }} />
          <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {error.message}
            {!error.notInstalled && <div><button type="button" className="btn btn-secondary text-xs mt-2" onClick={load}>Retry</button></div>}
          </div>
        </div>
      )}

      {!loading && !error && empty && (
        <div className="card p-6 text-sm" style={{ color: 'var(--text-muted)' }}>No assignments were created in this window{applied.site ? ` for site ${applied.site}` : ''}. Widen the dates or clear the site filter.</div>
      )}

      {!loading && !error && data && !empty && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            <Tile label="Assigned" value={fmt(totals.assigned)} />
            <Tile label="Verified" value={fmt(totals.verified)} />
            <Tile label="Blocked now" value={fmt(totals.blocked)} />
            <Tile label="Overdue open" value={fmt(totals.overdue_open)} />
            <Tile label="Rework rate" value={pct(data.rework_rate)} hint={`${fmt(totals.rework_returns)} returns`} />
            <Tile label="Median active min" value={fmt(totals.median_active_minutes, 1)} hint={`n=${fmt(totals.timed_verified)} timed`} />
            <Tile label="Actual / estimate" value={fmt(evA.actual_to_estimate, 2)} hint={`n=${fmt(evA.n)}`} />
            <Tile label="Awaiting review" value={fmt(data.verification_queue?.count)} hint={data.verification_queue?.oldest_age_hours != null ? `oldest ${fmt(data.verification_queue.oldest_age_hours, 1)} h` : 'none waiting'} />
          </div>

          <Section title="Workload distribution" note="Assignments in the window by current holder and status (first 15 by volume).">
            <div style={{ height: 280 }}><Bar data={workloadChart} options={barOpts} aria-label="Workload distribution chart" /></div>
          </Section>

          <Section title="By employee" note="Sort any column. Averages and ratios show N/A when nothing could be measured.">
            <EnterpriseTable columns={empColumns} data={employees} getRowId={r => r.profile_id} emptyMessage="No employees in this window" initialPageSize={25} />
          </Section>

          <Section title="By site">
            <EnterpriseTable columns={siteColumns} data={sites} getRowId={r => r.site || '__none__'} emptyMessage="No sites in this window" enableColumnFilters={false} />
          </Section>

          <Section title="Blocked time by cause" note="Closed blocks are measured start to end. Blocks still open are counted up to now and shown separately.">
            {blockers.length === 0
              ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No work was blocked in this window.</p>
              : <>
                  <div style={{ height: 240 }}><Bar data={blockerChart} options={barOpts} aria-label="Blocked time by cause chart" /></div>
                  <ul className="text-xs space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                    {blockers.map(b => (
                      <li key={b.reason}>{reasonLabel(b.reason)}: {b.episodes} block{b.episodes === 1 ? '' : 's'}, {fmt(b.closed_minutes, 1)} min closed{b.open_episodes ? `, ${b.open_episodes} still open (${fmt(b.open_minutes, 1)} min so far)` : ''}{b.unmeasured_episodes ? `, ${b.unmeasured_episodes} without a recorded end` : ''}</li>
                    ))}
                  </ul>
                </>}
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title="Rework and estimates">
              <ul className="text-sm space-y-1" style={{ color: 'var(--text-primary)' }}>
                <li>Rework rate: {pct(data.rework_rate)} ({fmt(totals.rework_returns)} returns, {fmt(totals.verified)} verified)</li>
                <li>Estimate vs actual: {fmt(evA.actual_minutes, 1)} active min against {fmt(evA.estimated_minutes, 1)} estimated min, based on {fmt(evA.n)} verified assignment{evA.n === 1 ? '' : 's'} with both</li>
                <li>Verified with an operational record: {fmt(totals.verified_with_record)}; missing a required record: {fmt(totals.verified_missing_record)}</li>
                <li>Reassignments: {fmt(data.reassignments)}; manager overrides: {fmt(data.override_count)}</li>
              </ul>
            </Section>
            <Section title="Verification queue" note="Current queue for the chosen site, all dates.">
              <ul className="text-sm space-y-1" style={{ color: 'var(--text-primary)' }}>
                <li>Waiting for review: {fmt(data.verification_queue?.count)}</li>
                <li>Oldest waiting: {data.verification_queue?.oldest_age_hours != null ? `${fmt(data.verification_queue.oldest_age_hours, 1)} hours` : 'N/A'}</li>
                {data.verification_queue?.aged_from_last_update > 0 && <li style={{ color: 'var(--text-muted)' }}>{data.verification_queue.aged_from_last_update} aged from the last update (no submission event recorded)</li>}
              </ul>
            </Section>
          </div>
        </>
      )}

      {data && !error && (
        <details className="card p-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          <summary className="cursor-pointer font-medium" style={{ color: 'var(--text-primary)' }}>Source and freshness</summary>
          <div className="mt-2 space-y-1">
            <p>Calculated on the server from workforce assignments and their transition history. Generated {when(data.data_freshness?.generated_at)}; latest change {when(data.data_freshness?.latest_change)}; latest event {when(data.data_freshness?.latest_event)}.</p>
            <p>Coverage: {fmt(data.coverage?.assignments)} assignments, {fmt(data.coverage?.verified)} verified, of which {fmt(data.coverage?.verified_timed)} timed and {fmt(data.coverage?.verified_untimed)} without a transition history (durations unknown).</p>
            <dl className="grid md:grid-cols-2 gap-x-4 gap-y-1 mt-2">
              {DEFINITIONS.map(([k, v]) => <div key={k}><dt className="font-medium" style={{ color: 'var(--text-primary)' }}>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </div>
        </details>
      )}
    </div>
  )
}
