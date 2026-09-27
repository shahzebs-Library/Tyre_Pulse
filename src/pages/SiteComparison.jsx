import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { computeSiteMetrics, buildSiteRadar } from '../lib/analyticsEngine'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  GRANULARITIES, RISK_BANDS, siteRegister, summarizeSites, filterSites,
  trendSeries, siteExportRows, SITE_EXPORT_COLUMNS,
} from '../lib/siteComparisonAnalytics'
import {
  Download, FileText, Maximize2, GitMerge, AlertTriangle, RefreshCw, Search,
  MapPin, Coins, ShieldAlert, Scale, Percent, Layers, X, Info,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader } from '../components/ui/Card'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import EmailPdfButton from '../components/EmailPdfButton'
import PeriodFilter, { filterByPeriodValue, periodLabel } from '../components/ui/PeriodFilter'
import SegmentedControl from '../components/ui/SegmentedControl'
import {
  Chart as ChartJS, RadialLinearScale, PointElement, LineElement,
  Filler, Tooltip, Legend, CategoryScale, LinearScale, BarElement,
} from 'chart.js'
import { Radar, Bar, Line } from 'react-chartjs-2'
import { ChartModal } from '../components/ChartModal'

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement)

// Hard row ceiling for the bounded client read. tyre_records can grow to millions
// of rows, so the full-set read that builds the site list + per-site metrics is
// capped and a truncated read is surfaced as an honest "capped view" note.
const ROW_CAP = 50000
const MAX_COMPARE = 6

const TICK = 'var(--text-muted)'
const GRID = 'var(--panel-2)'
const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: TICK } } },
  scales: {
    x: { grid: { color: GRID }, ticks: { color: TICK } },
    y: { grid: { color: GRID }, ticks: { color: TICK } },
  },
}
const LINE_OPTS = BAR_OPTS
const RADAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: TICK, font: { size: 11 } } } },
  scales: {
    r: {
      min: 0, max: 100,
      grid: { color: GRID },
      pointLabels: { color: TICK, font: { size: 11 } },
      ticks: { color: TICK, backdropColor: 'transparent', stepSize: 25 },
    },
  },
}

const BAND_TONE = {
  High: 'bg-red-500/15 text-red-400 border-red-500/30',
  Elevated: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Normal: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Unrated: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

const fmtPct = (v, d = 0) => (v == null ? 'N/A' : `${Number(v).toFixed(d)}%`)

function SkeletonBar({ className = '' }) {
  return <div className={`animate-pulse bg-[var(--input-bg)] rounded ${className}`} />
}

function Kpi({ icon: Icon, label, value, sub }) {
  return (
    <div className="card !p-4 min-w-0">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <Icon size={13} aria-hidden="true" /> <span className="truncate">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums text-[var(--text-primary)] mt-2 truncate">{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-1 truncate" title={sub}>{sub}</p>}
    </div>
  )
}

function KpiRow({ label, value, highlight }) {
  return (
    <div className="flex justify-between text-xs gap-2">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className={highlight || 'text-[var(--text-secondary)]'}>{value}</span>
    </div>
  )
}

