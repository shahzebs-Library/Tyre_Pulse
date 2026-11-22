/**
 * PredictiveMaintenance (route /predictive-maintenance).
 *
 * Rebuilt on the signals the fleet actually records, and nothing else:
 *   1. Tyres past or near their expected life, from the server running-life
 *      aggregate (get_tyre_running_life), judged with the ONE shared rule
 *      measureFor / bandFor in src/lib/tyreRunningLife.js.
 *   2. Expected replacements for the next three 30-day windows, by size, from
 *      each tyre's own usage rate; beside it, what the fitment history alone
 *      would predict (src/lib/tyreDemandForecast.js).
 *   3. Maintenance risk: assets with a long open breakdown or repeat job cards.
 *
 * REMOVED on purpose: every panel that needed tread depth, tyre pressure, risk
 * level or a monthly tyre budget (tread-limited due dates, failure probability,
 * risk bands, budget lines, cost forecasts). Those columns are empty, so those
 * panels showed defaults. One short note says what is not recorded instead.
 *
 * All maths lives in src/lib/predictiveSignals.js. Each card loads, fails and
 * retries on its own; a failed read is never shown as "nothing due".
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Clock, Gauge, Wrench, Repeat, CircleDot, Search, X, Info,
  FileSpreadsheet, FileText, RefreshCw, ArrowRight,
} from 'lucide-react'
import { PageHero, Kpi, Card, CardState, KitTable, Pager, useCard, fmtInt } from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import { getTyreRunningLife } from '../lib/api/tyreRunningLife'
import { listAssetBreakdowns } from '../lib/api/assetBreakdowns'
import { listRecentJobCards, getSignalCoverage, listFitmentHistory } from '../lib/api/predictiveSignals'
import { shapeRunningLife, coverageNote, BAND_META } from '../lib/tyreRunningLife'
import { forecastTyreDemand } from '../lib/tyreDemandForecast'
import {
  replacementOutlook, dueTyreRows, filterDueRows, dueExportRows, DUE_EXPORT_COLUMNS, remainingText,
  maintenanceRisk, riskExportRows, RISK_EXPORT_COLUMNS, signalGaps, historyDemandRows,
  JOB_CARD_WINDOW_DAYS, REPEAT_JOB_CARDS, LONG_BREAKDOWN_DAYS, MIN_RATE_DAYS,
} from '../lib/predictiveSignals'
import { toUserMessage } from '../lib/safeError'
import './PredictiveMaintenance.css'

const loadExportUtils = () => import('../lib/exportUtils')
const BAND_TONE = { overdue: 'bad', 'due-soon': 'warn' }
const na = (t = 'N/A', title) => <span className="cc-na" title={title}>{t}</span>
const assetLink = (asset) => (asset
  ? <Link className="pm-asset-link" to={`/asset-management/${encodeURIComponent(asset)}`}>{asset}</Link>
  : na())

export default function PredictiveMaintenance() {
  const { activeCountry } = useSettings()
  const country = activeCountry && activeCountry !== 'All' ? activeCountry : undefined
  const scopeLabel = country || 'All countries'
  const now = useMemo(() => new Date(), [])

  // Each source is its own card state: one failing read never blanks the rest.
  const lifeCard = useCard(async () => {
    const res = await getTyreRunningLife({ country: activeCountry })
    if (!res || res.ok === false) throw new Error(res?.reason || 'The running life view could not be built.')
    return shapeRunningLife(res)
  }, [activeCountry])
  const bdCard = useCard(async () => {
    const res = await listAssetBreakdowns({ country })
    if (!res.ok) throw new Error('The breakdown register is not available.')
    return res
  }, [activeCountry])
  const jobCard = useCard(() => listRecentJobCards({ country, days: JOB_CARD_WINDOW_DAYS, now }), [activeCountry])
  const covCard = useCard(() => getSignalCoverage({ country }), [activeCountry])
  const histCard = useCard(() => listFitmentHistory({ country, now }), [activeCountry])
  const [actionError, setActionError] = useState('')

  const lifeRows = lifeCard.data?.rows
  const summary = lifeCard.data?.summary
  const outlook = useMemo(() => (lifeRows ? replacementOutlook(lifeRows, { now }) : null), [lifeRows, now])
  const dueRows = useMemo(() => (lifeRows ? dueTyreRows(lifeRows) : []), [lifeRows])
  const measured = summary ? summary.total - (lifeRows || []).filter((r) => r.remainingKm == null && r.remainingHours == null).length : null

  const risk = useMemo(() => maintenanceRisk({
    breakdowns: bdCard.data ? bdCard.data.rows : null,
    jobCards: jobCard.data ? jobCard.data.rows : null,
    now,
  }), [bdCard.data, jobCard.data, now])
  const gaps = useMemo(() => (covCard.data ? signalGaps(covCard.data) : null), [covCard.data])
  const history = useMemo(
    () => (histCard.data ? historyDemandRows(forecastTyreDemand(histCard.data.rows, { window: 12, ahead: 3 })) : []),
    [histCard.data],
  )

  // Due tyre table
  const [q, setQ] = useState('')
  const [site, setSite] = useState('')
  const [band, setBand] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const dueFiltered = useMemo(() => filterDueRows(dueRows, { q, site, band }), [dueRows, q, site, band])
  const dueSites = useMemo(() => [...new Set(dueRows.map((r) => r.site).filter(Boolean))].sort(), [dueRows])
  const duePages = Math.max(1, Math.ceil(dueFiltered.length / pageSize))
  const duePage = Math.min(page, duePages - 1)
  const hasDueFilters = !!(q || site || band)
  const setFilter = (fn) => (v) => { fn(v); setPage(0) }

  // Maintenance risk table
  const [riskPage, setRiskPage] = useState(0)
  const [riskSize, setRiskSize] = useState(10)
  const riskPages = Math.max(1, Math.ceil(risk.rows.length / riskSize))
  const riskPageSafe = Math.min(riskPage, riskPages - 1)

  const exportTable = async (kind, rows, cols, name) => {
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await loadExportUtils()
      const file = reportFileName(name, scopeLabel)
      if (kind === 'xlsx') await exportToExcel(rows, cols.map((c) => c.key), cols.map((c) => c.header), file)
      else await exportToPdf(rows, cols, `${name} (${scopeLabel})`, file, 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const refreshAll = () => { lifeCard.retry(); bdCard.retry(); jobCard.retry(); covCard.retry(); histCard.retry() }
  const lifeFailed = !!lifeCard.error
  const lifeLoading = lifeCard.loading && !lifeCard.data
  const riskLoading = (bdCard.loading && !bdCard.data) || (jobCard.loading && !jobCard.data)
  const riskState = {
    loading: riskLoading,
    // Only when BOTH sources failed is there nothing honest to show.
    error: bdCard.error && jobCard.error ? 'Breakdowns and job cards could not be read.' : null,
    retry: () => { bdCard.retry(); jobCard.retry() },
    data: bdCard.data || jobCard.data ? true : null,
  }

  const kpis = [
    { icon: AlertTriangle, tone: 't-red', value: summary?.overdue, display: lifeFailed ? 'N/A' : undefined, loading: lifeLoading, label: 'Tyres past expected life', title: 'Active tyres whose running km or hours have used up their expected life.', onClick: () => { setBand('overdue'); setPage(0) } },
    { icon: Clock, tone: 't-amber', value: summary?.dueSoon, display: lifeFailed ? 'N/A' : undefined, loading: lifeLoading, label: 'Tyres due soon', title: 'Within the last 10% of expected life, or 90% or more used.', onClick: () => { setBand('due-soon'); setPage(0) } },
    { icon: CircleDot, tone: 't-blue', value: outlook?.upcoming, display: lifeFailed ? 'N/A' : undefined, loading: lifeLoading, label: 'Expected in the next 90 days', title: 'Tyres projected to reach their expected life in the next 90 days, not counting those already past it.' },
    { icon: Wrench, tone: 't-orange', value: risk.summary.longBreakdowns, display: bdCard.error ? 'N/A' : undefined, loading: bdCard.loading && !bdCard.data, label: `Assets down ${LONG_BREAKDOWN_DAYS} days or more`, title: bdCard.error ? 'The breakdown register could not be read.' : 'Open breakdowns only. A breakdown closes when a return to service is recorded.' },
    { icon: Repeat, tone: 't-purple', value: risk.summary.repeatAssets, display: jobCard.error ? 'N/A' : undefined, loading: jobCard.loading && !jobCard.data, label: `Assets with ${REPEAT_JOB_CARDS}+ job cards in ${JOB_CARD_WINDOW_DAYS} days`, title: jobCard.error ? 'Job cards could not be read.' : `${fmtInt(risk.summary.cardsInWindow)} job cards opened in the last ${JOB_CARD_WINDOW_DAYS} days were read.` },
    { icon: Gauge, tone: 't-green', loading: covCard.loading && !covCard.data, display: covCard.error || !gaps || gaps.meter.pct == null ? 'N/A' : `${gaps.meter.pct}%`, label: 'Assets with a current odometer', title: gaps?.meter.note || 'Meter coverage could not be checked.' },
  ]

  const dueColumns = [
    { key: 'asset', header: 'Asset', cell: (r) => assetLink(r.asset) },
    { key: 'position', header: 'Position', cell: (r) => r.position || na() },
    { key: 'serial', header: 'Serial', cell: (r) => r.serial || na() },
    { key: 'size', header: 'Size', cell: (r) => r.size || na() },
    { key: 'site', header: 'Site', cell: (r) => r.site || na() },
    { key: 'band', header: 'State', cell: (r) => <span className={`cc-pill ${BAND_TONE[r.band] || 'muted'}`}>{r.bandLabel}</span> },
    { key: 'remaining', header: 'Remaining', align: 'right', cell: (r) => (r.remaining == null ? na() : remainingText(r)) },
    { key: 'usedPct', header: 'Life used', align: 'right', cell: (r) => (r.usedPct == null ? na() : `${Math.round(r.usedPct)}%`) },
    { key: 'fittedOn', header: 'Fitted on', cell: (r) => (r.fittedOn ? String(r.fittedOn).slice(0, 10) : na('Not recorded')) },
  ]
  const sizeColumns = outlook ? [
    { key: 'size', header: 'Size', cell: (r) => (r.size === 'UNKNOWN' ? na('Size not recorded') : r.size) },
    { key: 'overdue', header: 'Past life now', align: 'right', cell: (r) => fmtInt(r.overdue) },
    ...outlook.windows.map((w) => ({ key: w.key, header: w.label, align: 'right', cell: (r) => fmtInt(r[w.key]) })),
    { key: 'total', header: 'Total to plan', align: 'right', cell: (r) => <b>{fmtInt(r.total)}</b> },
  ] : []
  const riskColumns = [
    { key: 'asset', header: 'Asset', cell: (r) => assetLink(r.asset) },
    ...(country ? [] : [{ key: 'country', header: 'Country', cell: (r) => r.country || na() }]),
    { key: 'site', header: 'Site', cell: (r) => r.site || na() },
    { key: 'reason', header: 'Why it is listed', cell: (r) => <span className="pm-wrap">{r.reason}</span> },
    { key: 'downDays', header: 'Days down', align: 'right', cell: (r) => (bdCard.error ? na('N/A', 'The breakdown register could not be read') : r.downDays == null ? na('Not down') : <span className={r.long ? 'pm-overdue' : undefined}>{fmtInt(r.downDays)}</span>) },
    { key: 'jobCards', header: `Job cards, ${JOB_CARD_WINDOW_DAYS} days`, align: 'right', cell: (r) => (r.jobCards == null ? na('N/A', 'Job cards could not be read') : fmtInt(r.jobCards)) },
    { key: 'breakdownDetail', header: 'Breakdown detail', cell: (r) => (r.breakdownDetail ? <span className="pm-wrap">{r.breakdownDetail}</span> : na('None')) },
  ]

  return (
    <div className="cc pm-page">
      <PageHero
        title="Predictive Maintenance"
        lead={<>What needs attention next, from recorded facts only.<span className="pm-lead-2">Tyre running life against expected life, job card history and open breakdowns. Nothing here is estimated from a reading the fleet does not take.</span></>}
        imgLight="/dashboard/hero-predictive-light.webp"
        imgDark="/dashboard/hero-predictive-dark.webp"
      />

      <div className="pm-toolbar">
        <p className="pm-asof">Scope: {scopeLabel}. Counts only on this page, so no currencies are mixed.</p>
        <button type="button" className="cc-btn-ghost" onClick={refreshAll}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
      </div>

      {actionError && (
        <div className="pm-banner pm-banner-warn" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{actionError}</span>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      {/* One short note instead of empty tread, pressure, risk and budget panels. */}
      <div className="pm-banner" role="note">
        <Info size={15} aria-hidden="true" />
        <span>
          {covCard.loading && !covCard.data ? 'Checking which readings the fleet records...'
            : covCard.error || !gaps ? 'Which readings the fleet records could not be checked. Wear, pressure, risk score and budget predictions are not shown on this page.'
              : <>{gaps.note} {gaps.meter.note}</>}
        </span>
      </div>

      <div className="cc-kpis">
        {kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      <Card
        title="Tyres due by running life"
        sub="Active tyres past their expected life or close to it. Expected life is your target for the size or type, or the fleet's measured average when no target is set."
        action={
          <div className="pm-detail-actions">
            <button type="button" className="cc-btn-ghost" disabled={!dueFiltered.length} onClick={() => exportTable('xlsx', dueExportRows(dueFiltered), DUE_EXPORT_COLUMNS, 'Tyres Due by Running Life')}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
            <button type="button" className="cc-btn-ghost" disabled={!dueFiltered.length} onClick={() => exportTable('pdf', dueExportRows(dueFiltered), DUE_EXPORT_COLUMNS, 'Tyres Due by Running Life')}><FileText size={14} aria-hidden="true" /> PDF</button>
            <Link className="cc-btn-ghost" to="/tyre-lifecycle">Running and remaining <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
        }
      >
        <div className="cc-filters">
          <div className="cc-search">
            <Search size={15} aria-hidden="true" />
            <label htmlFor="pm-due-search" className="sr-only">Search due tyres</label>
            <input id="pm-due-search" value={q} onChange={(e) => setFilter(setQ)(e.target.value)} placeholder="Search asset, serial, size, brand..." />
          </div>
          <select className="cc-select" aria-label="Site" value={site} onChange={(e) => setFilter(setSite)(e.target.value)}>
            <option value="">All sites</option>
            {dueSites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="cc-select" aria-label="State" value={band} onChange={(e) => setFilter(setBand)(e.target.value)}>
            <option value="">Past life and due soon</option>
            <option value="overdue">{BAND_META.overdue.label}</option>
            <option value="due-soon">{BAND_META['due-soon'].label}</option>
          </select>
          {hasDueFilters && <button type="button" className="cc-btn-ghost" onClick={() => { setQ(''); setSite(''); setBand(''); setPage(0) }}><X size={13} aria-hidden="true" /> Reset</button>}
        </div>
        <CardState state={lifeCard} lines={6}
          empty={lifeCard.data && (dueRows.length === 0
            ? (summary.total === 0 ? 'No active tyres in this scope.' : `None of the ${fmtInt(measured)} measurable tyres is past or near its expected life.`)
            : dueFiltered.length === 0 ? 'No due tyres match these filters.' : null)}>
          <KitTable className="pm-compact" manualPagination showPagination={false} enableSorting={false}
            pageIndex={duePage} pageSize={pageSize} pageCount={duePages} totalRows={dueFiltered.length}
            getRowId={(r) => r.id} rows={dueFiltered.slice(duePage * pageSize, duePage * pageSize + pageSize)} columns={dueColumns} />
          <Pager page={duePage} pageSize={pageSize} total={dueFiltered.length} noun="tyres"
            onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(0) }} sizes={[10, 25, 50, 100]} />
        </CardState>
        {summary && (
          <p className="cc-card-sub" style={{ marginTop: 8 }}>
            Coverage: {fmtInt(measured)} of {fmtInt(summary.total)} active tyres can be measured against an expected life. {coverageNote(summary)}
          </p>
        )}
      </Card>

      <Card
        title="Expected replacements, next 90 days"
        sub={`Each tyre's remaining km or hours divided by what it has actually run per day since fitment (tyres fitted at least ${MIN_RATE_DAYS} days). Where a tyre has no usable rate, the fleet's usual days in service for its kind is used.`}
      >
        <CardState state={lifeCard} lines={5}
          empty={outlook && outlook.total === 0 ? 'No active tyres in this scope.' : outlook && outlook.needed === 0 ? `No tyre is projected to reach its expected life in the next ${outlook.horizonDays} days. ${fmtInt(outlook.notProjectable)} could not be projected.` : null}>
          {outlook && (
            <>
              <div className="cc-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                <div className="cc-card cc-kpi"><div className="cc-kpi-body"><div className="cc-kpi-val" style={{ color: 'var(--cc-red)' }}>{fmtInt(outlook.overdue)}</div><div className="cc-kpi-label">Past life now</div></div></div>
                {outlook.windows.map((w) => (
                  <div key={w.key} className="cc-card cc-kpi"><div className="cc-kpi-body"><div className="cc-kpi-val">{fmtInt(w.count)}</div><div className="cc-kpi-label">{w.label}</div></div></div>
                ))}
              </div>
              <KitTable className="pm-compact" enableSorting={false} showPagination={outlook.bySize.length > 10}
                getRowId={(r) => r.size} rows={outlook.bySize} columns={sizeColumns} />
              <p className="cc-card-sub" style={{ marginTop: 8 }}>
                Basis: {fmtInt(outlook.basis.own_rate)} tyres projected on their own usage rate, {fmtInt(outlook.basis.fleet_days)} on the fleet's usual days in service. {fmtInt(outlook.later)} are projected beyond {outlook.horizonDays} days. {fmtInt(outlook.notProjectable)} of {fmtInt(outlook.total)} active tyres could not be projected (no meter reading and no baseline), so they are not counted either way.
              </p>
            </>
          )}
        </CardState>
        <div className="pm-banner" role="note" style={{ marginTop: 10 }}>
          <Info size={15} aria-hidden="true" />
          <span>
            <b>For comparison, fitment history alone: </b>
            {histCard.loading && !histCard.data ? 'loading...'
              : histCard.error ? 'the fitment history could not be read.'
                : history.length === 0 ? 'no fitments in the last 12 months, so there is no history to project.'
                  : <>{history.map((h) => `${h.label}: ${h.count == null ? 'N/A' : fmtInt(h.count)} tyres`).join(', ')}. This is the trend of tyres actually fitted over the last 12 months. </>}
            {' '}<Link className="cc-link" to="/forecasting">By size and cost in Forecasting</Link>
          </span>
        </div>
      </Card>

      <Card
        title="Maintenance risk"
        sub={`Assets with an open breakdown of ${LONG_BREAKDOWN_DAYS} days or more, or ${REPEAT_JOB_CARDS} or more job cards opened in the last ${JOB_CARD_WINDOW_DAYS} days. Recorded facts only, no score.`}
        action={
          <div className="pm-detail-actions">
            <button type="button" className="cc-btn-ghost" disabled={!risk.rows.length} onClick={() => exportTable('xlsx', riskExportRows(risk.rows), RISK_EXPORT_COLUMNS, 'Maintenance Risk Assets')}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
            <button type="button" className="cc-btn-ghost" disabled={!risk.rows.length} onClick={() => exportTable('pdf', riskExportRows(risk.rows), RISK_EXPORT_COLUMNS, 'Maintenance Risk Assets')}><FileText size={14} aria-hidden="true" /> PDF</button>
            <Link className="cc-btn-ghost" to="/asset-breakdowns">Breakdown register <ArrowRight size={13} aria-hidden="true" /></Link>
          </div>
        }
      >
        {bdCard.error && !jobCard.error && <p className="pm-note" role="alert">The breakdown register could not be read, so this list shows repeat job cards only. <button type="button" className="cc-btn-ghost" onClick={bdCard.retry}>Try again</button></p>}
        {jobCard.error && !bdCard.error && <p className="pm-note" role="alert">Job cards could not be read, so this list shows long breakdowns only. <button type="button" className="cc-btn-ghost" onClick={jobCard.retry}>Try again</button></p>}
        {jobCard.data?.truncated && <p className="pm-note" role="status">More job cards were opened in this window than this page reads at once, so repeat counts are a lower bound. Pick a country to narrow it.</p>}
        <CardState state={riskState} lines={6}
          empty={riskState.data && risk.rows.length === 0 ? `No asset has a breakdown open ${LONG_BREAKDOWN_DAYS} days or more, or ${REPEAT_JOB_CARDS} or more job cards in ${JOB_CARD_WINDOW_DAYS} days.` : null}>
          <KitTable className="pm-compact" manualPagination showPagination={false} enableSorting={false}
            pageIndex={riskPageSafe} pageSize={riskSize} pageCount={riskPages} totalRows={risk.rows.length}
            getRowId={(r) => r.id} rows={risk.rows.slice(riskPageSafe * riskSize, riskPageSafe * riskSize + riskSize)} columns={riskColumns} />
          <Pager page={riskPageSafe} pageSize={riskSize} total={risk.rows.length} noun="assets"
            onPage={setRiskPage} onPageSize={(n) => { setRiskSize(n); setRiskPage(0) }} sizes={[10, 25, 50]} />
        </CardState>
        {riskState.data && (
          <p className="cc-card-sub" style={{ marginTop: 8 }}>
            Read: {risk.summary.openBreakdowns == null ? 'breakdowns N/A' : `${fmtInt(risk.summary.openBreakdowns)} open breakdowns`}, {risk.summary.cardsInWindow == null ? 'job cards N/A' : `${fmtInt(risk.summary.cardsInWindow)} job cards in the last ${JOB_CARD_WINDOW_DAYS} days`}. Job cards with a future date are ignored.
          </p>
        )}
      </Card>
    </div>
  )
}
