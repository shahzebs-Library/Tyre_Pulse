/**
 * Brand Performance (route /brand-perf) rebuilt on the shared page kit to the
 * owner's mockup: KPI strip, brand ranking / failure rate / cost vs life
 * cards, a filter bar, the brand scoreboard and a brand insight card.
 *
 * Data: tyre_records (country-scoped, newest 50,000) for per-brand volume,
 * rated-subset failure rate, tyre life and CPK (kpiEngine); warranty_claims
 * for claims, acceptance and credit recovered; the expense grid
 * (loadGovernedCostSplit) for the authoritative fleet tyre cost. Shaping
 * lives in src/lib/brandPerformanceView.js.
 *
 * Honest gaps: risk_level is often blank, so failure rate is measured over
 * rated tyres only and reads N/A when none are rated. Life and CPK need both
 * fitment and removal km. Money is N/A on the All-countries scope. No earlier
 * snapshot is stored, so the KPI tiles carry no trend arrows.
 *
 * Kept from the previous page: period, site and risk filters, Excel and PDF
 * export, the volume and failure charts with full-screen view, the per-brand
 * detail table, the brand drill-down and the value-by-size comparison.
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { linearRegression, bucketByMonth, recordCost } from '../lib/analyticsEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  Maximize2, X, Download, FileText, Award, AlertTriangle, ChevronRight,
  Ruler, Trophy, Tag, ShieldAlert, Layers, Coins, Search, Info, GitCompare, Activity,
} from 'lucide-react'
import { Card, CardState, Kpi, Tabs, KitTable, fmtInt } from '../components/commandCenter/kit'
import { getBrandSizeCpk } from '../lib/api/brandSizeCpk'
import { groupBySize, recommendationFor, formatNumber, formatCpk } from '../lib/brandSizeCpk'
import PeriodFilter, { filterByPeriodValue, periodLabel } from '../components/ui/PeriodFilter'
import { ChartModal } from '../components/ChartModal'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import { loadGovernedCostSplit, COST_SPLIT_TTL_MS } from '../lib/api/governedCost'
import { listWarrantyClaims } from '../lib/api/warranty'
import { scopeClaimsByCountry } from '../lib/warrantyTrackerAnalytics'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { toUserMessage } from '../lib/safeError'
import { compareValues } from '../lib/consoleTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  RISK_LEVELS, filterBrandRecords, buildBrandMetrics, summarizeBrands,
  failureBand, categoryBreakdown, brandExportRows,
  BRAND_EXPORT_COLS, BRAND_EXPORT_HEADERS, flattenSizeGroups,
} from '../lib/brandPerformanceAnalytics'
import {
  brandFilterOptions, filterByClassAndSize, brandScoreboard, brandHeadlines, brandInsight,
  rankingBars, failureBars, brandInitials, scoreTone, failureTone, SCORE_LABEL, SCORE_WEIGHTS,
  scoreboardExportRows, SCOREBOARD_EXPORT_COLS, SCOREBOARD_EXPORT_HEADERS,
} from '../lib/brandPerformanceView'
import './BrandPerformance.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

// One sort rule for every column: number/date aware, blanks last.
const SORT = {
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
}
const undef = (v) => (v == null || v === '' ? undefined : v)

const TICK = { color: 'var(--text-secondary)' }
const GRID = { color: 'var(--panel-2)' }
const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: { x: { grid: GRID, ticks: TICK }, y: { grid: GRID, ticks: TICK, beginAtZero: true } },
}
const BAND_FILL = { high: 'rgba(239,68,68,0.7)', elevated: 'rgba(245,158,11,0.7)', low: 'rgba(16,185,129,0.7)' }

const inputCls =
  'rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] px-3 min-h-[44px] sm:min-h-[38px] '
  + 'text-sm text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(d)}%`)
const km = (v) => (v == null ? null : `${Math.round(v / 1000).toLocaleString('en-US')}k`)
const NA = ({ why }) => <span className="cc-na" title={why}>N/A</span>

function MiniStat({ label, value }) {
  return (
    <div className="bp-mini">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

/** KPI label with a quiet second line, inside the kit tile. */
const kpiLabel = (label, sub) => (
  <>{label}{sub && <small className="bp-kpi-sub">{sub}</small>}</>
)

const TABS = [
  { key: 'board', label: 'Brand scoreboard' },
  { key: 'charts', label: 'Volume and detail' },
  { key: 'size', label: 'Value by size' },
]