function BandBadge({ band }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${BAND_TONE[band] || BAND_TONE.Unrated}`}>
      {band}
    </span>
  )
}

export default function SiteComparison() {
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [selectedSites, setSelectedSites] = useState([])

  const [period, setPeriod]           = useState({ mode: 'all' })
  const [granularity, setGranularity] = useState('Monthly')
  const [search, setSearch] = useState('')
  const [band, setBand] = useState('all')
  const [scope, setScope] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const trendChartRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data, error: e, truncated: tr } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,issue_date,brand,site,category,risk_level,cost_per_tyre,qty')
          .order('issue_date')
          .order('id')
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      }, { max: ROW_CAP })
      if (e) throw e
      setTruncated(Boolean(tr))
      const recs = data || []
      setRecords(recs)
      const byCount = {}
      recs.forEach(r => { if (r.site) byCount[r.site] = (byCount[r.site] || 0) + 1 })
      const top4 = Object.entries(byCount).sort(([, a], [, b]) => b - a).slice(0, 4).map(([s]) => s)
      setSelectedSites(top4)
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load site data.'))
      setTruncated(false)
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const filteredRecords = useMemo(
    () => filterByPeriodValue(records, period, 'issue_date'),
    [records, period]
  )

  // Shared per-site maths (analyticsEngine) + the engine's coverage overlay.
  const allMetrics = useMemo(() => computeSiteMetrics(filteredRecords), [filteredRecords])
  const register = useMemo(() => siteRegister(filteredRecords, { selected: selectedSites }), [filteredRecords, selectedSites])
  const allSites = useMemo(() => register.map(s => s.site), [register])

  const compared = useMemo(
    () => selectedSites.map(s => register.find(r => r.site === s)).filter(Boolean),
    [register, selectedSites]
  )
  const radarMetrics = useMemo(
    () => selectedSites.map(s => allMetrics.find(m => m.site === s)).filter(Boolean),
    [allMetrics, selectedSites]
  )
  const radarData = useMemo(() => buildSiteRadar(radarMetrics), [radarMetrics])

  const summary = useMemo(() => summarizeSites(register), [register])
  const comparedSummary = useMemo(() => summarizeSites(compared), [compared])
  const tableRows = useMemo(() => filterSites(register, { search, band, scope }), [register, search, band, scope])

  // The page exists to compare a CHOSEN subset of sites; every chart reads the
  // compared set, so the exports do too and name that scope in the document.
  const filteredMetrics = useMemo(() => siteExportRows(compared), [compared])
  const SITE_COLS = SITE_EXPORT_COLUMNS
  const exportScopeNote = useMemo(() => {
    const parts = []
    if (compared.length < register.length) parts.push(`${compared.length} of ${register.length} sites compared`)
    if (period?.mode && period.mode !== 'all') parts.push(periodLabel(period))
    return parts.join(' | ')
  }, [compared.length, register.length, period])
  const fileBase = reportFileName('TyrePulse Site Comparison', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())

  function toggleSite(site) {
    setSelectedSites(prev =>
      prev.includes(site) ? prev.filter(s => s !== site) : (prev.length >= MAX_COMPARE ? prev : [...prev, site])
    )
  }

  const siteColor = useCallback((site) => colorAt(Math.max(0, selectedSites.indexOf(site))), [selectedSites])

  const costChart = compared.length > 0 ? {
    labels: compared.map(s => s.site),
    datasets: [{
      label: `Priced cost (${activeCurrency})`,
      data: compared.map(s => (s.totalCost == null ? null : Math.round(s.totalCost))),
      backgroundColor: compared.map(s => withAlpha(siteColor(s.site), 0.75)),
      borderColor: compared.map(s => siteColor(s.site)),
      borderWidth: 1, borderRadius: 4,
    }],
  } : null

  const riskChart = compared.length > 0 ? {
    labels: compared.map(s => s.site),
    datasets: [{
      label: t('sitecomparison.chart.highRiskPct'),
      data: compared.map(s => (s.highRiskPct == null ? null : Number(s.highRiskPct.toFixed(1)))),
      backgroundColor: compared.map(s => withAlpha(siteColor(s.site), 0.6)),
      borderRadius: 4,
    }],
  } : null

  const trend = useMemo(() => {
    const { periods, series } = trendSeries(filteredRecords, selectedSites, granularity)
    return {
      periods,
      chartData: {
        labels: periods,
        datasets: series.map(s => ({
          label: s.site,
          data: s.values,
          borderColor: siteColor(s.site),
          backgroundColor: withAlpha(siteColor(s.site), 0.15),
          fill: false, tension: 0.35, spanGaps: true, pointRadius: 3,
        })),
      },
    }
  }, [filteredRecords, selectedSites, granularity, siteColor])

  const filtersActive = Boolean(search) || band !== 'all' || scope !== 'all'

  const columns = useMemo(() => [
    {
      id: 'compare', header: 'Compare', accessorFn: (r) => (r.selected ? 1 : 0), size: 90, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const blocked = !r.selected && selectedSites.length >= MAX_COMPARE
        return (
          <label className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={r.selected}
              disabled={blocked}
              onChange={() => toggleSite(r.site)}
              aria-label={`${r.selected ? 'Remove' : 'Add'} ${r.site} ${r.selected ? 'from' : 'to'} the comparison`}
              className="w-4 h-4"
            />
            {r.selected ? 'On' : 'Off'}
          </label>
        )
      },
    },
    { id: 'rank', header: 'Rank', accessorFn: (r) => r.rank, size: 70, meta: { align: 'right' } },
    {
      id: 'site', header: 'Site', accessorFn: (r) => r.site, size: 180,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.site}</span>,
    },
    { id: 'count', header: 'Records', accessorFn: (r) => r.count, size: 90, meta: { align: 'right' } },
    {
      id: 'pricedPct', header: 'Priced', accessorFn: (r) => r.pricedPct ?? -1, size: 90, meta: { align: 'right' },
      cell: ({ row }) => fmtPct(row.original.pricedPct),
    },
    {
      id: 'totalCost', header: 'Priced cost', accessorFn: (r) => r.totalCost ?? -1, size: 120, meta: { align: 'right' },
      cell: ({ row }) => (row.original.totalCost == null ? 'N/A' : formatCurrencyCompact(row.original.totalCost, activeCurrency)),
    },
    {
      id: 'costShare', header: 'Cost share', accessorFn: (r) => r.costShare ?? -1, size: 100, meta: { align: 'right' },
      cell: ({ row }) => fmtPct(row.original.costShare, 1),
    },
    {
      id: 'costIndex', header: 'Cost index', accessorFn: (r) => r.costIndex ?? -1, size: 100, meta: { align: 'right' },
      cell: ({ row }) => (row.original.costIndex == null ? 'N/A' : row.original.costIndex),
    },
    {
      id: 'ratedPct', header: 'Risk rated', accessorFn: (r) => r.ratedPct ?? -1, size: 100, meta: { align: 'right' },
      cell: ({ row }) => fmtPct(row.original.ratedPct),
    },
    {
      id: 'highRiskPct', header: 'High risk', accessorFn: (r) => r.highRiskPct ?? -1, size: 100, meta: { align: 'right' },
      cell: ({ row }) => fmtPct(row.original.highRiskPct, 1),
    },
    {
      id: 'band', header: 'Risk band', accessorFn: (r) => r.riskBand, size: 110,
      cell: ({ row }) => <BandBadge band={row.original.riskBand} />,
    },
    { id: 'topBrand', header: 'Top brand', accessorFn: (r) => r.topBrand, size: 120 },
    { id: 'topCategory', header: 'Top category', accessorFn: (r) => r.topCategory, size: 120 },
  ], [selectedSites, activeCurrency])

  const hasData = !loading && !error && allSites.length > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('sitecomparison.title')}
        subtitle={t('sitecomparison.subtitle')}
        icon={GitMerge}
        actions={(
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-2 min-h-[44px] disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
            {hasData && compared.length > 0 && (
              <>
                <button
                  type="button"
                  title={exportScopeNote || undefined}
                  onClick={() => exportToExcel(filteredMetrics, SITE_COLS.map(c => c.key), SITE_COLS.map(c => c.header), fileBase)}
                  className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-2 min-h-[44px]"
                >
                  <Download size={14} aria-hidden="true" /> {t('sitecomparison.actions.excel')}
                </button>
                <button
                  type="button"
                  title={exportScopeNote || undefined}
                  onClick={() => exportToPdf(filteredMetrics, SITE_COLS, 'Site Comparison', fileBase, 'landscape', '', exportScopeNote ? { subtitleNote: exportScopeNote } : {})}
                  className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-2 min-h-[44px]"
                >
                  <FileText size={14} aria-hidden="true" /> {t('sitecomparison.actions.pdf')}
                </button>
                <EmailPdfButton
                  className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-2 min-h-[44px]"
                  getPdf={async () => ({
                    base64: await exportToPdf(filteredMetrics, SITE_COLS, 'Site Comparison', fileBase, 'landscape', '', { returnBase64: true, ...(exportScopeNote ? { subtitleNote: exportScopeNote } : {}) }),
                    filename: `${fileBase}.pdf`,
                    subject: 'Site Comparison',
                    bodyHtml: '<p>Attached is the Site Comparison report.</p>',
                  })}
                />
              </>
            )}
          </div>
        )}
      />

      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-live="polite">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonBar key={i} className="h-[92px] rounded-2xl" />)}
          </div>
          <SkeletonBar className="h-24 w-full rounded-2xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SkeletonBar className="h-72 rounded-2xl" />
            <SkeletonBar className="h-72 rounded-2xl" />
          </div>
        </div>
      ) : error ? (
        <Card role="alert" className="items-center justify-center text-center" style={{ paddingTop: 'var(--space-12)', paddingBottom: 'var(--space-12)' }}>
          <AlertTriangle size={40} className="text-red-400 mb-4" aria-hidden="true" />
          <p className="text-[var(--text-primary)] font-medium text-lg">{t('sitecomparison.states.loadError')}</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          <p className="text-[var(--text-muted)] text-xs mt-1">No comparison is shown until the tyre records can be read.</p>
          <button type="button" onClick={load} className="btn-secondary mt-4 inline-flex items-center gap-2 px-4 py-2 min-h-[44px] text-sm">
            <RefreshCw size={16} aria-hidden="true" /> {t('sitecomparison.states.retry')}
          </button>
        </Card>
      ) : allSites.length === 0 ? (
        <>
          <Card className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <span className="label text-xs">{t('sitecomparison.filters.period')}</span>
                <PeriodFilter records={records} value={period} onChange={setPeriod} />
              </div>
            </div>
          </Card>
          <Card className="items-center justify-center text-center" style={{ paddingTop: 'var(--space-12)', paddingBottom: 'var(--space-12)' }}>
            <GitMerge size={40} className="text-[var(--text-dim)] mb-4" aria-hidden="true" />
            <p className="text-[var(--text-secondary)] font-medium text-lg">{t('sitecomparison.states.noSiteData')}</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{t('sitecomparison.states.noSiteDataHint')}</p>
          </Card>
        </>
      ) : (
        <>
          {/* KPI strip over every site in scope. */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi icon={MapPin} label="Sites in scope" value={summary.sites} sub={`${summary.records.toLocaleString('en-US')} tyre records`} />
            <Kpi
              icon={Coins}
              label="Priced cost"
              value={summary.totalCost == null ? 'N/A' : formatCurrencyCompact(summary.totalCost, activeCurrency)}
              sub={summary.pricedPct == null ? 'No records' : `${summary.pricedPct}% of records priced`}
            />
            <Kpi
              icon={Scale}
              label="Avg cost per priced tyre"
              value={summary.avgCostPerPriced == null ? 'N/A' : formatCurrencyCompact(summary.avgCostPerPriced, activeCurrency)}
              sub={summary.topCostSite ? `Highest: ${summary.topCostSite}` : 'No priced sites'}
            />
            <Kpi
              icon={Layers}
              label="Cost spread"
              value={summary.costSpread == null ? 'N/A' : `${summary.costSpread.toFixed(1)}x`}
              sub="Highest vs lowest priced site"
            />
            <Kpi
              icon={ShieldAlert}
              label="High risk share"
              value={fmtPct(summary.highRiskPct, 1)}
              sub={summary.riskiestSite ? `Riskiest: ${summary.riskiestSite}` : 'No tyre carries a risk rating'}
            />
            <Kpi
              icon={Percent}
              label="Risk rated"
              value={fmtPct(summary.ratedPct)}
              sub="Records with a risk level"
            />
          </div>

          {/* Filter bar + compare selector. */}
          <Card className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <span className="label text-xs">{t('sitecomparison.filters.period')}</span>
                <PeriodFilter records={records} value={period} onChange={setPeriod} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="label text-xs">{t('sitecomparison.filters.granularity')}</span>
                <SegmentedControl
                  ariaLabel="Trend granularity"
                  size="sm"
                  value={granularity}
                  onChange={setGranularity}
                  options={GRANULARITIES.map(g => ({ value: g, label: t(`sitecomparison.granularity.${g}`) }))}
                />
              </div>
            </div>

            <div>
              <p className="text-sm text-[var(--text-secondary)] mb-3">
                {t('sitecomparison.filters.selectSites')} <span className="text-[var(--text-muted)]">({selectedSites.length} of {MAX_COMPARE} max)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {allSites.map((site) => {
                  const active = selectedSites.includes(site)
                  return (
                    <button
                      type="button"
                      key={site}
                      onClick={() => toggleSite(site)}
                      aria-pressed={active}
                      disabled={!active && selectedSites.length >= MAX_COMPARE}
                      className={`px-3 min-h-[44px] rounded-full text-xs font-medium transition-colors border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                        active
                          ? 'border-transparent text-white'
                          : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--text-dim)] disabled:opacity-40'
                      }`}
                      style={active ? { backgroundColor: siteColor(site) } : {}}
                    >
                      {active ? '✓ ' : ''}{site}
                    </button>
                  )
                })}
              </div>
            </div>
          </Card>

          {truncated && (
            <div role="status" className="flex items-center gap-2 text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-2.5">
              <AlertTriangle size={13} aria-hidden="true" />
              Showing a capped view of up to {ROW_CAP.toLocaleString('en-US')} records. Narrow the country scope for full detail.
            </div>
          )}
          <p className="text-[11px] text-[var(--text-muted)] flex items-start gap-1.5">
            <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Cost here is the per-tyre price recorded on each tyre record; unpriced tyres add no money and are shown as the Priced share.
              The authoritative tyre spend total comes from the expense grid on Expenses and CPK.
              {activeCountry === 'All' && ' Sites may span countries with different currencies (SAR / AED / EGP); pick a country for a like-for-like money comparison.'}
            </span>
          </p>

          {compared.length === 0 ? (
            <Card className="items-center justify-center text-center" style={{ paddingTop: 'var(--space-12)', paddingBottom: 'var(--space-12)' }}>
              <GitMerge size={40} className="text-[var(--text-dim)] mb-4" aria-hidden="true" />
              <p className="text-[var(--text-secondary)] font-medium">{t('sitecomparison.states.selectSite')}</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{t('sitecomparison.states.selectSiteHint')}</p>
            </Card>
          ) : (
            <>
              <p className="text-xs text-[var(--text-muted)]">
                Compared sites: {compared.length} | priced cost {comparedSummary.totalCost == null ? 'N/A' : formatCurrencyCompact(comparedSummary.totalCost, activeCurrency)} | high risk {fmtPct(comparedSummary.highRiskPct, 1)}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                {compared.map((s) => (
                  <Card key={s.site} style={{ borderColor: siteColor(s.site), borderTopWidth: '2px' }}>
                    <p className="text-[var(--text-primary)] font-semibold text-sm truncate" title={s.site}>{s.site}</p>
                    <div className="mt-3 space-y-2">
                      <KpiRow label={t('sitecomparison.kpi.records')} value={s.count} />
                      <KpiRow label={t('sitecomparison.kpi.totalCost')} value={s.totalCost == null ? 'N/A' : formatCurrencyCompact(s.totalCost, activeCurrency)} />
                      <KpiRow label="Cost share" value={fmtPct(s.costShare, 1)} />
                      <KpiRow
                        label={t('sitecomparison.kpi.highRisk')}
                        value={s.highRiskPct == null ? 'N/A (unrated)' : `${s.highRiskCount} (${s.highRiskPct.toFixed(0)}%)`}
                        highlight={s.riskBand === 'High' ? 'text-red-400' : s.riskBand === 'Elevated' ? 'text-amber-400' : undefined}
                      />
                      <KpiRow label={t('sitecomparison.kpi.topBrand')} value={s.topBrand} />
                      <KpiRow label={t('sitecomparison.kpi.topCategory')} value={s.topCategory} />
                    </div>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader title={t('sitecomparison.chart.totalCostComparison')} />
                  <div style={{ height: 260 }} role="img" aria-label={`Priced cost by compared site: ${compared.map(s => `${s.site} ${s.totalCost == null ? 'N/A' : Math.round(s.totalCost)}`).join(', ')}`}>
                    <Bar data={costChart} options={BAR_OPTS} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title={t('sitecomparison.chart.highRiskComparison')} />
                  {compared.every(s => s.highRiskPct == null) ? (
                    <p className="text-sm text-[var(--text-muted)] py-16 text-center">
                      None of the compared sites has a tyre with a risk rating, so a high risk share cannot be measured.
                    </p>
                  ) : (
                    <div style={{ height: 260 }} role="img" aria-label={`High risk share by compared site: ${compared.map(s => `${s.site} ${fmtPct(s.highRiskPct, 1)}`).join(', ')}`}>
                      <Bar data={riskChart} options={BAR_OPTS} />
                    </div>
                  )}
                </Card>
              </div>

              {radarMetrics.length >= 2 && (
                <Card>
                  <CardHeader title={t('sitecomparison.chart.radarTitle')} />
                  <div className="max-w-xl mx-auto w-full" style={{ height: 380 }}>
                    <Radar data={radarData} options={RADAR_OPTS} />
                  </div>
                  <p className="text-xs text-[var(--text-muted)] text-center mt-2">
                    {t('sitecomparison.chart.radarLegend')}
                    {compared.every(s => s.highRiskPct == null) && ' The safety and risk axes assume no rating was recorded for these sites.'}
                  </p>
                </Card>
              )}

              {trend.periods.length >= 2 && (
                <Card>
                  <CardHeader
                    title={t('sitecomparison.trend.title', { granularity: t(`sitecomparison.granularity.${granularity}`), period: t(`sitecomparison.periodLabel.${granularity}`) })}
                    actions={(
                      <button
                        type="button"
                        onClick={() => setModalOpen(true)}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded hover:bg-[var(--input-bg)]"
                        title={t('sitecomparison.trend.fullscreen')}
                        aria-label={t('sitecomparison.trend.fullscreen')}
                      >
                        <Maximize2 size={15} aria-hidden="true" />
                      </button>
                    )}
                  />
                  <div style={{ height: 300 }}>
                    <Line ref={trendChartRef} data={trend.chartData} options={LINE_OPTS} />
                  </div>
                </Card>
              )}
            </>
          )}

          {/* Full site register. */}
          <Card className="space-y-3">
            <CardHeader title="Site register" />
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                <input
                  className="input pl-8 text-sm min-h-[44px]"
                  placeholder="Search site, brand or category"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search sites"
                />
              </div>
              <select className="input text-sm w-auto min-h-[44px]" value={band} onChange={(e) => setBand(e.target.value)} aria-label="Filter by risk band">
                <option value="all">All risk bands</option>
                {RISK_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <select className="input text-sm w-auto min-h-[44px]" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Filter by comparison">
                <option value="all">All sites</option>
                <option value="selected">Compared only</option>
              </select>
              <span className="ml-auto text-xs text-[var(--text-muted)]">{tableRows.length} of {register.length} sites</span>
              {filtersActive && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setBand('all'); setScope('all') }}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 min-h-[44px] px-2"
                >
                  <X size={12} aria-hidden="true" /> Clear filters
                </button>
              )}
            </div>
            <EnterpriseTable
              columns={columns}
              data={tableRows}
              getRowId={(r) => r.site}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              initialPageSize={25}
              resetPageKey={`${search}|${band}|${scope}`}
              emptyMessage={filtersActive ? 'No site matches these filters.' : 'No sites in this period.'}
            />
            <p className="text-[11px] text-[var(--text-muted)]">
              Cost index compares a site&apos;s priced cost with the average priced site (100 = average). Cost share and index are N/A for a site with no priced tyre.
            </p>
          </Card>
        </>
      )}

      <ChartModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('sitecomparison.trend.modalTitle')}
        chartRef={trendChartRef}
        filters={{ granularity }}
        onFilterChange={(key, val) => { if (key === 'granularity') setGranularity(val) }}
        filterOptions={{}}
        showGranularity={false}
        showSite={false}
        showBrand={false}
      >
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-[var(--text-muted)]">{t('sitecomparison.trend.granularityLabel')}</span>
          <SegmentedControl
            ariaLabel="Trend granularity"
            size="sm"
            value={granularity}
            onChange={setGranularity}
            options={GRANULARITIES.map(g => ({ value: g, label: t(`sitecomparison.granularity.${g}`) }))}
          />
        </div>
        <div style={{ height: 420 }}>
          <Line ref={trendChartRef} data={trend.chartData} options={LINE_OPTS} />
        </div>
      </ChartModal>
    </div>
  )
}
