import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { AlertTriangle, Download, Info, RefreshCw } from 'lucide-react'
import EnterpriseTable from '../ui/EnterpriseTable'
import { getTeamAnalytics } from '../../lib/api/workforceAnalyticsServer'
import { NOT_INSTALLED } from '../../lib/api/workforceAssignments'
import { exportSheetsToExcel, reportFileName } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'
import { useLanguage } from '../../contexts/LanguageContext'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const REASON_CODES = new Set(['waiting_stock', 'waiting_equipment', 'vehicle_unavailable', 'safety_hold', 'waiting_approval', 'waiting_manpower', 'other', 'not_recorded'])
const reasonLabelOf = (t, r) => (REASON_CODES.has(r) ? t(`workforce.analytics.reason.${r}`) : String(r || '').replace(/_/g, ' '))

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

const DEFINITION_KEYS = ['window', 'assigned', 'activeMinutes', 'timed', 'rework', 'estimate', 'blocked', 'queue']
const definitionsOf = t => DEFINITION_KEYS.map(k => [t(`workforce.analytics.def.${k}`), t(`workforce.analytics.def.${k}Text`)])

/**
 * Management analytics for team operations. Workflow facts from the server, not productivity scores.
 * @param {{ employeeById?: Map<string, {full_name?:string, employee_id?:string, role?:string, site?:string}> }} props
 */