export default function BrandPerformance() {
  const { activeCountry, activeCurrency } = useSettings()
  const money = !!activeCountry && activeCountry !== 'All'
  const [records, setRecords] = useState([])
  const [recordsTruncated, setRecordsTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [claims, setClaims] = useState([])
  const [claimsError, setClaimsError] = useState(null)
  const [cost, setCost] = useState({ loading: true, value: null, blended: false, failed: false })
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('board')

  const [period, setPeriod] = useState({ mode: 'all' })
  const [site, setSite] = useState('')
  const [risk, setRisk] = useState('')
  const [assetClass, setAssetClass] = useState('')
  const [size, setSize] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const chartRef = useRef(null)
  const insightRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Per-row brand aggregation has no server RPC, so this stays a client
      // pull. BOUNDED: country-scoped, newest first, capped at 50,000 rows.
      const { data, error: e, truncated } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,issue_date,brand,site,size,vehicle_type,category,risk_level,cost_per_tyre,qty,km_at_fitment,km_at_removal,description,remarks')
          .order('issue_date', { ascending: false })
          .order('id', { ascending: true })
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      }, { max: 50000 })
      if (e) throw e
      setRecords(data || [])
      setRecordsTruncated(!!truncated)
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load brand data.'))
      setRecords([])
      setRecordsTruncated(false)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  const loadClaims = useCallback(async () => {
    setClaimsError(null)
    try {
      setClaims(await listWarrantyClaims() || [])
    } catch (err) {
      setClaims([])
      setClaimsError(toUserMessage(err, 'Warranty claims could not be read.'))
    }
  }, [])

  const loadCost = useCallback(() => {
    let alive = true
    setCost((c) => ({ ...c, loading: true, failed: false }))
    loadGovernedCostSplit({ country: activeCountry, maxAgeMs: COST_SPLIT_TTL_MS })
      .then((r) => { if (alive) setCost({ loading: false, value: r?.tyre ?? null, blended: !!r?.blended, failed: false, window: r?.window }) })
      .catch(() => { if (alive) setCost({ loading: false, value: null, blended: false, failed: true }) })
    return () => { alive = false }
  }, [activeCountry])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadClaims() }, [loadClaims])
  useEffect(() => loadCost(), [loadCost])

  const options = useMemo(() => brandFilterOptions(records), [records])
  const filtered = useMemo(() => filterByClassAndSize(
    filterBrandRecords(filterByPeriodValue(records, period, 'issue_date'), {
      sites: site ? [site] : [], riskLevels: risk ? [risk] : [],
    }),
    { assetClass, size },
  ), [records, period, site, risk, assetClass, size])

  const scopedClaims = useMemo(() => {
    const byCountry = scopeClaimsByCountry(claims, activeCountry)
    return filterByPeriodValue(byCountry, period, 'created_at')
      .filter((c) => !site || (c.site || '') === site)
      .filter((c) => !size || (c.size || '') === size)
  }, [claims, activeCountry, period, site, size])

  const board = useMemo(() => brandScoreboard(filtered, { claims: scopedClaims, money }), [filtered, scopedClaims, money])
  const metrics = useMemo(() => buildBrandMetrics(filtered), [filtered])
  const summary = useMemo(() => summarizeBrands(metrics), [metrics])
  const heads = useMemo(() => brandHeadlines(board), [board])
  const visibleBoard = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? board.filter((r) => r.brand.toLowerCase().includes(q)) : board
  }, [board, search])
  const insight = useMemo(() => brandInsight(board, selected), [board, selected])
  const selectedData = useMemo(() => (selected ? filtered.filter((r) => (r.brand || 'Unknown') === selected) : []), [filtered, selected])

  const hasFilter = period.mode !== 'all' || site || risk || assetClass || size
  const scopeLabel = [
    periodLabel(period).replace('\u2192', 'to').replace(/\u2026/g, 'any'),
    site ? `Site ${site}` : null,
    risk ? `Risk ${risk}` : null,
    assetClass ? `Asset class ${assetClass}` : null,
    size ? `Size ${size}` : null,
  ].filter(Boolean).join(' | ')
  function clearFilters() { setPeriod({ mode: 'all' }); setSite(''); setRisk(''); setAssetClass(''); setSize(''); setSearch('') }

  const selectBrand = (brand) => {
    setSelected((cur) => (cur === brand ? null : brand))
    requestAnimationFrame(() => insightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  // Detail tab charts (kept from the previous page).
  const top10 = metrics.slice(0, 10)
  const rankingChart = {
    labels: top10.map((b) => b.brand),
    datasets: [{
      label: 'Records',
      data: top10.map((b) => b.count),
      backgroundColor: top10.map((b, i) => BAND_FILL[failureBand(b.failureRate)] || withAlpha(colorAt(i), 0.7)),
      borderRadius: 4,
    }],
  }
  const rated10 = metrics.filter((b) => b.failureRate != null).slice(0, 10)
  const failureRateChart = {
    labels: rated10.map((b) => b.brand),
    datasets: [{
      label: 'High-risk failure rate %',
      data: rated10.map((b) => Number(b.failureRate.toFixed(1))),
      backgroundColor: rated10.map((b) => BAND_FILL[failureBand(b.failureRate)]),
      borderRadius: 4,
    }],
  }

  const exportFile = reportFileName('TyrePulse Brand Performance', money ? activeCountry : null)
  const doExcel = () => exportToExcel(scoreboardExportRows(board), SCOREBOARD_EXPORT_COLS, SCOREBOARD_EXPORT_HEADERS, exportFile, 'Brands')
  const doPdf = () => exportToPdf(
    scoreboardExportRows(board),
    SCOREBOARD_EXPORT_COLS.map((k, i) => ({ key: k, header: SCOREBOARD_EXPORT_HEADERS[i] })),
    `Brand Performance (${scopeLabel || 'All periods'})`,
    exportFile, 'landscape',
  )
  const detailFile = reportFileName('TyrePulse Brand Detail', money ? activeCountry : null)
  const doDetailExcel = () => exportToExcel(brandExportRows(metrics), BRAND_EXPORT_COLS, BRAND_EXPORT_HEADERS, detailFile, 'Brands')

  const money$ = (v) => (v == null ? null : formatCurrencyCompact(v, activeCurrency))
  const moneyWhy = money ? 'No priced data for this brand' : 'Pick a country: SAR, AED and EGP are never added together'

  const columns = useMemo(() => [
    {
      key: 'brand', header: 'Brand', sortValue: (r) => r.brand,
      cell: (r) => <span className={`bp-brand ${selected === r.brand ? 'is-sel' : ''}`}><i>{brandInitials(r.brand)}</i>{r.brand}</span>,
    },
    { key: 'tyres', header: 'Tyres', numeric: true, cell: (r) => fmtInt(r.tyres) },
    {
      key: 'avgLifeKm', header: 'Avg life km', numeric: true, sortValue: (r) => undef(r.avgLifeKm),
      cell: (r) => (r.avgLifeKm == null ? <NA why="No tyre with both fitment and removal km" /> : <span title={`${r.lifeCount} tyres measured`}>{fmtInt(r.avgLifeKm)}</span>),
    },
    {
      key: 'failurePct', header: 'Failure %', numeric: true, sortValue: (r) => undef(r.failurePct),
      cell: (r) => (r.failurePct == null ? <NA why="No risk-rated tyre for this brand" /> : (
        <span className={`bp-tone ${failureTone(r.failurePct)}`} title={`${r.ratedCount} of ${r.tyres} tyres rated`}>{pct(r.failurePct)}</span>
      )),
    },
    {
      key: 'avgCpk', header: 'Avg CPK', numeric: true, sortValue: (r) => undef(r.avgCpk),
      cell: (r) => (r.avgCpk == null ? <NA why={money ? 'Needs a price plus fitment and removal km' : moneyWhy} /> : <span title={`${r.cpkCount} tyres measured`}>{r.avgCpk.toFixed(3)}</span>),
    },
    {
      key: 'purchaseCost', header: 'Purchase cost', numeric: true, sortValue: (r) => undef(r.purchaseCost),
      cell: (r) => (r.purchaseCost == null ? <NA why={moneyWhy} /> : <span title={`${r.pricedCount} priced tyres`}>{money$(r.purchaseCost)}</span>),
    },
    {
      key: 'retreadPct', header: 'Retread %', numeric: true, sortValue: (r) => undef(r.retreadPct),
      cell: (r) => (r.retreadPct == null ? <NA why="No category recorded on these tyres" /> : pct(r.retreadPct, 0)),
    },
    {
      key: 'warrantyRecovery', header: 'Warranty recovery', numeric: true, sortValue: (r) => undef(r.warrantyRecovery),
      cell: (r) => {
        if (claimsError) return <NA why="Warranty claims could not be read" />
        if (!r.warrantyClaims) return <span className="cc-na">No claims</span>
        if (r.warrantyRecovery == null) return <span className="cc-na" title={money ? 'No credit issued yet' : moneyWhy}>{fmtInt(r.warrantyClaims)} open</span>
        return money$(r.warrantyRecovery)
      },
    },
    {
      key: 'score', header: 'Score', numeric: true, sortValue: (r) => undef(r.score),
      cell: (r) => (r.score == null ? <NA why="Needs at least two measured components" /> : (
        <span className={`bp-score ${scoreTone(r.score)}`} title={`From ${r.scoreParts.map((k) => SCORE_LABEL[k]).join(', ')}`}>{r.score}</span>
      )),
    },
  ], [selected, money, moneyWhy, claimsError, activeCurrency]) // eslint-disable-line react-hooks/exhaustive-deps

  const detailColumns = useMemo(() => [
    { key: 'rank', header: '#', numeric: true },
    { key: 'brand', header: 'Brand', cell: (r) => <b>{r.brand}</b> },
    { key: 'count', header: 'Records', numeric: true, cell: (r) => fmtInt(r.count) },
    { key: 'ratedCount', header: 'Rated', numeric: true, cell: (r) => fmtInt(r.ratedCount) },
    { key: 'avgCost', header: 'Avg per priced tyre', numeric: true, sortValue: (r) => undef(r.avgCost), cell: (r) => (!money || r.avgCost == null ? <NA why={moneyWhy} /> : money$(r.avgCost)) },
    { key: 'topCategory', header: 'Top category', cell: (r) => r.topCategory ?? <NA why="No category recorded" /> },
    { key: 'riskScore', header: 'Risk score', numeric: true, sortValue: (r) => undef(r.riskScore), cell: (r) => (r.riskScore == null ? <NA why="No rated tyres" /> : r.riskScore.toFixed(2)) },
  ], [money, moneyWhy]) // eslint-disable-line react-hooks/exhaustive-deps

  const costTile = (() => {
    if (cost.loading) return { display: '...', sub: 'Expense grid' }
    if (!money || cost.blended) return { display: 'N/A', sub: 'Pick a country to total one currency' }
    if (cost.failed || cost.value == null) return { display: 'N/A', sub: 'Expense grid could not be read' }
    return { display: formatCurrencyCompact(cost.value, activeCurrency), sub: 'Expense grid, last 12 months' }
  })()

  const rankBars = rankingBars(board)
  const failBars = failureBars(board)
  const maxFail = Math.max(1, ...failBars.map((b) => b.value))
  const costLife = board.filter((r) => r.avgLifeKm != null || r.avgCpk != null).slice(0, 6)

  const header = (
    <header className="bp-head">
      <div className="bp-head-copy">
        <nav className="bp-crumb" aria-label="Breadcrumb">
          <Link to="/tyre-records">Tyre management</Link>
          <ChevronRight size={13} aria-hidden="true" />
          <span aria-current="page">Brand performance</span>
        </nav>
        <h1>Brand Performance</h1>
        <p>Compare failure rate, cost, life and ranking by tyre brand across the fleet.</p>
      </div>
      <div className="bp-head-actions">
        <div className="bp-period"><PeriodFilter records={records} value={period} onChange={setPeriod} /></div>
        <select className="cc-select bp-head-select" aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">All sites</option>
          {options.sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" className="cc-btn-ghost" onClick={doExcel} disabled={!board.length}><Download size={15} aria-hidden="true" /> Excel</button>
        <button type="button" className="cc-btn-primary" onClick={doPdf} disabled={!board.length}><FileText size={15} aria-hidden="true" /> Export report</button>
      </div>
    </header>
  )

  if (error) return (
    <div className="cc bp-page">
      {header}
      <Card><CardState state={{ loading: false, error, retry: load }} /></Card>
    </div>
  )

  return (
    <div className="cc bp-page">
      {header}

      {recordsTruncated && (
        <div role="status" className="bp-banner">
          <Info size={16} aria-hidden="true" />
          <p>Capped view: the most recent 50,000 tyre records for this country. Narrow the country or period for complete per brand detail. The fleet tyre cost tile is a server total and stays exact.</p>
        </div>
      )}

      <div className="cc-kpis bp-kpis">
        <Kpi icon={Layers} tone="t-blue" loading={loading} value={summary.brandCount}
          label={kpiLabel('Brands tracked', `${fmtInt(summary.records)} tyres in scope`)} />
        <Kpi icon={Coins} tone="t-purple" display={costTile.display}
          label={kpiLabel('Fleet tyre cost', costTile.sub)} title="Authoritative tyre spend from the classified expense grid" />
        <Kpi icon={ShieldAlert} tone="t-red" loading={loading} display={pct(summary.fleetFailureRate)}
          label={kpiLabel('Failure rate', summary.ratedPct == null ? 'No records' : `${summary.ratedPct.toFixed(0)}% of tyres risk-rated`)}
          title="High or Critical over risk-rated tyres only" />
        <Kpi icon={Award} tone="t-green" loading={loading} display={heads.best ? heads.best.brand : 'N/A'}
          onClick={heads.best ? () => selectBrand(heads.best.brand) : undefined}
          label={kpiLabel('Best brand', heads.best ? `Composite score ${heads.best.score}` : 'Needs two measured components')} />
        <Kpi icon={AlertTriangle} tone="t-amber" loading={loading} display={heads.worstFailure ? heads.worstFailure.brand : 'N/A'}
          onClick={heads.worstFailure ? () => selectBrand(heads.worstFailure.brand) : undefined}
          label={kpiLabel('Highest risk', heads.worstFailure ? `${pct(heads.worstFailure.failurePct)} of rated tyres` : 'Needs two rated brands')} />
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Brand performance views" variant="line" />

      {tab === 'board' && (
        <>
          <div className="bp-row">
            <Card title="Brand ranking" sub="Composite score from life, cost per km, failure rate and warranty acceptance">
              <CardState state={{ loading, error: null }} empty={!loading && !rankBars.length ? 'No brand has two measured components yet. Scores need life km, CPK, risk ratings or warranty decisions.' : null}>
                <div className="bp-vbars" role="img" aria-label={rankBars.map((b) => `${b.brand} ${b.value}`).join(', ')}>
                  {rankBars.map((b) => (
                    <button key={b.brand} type="button" className={`bp-vbar ${selected === b.brand ? 'is-sel' : ''}`} onClick={() => selectBrand(b.brand)} title={`${b.brand}: score ${b.value}`}>
                      <span className="bp-vbar-n">{b.value}</span>
                      <i style={{ height: `${Math.max(4, b.value)}%` }} />
                      <small>{brandInitials(b.brand)}</small>
                    </button>
                  ))}
                </div>
                <p className="bp-note">Weights: life {SCORE_WEIGHTS.life * 100}%, CPK {SCORE_WEIGHTS.cpk * 100}%, failure {SCORE_WEIGHTS.failure * 100}%, warranty {SCORE_WEIGHTS.warranty * 100}%, rebalanced over what each brand has.</p>
              </CardState>
            </Card>

            <Card title="Failure rate by brand" sub="High or Critical over risk-rated tyres">
              <CardState state={{ loading, error: null }} empty={!loading && !failBars.length ? 'No tyre in this scope carries a risk rating, so failure rate is not measured.' : null}>
                <ul className="bp-hbars">
                  {failBars.map((b) => (
                    <li key={b.brand}>
                      <button type="button" onClick={() => selectBrand(b.brand)} title={`${b.rated} rated tyres`}>
                        <span className="bp-hbar-label">{b.brand}</span>
                        <span className="bp-hbar-track"><i className={failureTone(b.value)} style={{ width: `${Math.max(3, (b.value / maxFail) * 100)}%` }} /></span>
                        <b>{pct(b.value, 0)}</b>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardState>
            </Card>

            <Card title="Cost vs life" sub={money ? `CPK in ${activeCurrency} per km` : 'CPK needs one country'}>
              <CardState state={{ loading, error: null }} empty={!loading && !costLife.length ? 'No tyre has both fitment and removal km yet.' : null}>
                <KitTable compact rows={costLife} getRowId={(r) => r.brand} onRowClick={(r) => selectBrand(r.brand)}
                  columns={[
                    { key: 'brand', header: 'Brand', cell: (r) => <b>{r.brand}</b> },
                    { key: 'life', header: 'Avg life', numeric: true, cell: (r) => km(r.avgLifeKm) ?? <NA why="No life km" /> },
                    { key: 'cpk', header: 'CPK', numeric: true, cell: (r) => (r.avgCpk == null ? <NA why={moneyWhy} /> : r.avgCpk.toFixed(3)) },
                    { key: 'war', header: 'Warranty', numeric: true, cell: (r) => (r.warrantyAcceptPct == null ? <NA why={r.warrantyClaims ? 'No claim decided yet' : 'No claims'} /> : pct(r.warrantyAcceptPct, 0)) },
                  ]} />
              </CardState>
            </Card>
          </div>

          <Card className="bp-filterbar">
            <div className="cc-filters">
              <div className="cc-search">
                <Search size={15} aria-hidden="true" />
                <input type="search" placeholder="Search brand" aria-label="Search brand" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <label className="cc-field"><span>Risk</span>
                <select className="cc-select" value={risk} onChange={(e) => setRisk(e.target.value)}>
                  <option value="">All</option>
                  {RISK_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label className="cc-field"><span>Asset class</span>
                <select className="cc-select" value={assetClass} onChange={(e) => setAssetClass(e.target.value)} disabled={!options.classes.length}>
                  <option value="">All</option>
                  {options.classes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="cc-field"><span>Size</span>
                <select className="cc-select" value={size} onChange={(e) => setSize(e.target.value)} disabled={!options.sizes.length}>
                  <option value="">All</option>
                  {options.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              {(hasFilter || search) && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
            </div>
            <p className="bp-scope" aria-live="polite">
              {scopeLabel || 'All time'} | {fmtInt(filtered.length)} of {fmtInt(records.length)} tyres | {fmtInt(visibleBoard.length)} brands
              {claimsError && <> | <span className="bp-warn">Warranty claims could not be read. <button type="button" className="cc-link-btn" onClick={loadClaims}>Retry</button></span></>}
            </p>
          </Card>

          <Card className="bp-register" title="Brand scoreboard" sub="Select a brand to see its insight and drill-down. Purchase cost sums priced tyre records; the authoritative fleet total is the expense grid tile above.">
            <KitTable
              rows={visibleBoard}
              columns={columns}
              loading={loading}
              getRowId={(r) => r.brand}
              onRowClick={(r) => selectBrand(r.brand)}
              empty={records.length === 0 ? 'No tyre records for this country yet. Import tyre records with a brand to compare brands.' : 'No brand matches these filters.'}
            />
          </Card>

          <section ref={insightRef} className="cc-card bp-insight" aria-label="Brand insight">
            <div className="bp-insight-copy">
              <h2>{selected ? `${selected} insight` : 'Brand insight'}</h2>
              {insight.length ? insight.map((l) => <p key={l}>{l}</p>) : <p>{loading ? 'Reading brand data...' : 'Not enough measured data in this scope to draw a conclusion.'}</p>}
              <p className="bp-insight-action">Before changing the approved brand policy, compare fitment position, pressure deviation, site mix and driver behaviour for the brands in question.</p>
            </div>
            <div className="bp-insight-actions">
              {selected && <button type="button" className="cc-btn-ghost" onClick={() => setSelected(null)}><X size={14} aria-hidden="true" /> Clear selection</button>}
              <button type="button" className="cc-btn-ghost" onClick={() => setTab('size')}><GitCompare size={15} aria-hidden="true" /> Compare brands by size</button>
              <Link className="cc-btn-primary" to="/tyre-failure-cpk"><Activity size={15} aria-hidden="true" /> Open failure analysis</Link>
            </div>
          </section>

          {selected && <BrandDrillDown brand={selected} records={selectedData} onClose={() => setSelected(null)} />}
        </>
      )}

      {tab === 'charts' && (
        <>
          <div className="bp-row bp-row-2">
            <Card title="Volume by brand" sub="Top 10 by tyre records; colour shows the failure band, grey means unrated"
              action={<button type="button" className="cc-icon-btn" onClick={() => setModalOpen(true)} aria-label="Open volume by brand chart full screen"><Maximize2 size={14} /></button>}>
              <CardState state={{ loading, error: null }} empty={!loading && !top10.length ? 'No records match these filters.' : null}>
                <div style={{ height: 250 }} role="img" aria-label={`Bar chart of tyre records for the top ${top10.length} brands`}>
                  <Bar ref={chartRef} data={rankingChart} options={CHART_OPTS} />
                </div>
              </CardState>
            </Card>
            <Card title="High-risk failure rate" sub="Rated brands, top 10">
              <CardState state={{ loading, error: null }} empty={!loading && !rated10.length ? 'No brand in this scope has risk-rated records.' : null}>
                <div style={{ height: 250 }} role="img" aria-label={`Bar chart of failure rate for ${rated10.length} rated brands`}>
                  <Bar data={failureRateChart} options={CHART_OPTS} />
                </div>
              </CardState>
            </Card>
          </div>
          <Card title="Brand detail" sub="Records, rated share, average purchase price, top category and weighted risk score"
            action={<button type="button" className="cc-btn-ghost" onClick={doDetailExcel} disabled={!metrics.length}><Download size={14} aria-hidden="true" /> Excel</button>}>
            <KitTable rows={metrics} columns={detailColumns} loading={loading} getRowId={(r) => r.brand}
              onRowClick={(r) => { setTab('board'); selectBrand(r.brand) }} empty="No records match these filters." />
          </Card>
        </>
      )}

      {tab === 'size' && <BrandSizeValuePanel country={activeCountry} />}

      <ChartModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Volume by brand (top 10)"
        chartRef={chartRef}
        filters={{}}
        filterOptions={{ sites: options.sites, brands: [] }}
        showSite={false}
        showBrand={false}
      >
        <div style={{ height: 480 }}>
          <Bar ref={chartRef} data={rankingChart} options={CHART_OPTS} />
        </div>
      </ChartModal>
    </div>
  )
}

function BrandDrillDown({ brand, records, onClose }) {
  const monthly = useMemo(() => bucketByMonth(records, r => r.issue_date, r => recordCost(r)), [records])
  const reg = monthly.length >= 2 ? linearRegression(monthly.map((d, i) => [i, d.count])) : null
  const cats = useMemo(() => categoryBreakdown(records), [records])
  const line = colorAt(0)

  const chartData = {
    labels: monthly.map(d => d.month),
    datasets: [
      { label: 'Records', data: monthly.map(d => d.count), borderColor: line, backgroundColor: withAlpha(line, 0.15), fill: true, tension: 0.4 },
      reg && {
        label: 'Trend', data: monthly.map((_, i) => Math.max(0, Math.round(reg.predict(i)))),
        borderColor: 'var(--text-muted)', borderDash: [4, 4], fill: false, pointRadius: 0,
      },
    ].filter(Boolean),
  }
  const lineOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--text-secondary)' } } },
    scales: { x: { grid: GRID, ticks: TICK }, y: { grid: GRID, ticks: TICK, beginAtZero: true } },
  }

  return (
    <section className="card border border-[var(--border-brand)] space-y-4" aria-label={`Drill-down for ${brand}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-[var(--text-primary)]">Drill-down: {brand}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">{records.length} records</span>
          <button onClick={onClose} aria-label="Close drill-down" className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--panel-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-[var(--text-secondary)] mb-3">Monthly record trend</p>
          {monthly.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No dated records for this brand.</p>
          ) : (
            <div style={{ height: 220 }} role="img" aria-label={`Monthly records for ${brand}`}><Line data={chartData} options={lineOpts} /></div>
          )}
          {reg && (
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Trend slope: {reg.slope > 0 ? 'up' : 'down'} {Math.abs(reg.slope).toFixed(2)} per month | R2 = {reg.r2.toFixed(2)}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)] mb-3">Category breakdown</p>
          <ul className="space-y-2">
            {cats.map(c => (
              <li key={c.category}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--text-primary)]">{c.category}</span>
                  <span className="text-[var(--text-secondary)] tabular-nums">{c.count} ({c.pct.toFixed(0)}%)</span>
                </div>
                <div className="h-1.5 bg-[var(--panel-2)] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: line }} />
                </div>
              </li>
            ))}
            {cats.length === 0 && <li className="text-[var(--text-muted)] text-sm">No category recorded on these tyres.</li>}
          </ul>
        </div>
      </div>
    </section>
  )
}

/**
 * BrandSizeValuePanel - for the SAME tyre size, which brand is cheapest to RUN
 * (cost per km), not just cheapest to buy. Reads get_brand_size_cpk (V446) and
 * ranks with the pure brandSizeCpk engine. Self-contained fetch.
 */
function BrandSizeValuePanel({ country }) {
  const { activeCurrency } = useSettings()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [minTyres, setMinTyres] = useState(2)
  const [bestOnly, setBestOnly] = useState(false)

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    getBrandSizeCpk({ country, from: from || null, to: to || null })
      .then(setRows)
      .catch(e => setErr(toUserMessage(e, 'Could not load the value comparison.')))
      .finally(() => setLoading(false))
  }, [country, from, to])

  useEffect(() => { load() }, [load])

  const groups = useMemo(() => groupBySize(rows, { minTyres }), [rows, minTyres])
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(g => g.size.toLowerCase().includes(q) || g.brands.some(b => b.brand.toLowerCase().includes(q)))
  }, [groups, search])
  const flat = useMemo(() => {
    const all = flattenSizeGroups(visibleGroups)
    return bestOnly ? all.filter(r => r.isBestValue) : all
  }, [visibleGroups, bestOnly])
  const sizesWithBest = visibleGroups.filter(g => g.brands.some(b => b.isBestValue)).length

  const exportRows = flat.map(b => ({
    size: b.size, brand: b.brand, tyres: b.tyres ?? 'N/A',
    avg_price: b.avgPrice != null ? Number(b.avgPrice.toFixed(2)) : 'N/A',
    median_price: b.medianPrice != null ? Number(b.medianPrice.toFixed(2)) : 'N/A',
    avg_life_km: b.avgLifeKm ?? 'N/A',
    cpk: b.cpk != null ? Number(b.cpk.toFixed(5)) : 'N/A',
    currency: b.currency, best_value: b.isBestValue ? 'Yes' : '',
  }))
  const EXPORT_COLS = ['size', 'brand', 'tyres', 'avg_price', 'median_price', 'avg_life_km', 'cpk', 'currency', 'best_value']
  const EXPORT_HEADERS = ['Size', 'Brand', 'Tyres', 'Avg price', 'Median price', 'Avg life (km)', 'Cost per km', 'Currency', 'Best value']
  const file = reportFileName('TyrePulse Brand Value By Size', country && country !== 'All' ? country : null)
  const doExcel = () => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, file, 'Value by size')
  const doPdf = () => exportToPdf(
    exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
    'Brand and price by size, value comparison' + (country && country !== 'All' ? ` (${country})` : ''),
    file, 'landscape',
  )

  const na = <span className="text-[var(--text-muted)]">N/A</span>
  const numCell = ({ getValue }) => (getValue() == null ? na : formatNumber(getValue()))
  const columns = useMemo(() => [
    { id: 'size', header: 'Size', accessorFn: r => r.size, size: 120, meta: { filterVariant: 'select' }, ...SORT },
    {
      id: 'brand', header: 'Brand', accessorFn: r => r.brand, size: 170, ...SORT,
      cell: ({ row }) => {
        const b = row.original
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`font-medium ${b.isBestValue ? 'text-green-400' : 'text-[var(--text-primary)]'}`}>{b.brand}</span>
            {b.isBestValue && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-green-400 bg-green-500/15 px-1.5 py-0.5 rounded-full">
                <Trophy size={10} aria-hidden="true" /> best value
              </span>
            )}
            {b.isCheapest && !b.isBestValue && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded-full">
                <Tag size={10} aria-hidden="true" /> cheapest
              </span>
            )}
          </div>
        )
      },
    },
    { id: 'avgPrice', header: 'Avg price', accessorFn: r => undef(r.avgPrice), size: 100, meta: { align: 'right' }, cell: numCell, ...SORT },
    { id: 'medianPrice', header: 'Median price', accessorFn: r => undef(r.medianPrice), size: 110, meta: { align: 'right' }, cell: numCell, ...SORT },
    { id: 'avgLifeKm', header: 'Avg life (km)', accessorFn: r => undef(r.avgLifeKm), size: 110, meta: { align: 'right' }, cell: numCell, ...SORT },
    {
      id: 'cpk', header: 'Cost per km', accessorFn: r => undef(r.cpk), size: 110, meta: { align: 'right' }, ...SORT,
      cell: ({ getValue, row }) => (getValue() == null ? na : (
        <span className={`font-mono tabular-nums ${row.original.isBestValue ? 'text-green-400 font-semibold' : 'text-[var(--text-primary)]'}`}>{formatCpk(getValue())}</span>
      )),
    },
    {
      id: 'cpkGapPct', header: 'vs best', accessorFn: r => undef(r.cpkGapPct), size: 90, meta: { align: 'right' }, ...SORT,
      cell: ({ getValue }) => {
        const v = getValue()
        if (v == null) return na
        return v === 0 ? <span className="text-green-400 text-xs">best</span> : <span className="text-amber-400 text-xs">+{formatNumber(v)}%</span>
      },
    },
    { id: 'tyres', header: 'Tyres', accessorFn: r => undef(r.tyres), size: 80, meta: { align: 'right' }, cell: numCell, ...SORT },
    { id: 'currency', header: 'Currency', accessorFn: r => undef(r.currency), size: 80, ...SORT },
  ], []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card space-y-4" aria-labelledby="bsv-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Ruler size={18} className="text-[var(--accent)] mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h3 id="bsv-title" className="font-semibold text-[var(--text-primary)]">Brand and price by size (value comparison)</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 max-w-2xl">
              For the same size, each brand&apos;s purchase price and the cost per km it actually delivers. A cheaper
              tyre that wears out fast can cost more per km than a pricier long-life tyre. Cost per km reads N/A
              until life data exists.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={doExcel} disabled={exportRows.length === 0} className="btn-secondary min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 text-xs px-3 disabled:opacity-40">
            <Download size={14} aria-hidden="true" /> Excel
          </button>
          <button onClick={doPdf} disabled={exportRows.length === 0} className="btn-secondary min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 text-xs px-3 disabled:opacity-40">
            <FileText size={14} aria-hidden="true" /> PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Sizes compared" value={loading || err ? 'N/A' : formatNumber(visibleGroups.length)} />
        <MiniStat label="Brand and size pairs" value={loading || err ? 'N/A' : formatNumber(flat.length)} />
        <MiniStat label="Sizes with a best value" value={loading || err ? 'N/A' : formatNumber(sizesWithBest)} />
        <MiniStat label="Sizes with thin life data" value={loading || err ? 'N/A' : formatNumber(visibleGroups.filter(g => g.thin).length)} />
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          From
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          To
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Min tyres per brand
          <select value={minTyres} onChange={e => setMinTyres(Number(e.target.value))} className={inputCls}>
            {[1, 2, 5, 10, 25].map(n => <option key={n} value={n}>{n}+</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[160px] text-xs text-[var(--text-secondary)]">
          Search size or brand
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="e.g. 315/80 or Techking" className={inputCls} />
        </label>
        <label className="inline-flex items-center gap-2 min-h-[44px] text-xs text-[var(--text-secondary)] cursor-pointer">
          <input type="checkbox" checked={bestOnly} onChange={e => setBestOnly(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
          Best value only
        </label>
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo('') }} className="btn-secondary min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1 text-xs px-3 self-end">
            <X size={13} aria-hidden="true" /> Clear dates
          </button>
        )}
      </div>

      <EnterpriseTable
        viewKey="brand-value-by-size"
        columns={columns}
        data={flat}
        getRowId={r => r.id}
        loading={loading}
        error={err}
        onRetry={load}
        enableGlobalFilter={false}
        enableColumnFilters
        enableExport={false}
        initialPageSize={25}
        pageSizeOptions={[25, 50, 100]}
        emptyMessage="No priced brand-by-size data for this selection. It needs tyre records with a size, a brand and a purchase price; widen the dates or lower the minimum tyres per brand."
      />

      {!loading && !err && visibleGroups.length > 0 && (
        <details className="rounded-lg border border-[var(--border)] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)] min-h-[32px] flex items-center">
            Recommendations by size ({visibleGroups.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {visibleGroups.map(g => (
              <li key={g.size} className="text-xs text-[var(--text-secondary)] leading-relaxed">
                <span className="font-medium text-[var(--text-primary)]">Size {g.size}: </span>
                {recommendationFor(g)}
                {g.thin && <span className="ml-1 text-amber-400">(thin life data)</span>}
                {(g.currency || activeCurrency) && <span className="ml-1 text-[var(--text-muted)]">prices in {g.currency || activeCurrency}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