export default function TeamAnalyticsPanel ({ employeeById }) {
  const { t } = useLanguage()
  const reasonLabel = r => reasonLabelOf(t, r)
  const DEFINITIONS = definitionsOf(t)
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
      setError(e?.message === NOT_INSTALLED ? { notInstalled: true, message: NOT_INSTALLED } : { message: toUserMessage(e, t('workforce.analytics.loadFailed')) })
    } finally { setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t only labels the fallback message
  }, [applied])
  useEffect(() => { load() }, [load])

  const invalidRange = range.from && range.to && range.from > range.to
  const apply = () => { if (!invalidRange) setApplied({ from: range.from, to: range.to, site: site.trim() }) }

  const nameOf = useCallback(id => {
    const p = employeeById?.get?.(id)
    return p?.full_name || p?.employee_id || t('workforce.analytics.unknownEmployee')
  }, [employeeById, t])

  const employees = useMemo(() => (data?.per_employee || []).map(r => ({
    ...r, name: nameOf(r.profile_id), employee_code: employeeById?.get?.(r.profile_id)?.employee_id || '',
    est_n: r.estimate_vs_actual?.n ?? 0, est_ratio: num(r.estimate_vs_actual?.actual_to_estimate),
  })), [data, nameOf, employeeById])
  const sites = useMemo(() => (data?.per_site || []).map(r => ({ ...r, site_label: r.site || t('workforce.analytics.noSiteRecorded'), est_n: r.estimate_vs_actual?.n ?? 0, est_ratio: num(r.estimate_vs_actual?.actual_to_estimate) })), [data, t])
  const blockers = useMemo(() => data?.blocker_minutes_by_reason || [], [data])
  const totals = data?.totals || {}
  const evA = totals.estimate_vs_actual || {}

  const workloadChart = useMemo(() => {
    const top = employees.slice(0, 15)
    return {
      labels: top.map(r => r.name),
      datasets: [
        { label: t('workforce.analytics.dsVerified'), data: top.map(r => r.verified || 0), backgroundColor: '#16a34a', stack: 'w' },
        { label: t('workforce.analytics.dsSubmitted'), data: top.map(r => r.submitted || 0), backgroundColor: '#38bdf8', stack: 'w' },
        { label: t('workforce.analytics.dsInProgress'), data: top.map(r => r.active || 0), backgroundColor: '#6366f1', stack: 'w' },
        { label: t('workforce.analytics.dsNotStarted'), data: top.map(r => r.awaiting_start || 0), backgroundColor: '#94a3b8', stack: 'w' },
        { label: t('workforce.analytics.dsBlocked'), data: top.map(r => r.blocked || 0), backgroundColor: '#f5a524', stack: 'w' },
        { label: t('workforce.analytics.dsCancelled'), data: top.map(r => r.cancelled || 0), backgroundColor: '#64748b', stack: 'w' },
      ],
    }
  }, [employees, t])
  const blockerChart = useMemo(() => ({
    labels: blockers.map(b => reasonLabelOf(t, b.reason)),
    datasets: [
      { label: t('workforce.analytics.dsClosedBlocks'), data: blockers.map(b => num(b.closed_minutes) ?? 0), backgroundColor: '#f5a524', stack: 'b' },
      { label: t('workforce.analytics.dsStillBlocked'), data: blockers.map(b => num(b.open_minutes) ?? 0), backgroundColor: '#f26161', stack: 'b' },
    ],
  }), [blockers, t])
  const barOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }

  const empColumns = useMemo(() => [
    { accessorKey: 'name', header: t('workforce.analytics.colEmployee'), cell: ({ row }) => <span>{row.original.name}{row.original.employee_code ? <span style={{ color: 'var(--text-dim)' }}> ({row.original.employee_code})</span> : null}</span> },
    { accessorKey: 'assigned', header: t('workforce.analytics.colAssigned'), meta: { align: 'right' } },
    { accessorKey: 'active', header: t('workforce.analytics.colInProgress'), meta: { align: 'right' } },
    { accessorKey: 'blocked', header: t('workforce.analytics.colBlocked'), meta: { align: 'right' } },
    { accessorKey: 'submitted', header: t('workforce.analytics.colSubmitted'), meta: { align: 'right' } },
    { accessorKey: 'verified', header: t('workforce.analytics.colVerified'), meta: { align: 'right' } },
    { accessorKey: 'overdue_open', header: t('workforce.analytics.colOverdueOpen'), meta: { align: 'right' } },
    { accessorKey: 'rework_returns', header: t('workforce.analytics.colReturns'), meta: { align: 'right' } },
    { accessorKey: 'rework_rate', header: t('workforce.analytics.colReworkRate'), cell: i => pct(i.getValue()), meta: { align: 'right', exportValue: r => num(r.rework_rate) } },
    { accessorKey: 'avg_active_minutes', header: t('workforce.analytics.colAvgActive'), cell: i => fmt(i.getValue(), 1), meta: { align: 'right' } },
    { accessorKey: 'median_active_minutes', header: t('workforce.analytics.colMedianActive'), cell: i => fmt(i.getValue(), 1), meta: { align: 'right' } },
    { accessorKey: 'timed_verified', header: t('workforce.analytics.colTimedN'), meta: { align: 'right' } },
    { accessorKey: 'est_ratio', header: t('workforce.analytics.colActualEstimate'), cell: ({ row }) => t('workforce.analytics.ratioN', { ratio: fmt(row.original.est_ratio, 2), n: row.original.est_n }), meta: { align: 'right' } },
    { accessorKey: 'verified_with_record', header: t('workforce.analytics.colVerifiedWithRecord'), meta: { align: 'right' } },
  ], [t])
  const siteColumns = useMemo(() => [
    { accessorKey: 'site_label', header: t('workforce.analytics.colSite') },
    { accessorKey: 'assigned', header: t('workforce.analytics.colAssigned'), meta: { align: 'right' } },
    { accessorKey: 'verified', header: t('workforce.analytics.colVerified'), meta: { align: 'right' } },
    { accessorKey: 'blocked', header: t('workforce.analytics.colBlocked'), meta: { align: 'right' } },
    { accessorKey: 'overdue_open', header: t('workforce.analytics.colOverdueOpen'), meta: { align: 'right' } },
    { accessorKey: 'rework_rate', header: t('workforce.analytics.colReworkRate'), cell: i => pct(i.getValue()), meta: { align: 'right' } },
    { accessorKey: 'median_active_minutes', header: t('workforce.analytics.colMedianActive'), cell: i => fmt(i.getValue(), 1), meta: { align: 'right' } },
    { accessorKey: 'blocked_minutes_closed', header: t('workforce.analytics.colBlockedClosed'), cell: i => fmt(i.getValue(), 1), meta: { align: 'right' } },
    { accessorKey: 'est_ratio', header: t('workforce.analytics.colActualEstimate'), cell: ({ row }) => t('workforce.analytics.ratioN', { ratio: fmt(row.original.est_ratio, 2), n: row.original.est_n }), meta: { align: 'right' } },
  ], [t])

  async function exportExcel () {
    if (!data) return
    setExporting(true)
    const windowRange = t('workforce.analytics.windowRange', { from: applied.from || t('workforce.analytics.start'), to: applied.to || t('workforce.analytics.today') })
    try {
      const empKeys = ['name', 'employee_code', 'assigned', 'awaiting_start', 'active', 'blocked', 'submitted', 'verified', 'cancelled', 'overdue_open', 'rework_returns', 'rework_rate', 'avg_active_minutes', 'median_active_minutes', 'timed_verified', 'verified_untimed', 'est_n', 'est_ratio', 'verified_with_record', 'verified_missing_record', 'blocked_minutes_closed']
      const siteKeys = ['site_label', 'assigned', 'verified', 'blocked', 'overdue_open', 'rework_returns', 'rework_rate', 'median_active_minutes', 'blocked_minutes_closed', 'est_n', 'est_ratio']
      const blockRows = blockers.map(b => ({ cause: reasonLabel(b.reason), episodes: b.episodes, closed_episodes: b.closed_episodes, closed_minutes: num(b.closed_minutes), open_episodes: b.open_episodes, open_minutes: num(b.open_minutes), unmeasured_episodes: b.unmeasured_episodes }))
      const sheet = (name, rows, keys) => ({ name, rows: rows.map(r => Object.fromEntries(keys.map(k => [k, r[k] ?? null]))), columns: keys, headers: keys.map(k => k.replace(/_/g, ' ')) })
      await exportSheetsToExcel([
        sheet(t('workforce.analytics.sheetEmployees'), employees, empKeys),
        sheet(t('workforce.analytics.sheetSites'), sites, siteKeys),
        sheet(t('workforce.analytics.sheetBlocked'), blockRows, Object.keys(blockRows[0] || { cause: null })),
        sheet(t('workforce.analytics.sheetDefinitions'), DEFINITIONS.map(([metric, definition]) => ({ metric, definition })).concat([{ metric: t('workforce.analytics.generatedAt'), definition: when(data.data_freshness?.generated_at) }, { metric: t('workforce.analytics.def.window'), definition: applied.site ? t('workforce.analytics.windowSite', { range: windowRange, site: applied.site }) : windowRange }]), ['metric', 'definition']),
      ], reportFileName(t('workforce.analytics.fileName'), applied.from || '', applied.to || ''), {
        title: t('workforce.analytics.exportTitle'),
        dateRange: windowRange,
        meta: applied.site ? { [t('workforce.analytics.metaSite')]: applied.site } : undefined,
      })
    } catch (e) {
      setError({ message: toUserMessage(e, t('workforce.analytics.exportFailed')) })
    } finally { setExporting(false) }
  }

  const inputStyle = { background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
  const empty = data && (totals.assigned ?? 0) === 0

  return (
    <div className="space-y-4" data-testid="team-analytics-panel">
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('workforce.analytics.from')}
          <input type="date" aria-label={t('workforce.analytics.fromDate')} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="block mt-1 rounded px-2 py-1 text-sm" style={inputStyle} />
        </label>
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('workforce.analytics.to')}
          <input type="date" aria-label={t('workforce.analytics.toDate')} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="block mt-1 rounded px-2 py-1 text-sm" style={inputStyle} />
        </label>
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('workforce.analytics.site')}
          <input type="text" aria-label={t('workforce.analytics.site')} placeholder={t('workforce.analytics.allSites')} value={site} onChange={e => setSite(e.target.value)} className="block mt-1 rounded px-2 py-1 text-sm" style={inputStyle} />
        </label>
        <button type="button" onClick={apply} disabled={invalidRange || loading} className="btn btn-primary text-sm">{t('workforce.analytics.apply')}</button>
        <button type="button" onClick={load} disabled={loading} className="btn btn-secondary text-sm inline-flex items-center gap-1" aria-label={t('workforce.analytics.refreshLabel')}><RefreshCw size={14} /> {t('workforce.analytics.refresh')}</button>
        <button type="button" onClick={exportExcel} disabled={!data || empty || exporting} className="btn btn-secondary text-sm inline-flex items-center gap-1"><Download size={14} /> {exporting ? t('workforce.analytics.exporting') : t('workforce.analytics.excel')}</button>
        {invalidRange && <span className="text-xs" style={{ color: '#f26161' }}>{t('workforce.analytics.invalidRange')}</span>}
      </div>

      <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--text-muted)' }}>
        <Info size={14} className="mt-0.5 shrink-0" />
        {t('workforce.analytics.disclaimer')}
      </p>

      {loading && <div className="card p-6 text-sm" style={{ color: 'var(--text-muted)' }} role="status">{t('workforce.analytics.loading')}</div>}

      {!loading && error && (
        <div className="card p-4 flex items-start gap-2" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: error.notInstalled ? '#f5a524' : '#f26161' }} />
          <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {error.message}
            {!error.notInstalled && <div><button type="button" className="btn btn-secondary text-xs mt-2" onClick={load}>{t('workforce.analytics.retry')}</button></div>}
          </div>
        </div>
      )}

      {!loading && !error && empty && (
        <div className="card p-6 text-sm" style={{ color: 'var(--text-muted)' }}>{applied.site ? t('workforce.analytics.emptySite', { site: applied.site }) : t('workforce.analytics.empty')}</div>
      )}

      {!loading && !error && data && !empty && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            <Tile label={t('workforce.analytics.tileAssigned')} value={fmt(totals.assigned)} />
            <Tile label={t('workforce.analytics.tileVerified')} value={fmt(totals.verified)} />
            <Tile label={t('workforce.analytics.tileBlockedNow')} value={fmt(totals.blocked)} />
            <Tile label={t('workforce.analytics.tileOverdueOpen')} value={fmt(totals.overdue_open)} />
            <Tile label={t('workforce.analytics.tileReworkRate')} value={pct(data.rework_rate)} hint={t('workforce.analytics.tileReturns', { count: fmt(totals.rework_returns) })} />
            <Tile label={t('workforce.analytics.tileMedianActive')} value={fmt(totals.median_active_minutes, 1)} hint={t('workforce.analytics.tileTimed', { count: fmt(totals.timed_verified) })} />
            <Tile label={t('workforce.analytics.tileActualEstimate')} value={fmt(evA.actual_to_estimate, 2)} hint={t('workforce.analytics.tileN', { count: fmt(evA.n) })} />
            <Tile label={t('workforce.analytics.tileAwaitingReview')} value={fmt(data.verification_queue?.count)} hint={data.verification_queue?.oldest_age_hours != null ? t('workforce.analytics.tileOldest', { hours: fmt(data.verification_queue.oldest_age_hours, 1) }) : t('workforce.analytics.tileNoneWaiting')} />
          </div>

          <Section title={t('workforce.analytics.workload')} note={t('workforce.analytics.workloadNote')}>
            <div style={{ height: 280 }}><Bar data={workloadChart} options={barOpts} aria-label={t('workforce.analytics.workloadChart')} /></div>
          </Section>

          <Section title={t('workforce.analytics.byEmployee')} note={t('workforce.analytics.byEmployeeNote')}>
            <EnterpriseTable columns={empColumns} data={employees} getRowId={r => r.profile_id} emptyMessage={t('workforce.analytics.noEmployees')} initialPageSize={25} />
          </Section>

          <Section title={t('workforce.analytics.bySite')}>
            <EnterpriseTable columns={siteColumns} data={sites} getRowId={r => r.site || '__none__'} emptyMessage={t('workforce.analytics.noSites')} enableColumnFilters={false} />
          </Section>

          <Section title={t('workforce.analytics.blockedByCause')} note={t('workforce.analytics.blockedByCauseNote')}>
            {blockers.length === 0
              ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('workforce.analytics.noBlocked')}</p>
              : <>
                  <div style={{ height: 240 }}><Bar data={blockerChart} options={barOpts} aria-label={t('workforce.analytics.blockedChart')} /></div>
                  <ul className="text-xs space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                    {blockers.map(b => (
                      <li key={b.reason}>{t(b.episodes === 1 ? 'workforce.analytics.blockLineOne' : 'workforce.analytics.blockLineOther', { cause: reasonLabel(b.reason), count: b.episodes, minutes: fmt(b.closed_minutes, 1) })}{b.open_episodes ? t('workforce.analytics.blockLineOpen', { count: b.open_episodes, minutes: fmt(b.open_minutes, 1) }) : ''}{b.unmeasured_episodes ? t('workforce.analytics.blockLineUnmeasured', { count: b.unmeasured_episodes }) : ''}</li>
                    ))}
                  </ul>
                </>}
          </Section>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title={t('workforce.analytics.reworkEstimates')}>
              <ul className="text-sm space-y-1" style={{ color: 'var(--text-primary)' }}>
                <li>{t('workforce.analytics.reworkLine', { rate: pct(data.rework_rate), returns: fmt(totals.rework_returns), verified: fmt(totals.verified) })}</li>
                <li>{t(evA.n === 1 ? 'workforce.analytics.estimateLineOne' : 'workforce.analytics.estimateLineOther', { actual: fmt(evA.actual_minutes, 1), estimated: fmt(evA.estimated_minutes, 1), n: fmt(evA.n) })}</li>
                <li>{t('workforce.analytics.recordLine', { with: fmt(totals.verified_with_record), missing: fmt(totals.verified_missing_record) })}</li>
                <li>{t('workforce.analytics.reassignLine', { reassignments: fmt(data.reassignments), overrides: fmt(data.override_count) })}</li>
              </ul>
            </Section>
            <Section title={t('workforce.analytics.queueHeading')} note={t('workforce.analytics.queueNote')}>
              <ul className="text-sm space-y-1" style={{ color: 'var(--text-primary)' }}>
                <li>{t('workforce.analytics.queueWaiting', { count: fmt(data.verification_queue?.count) })}</li>
                <li>{t('workforce.analytics.queueOldest', { value: data.verification_queue?.oldest_age_hours != null ? t('workforce.analytics.queueHours', { hours: fmt(data.verification_queue.oldest_age_hours, 1) }) : 'N/A' })}</li>
                {data.verification_queue?.aged_from_last_update > 0 && <li style={{ color: 'var(--text-muted)' }}>{t('workforce.analytics.queueAged', { count: data.verification_queue.aged_from_last_update })}</li>}
              </ul>
            </Section>
          </div>
        </>
      )}

      {data && !error && (
        <details className="card p-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          <summary className="cursor-pointer font-medium" style={{ color: 'var(--text-primary)' }}>{t('workforce.analytics.sourceFreshness')}</summary>
          <div className="mt-2 space-y-1">
            <p>{t('workforce.analytics.sourceText', { generated: when(data.data_freshness?.generated_at), change: when(data.data_freshness?.latest_change), event: when(data.data_freshness?.latest_event) })}</p>
            <p>{t('workforce.analytics.coverageText', { assignments: fmt(data.coverage?.assignments), verified: fmt(data.coverage?.verified), timed: fmt(data.coverage?.verified_timed), untimed: fmt(data.coverage?.verified_untimed) })}</p>
            <dl className="grid md:grid-cols-2 gap-x-4 gap-y-1 mt-2">
              {DEFINITIONS.map(([k, v]) => <div key={k}><dt className="font-medium" style={{ color: 'var(--text-primary)' }}>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </div>
        </details>
      )}
    </div>
  )
}
