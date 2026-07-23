import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import * as analytics from '../lib/api/analyticsReads'
import { useSettings } from '../contexts/SettingsContext'
import { bucketByMonth, linearRegression, recordCost } from '../lib/analyticsEngine'
import { loadGridTyreByAsset } from '../lib/api/costSummary'
import { BarChart2, Download, FileText, AlertTriangle, RefreshCw } from 'lucide-react'
import { SkeletonCards, SkeletonChart } from '../components/ui/Skeleton'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import EmailPdfButton from '../components/EmailPdfButton'
import SectionTabs, { FLEET_TABS } from '../components/ui/SectionTabs'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler)

const RISK_BADGE = {
  High:    'bg-red-900/40 text-red-400 border-red-700/50',
  Medium:  'bg-yellow-900/40 text-yellow-400 border-yellow-700/50',
  Low:     'bg-green-900/40 text-green-400 border-green-700/50',
  Unknown: 'bg-gray-800 text-gray-400 border-gray-700',
}

export default function FleetAnalytics() {
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  const [assetMetrics, setAssetMetrics] = useState([])
  // Authoritative per-asset tyre cost from the expense grid (V347). null when the
  // grid is unavailable for this scope -> per-asset totals fall back to tyre_records.
  const [gridCost, setGridCost] = useState(null)
  const [totalRecords, setTotalRecords] = useState(0)
  const [selectedRecords, setSelectedRecords] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [search, setSearch]     = useState('')
  const [selected, setSelected] = useState(null)
  const [sortBy, setSortBy]     = useState('count')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [siteFilter, setSiteFilter] = useState('')

  // Guards against a slow earlier response overwriting a newer one after the
  // active country changes (fetch-race cancellation).
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true); setError(null)
    try {
      const [{ data, error: e }, grid] = await Promise.all([
        analytics.reportAssetMetrics({ country: activeCountry }),
        loadGridTyreByAsset({ country: activeCountry }),
      ])
      if (myReq !== reqIdRef.current) return
      if (e) throw new Error(e.message || e)
      const m = data || []
      setAssetMetrics(m)
      setGridCost(grid && grid.map ? grid.map : null)
      setTotalRecords(m.reduce((s, a) => s + (a.count || 0), 0))
    } catch (e) {
      if (myReq === reqIdRef.current) setError(toUserMessage(e, t('fleetanalytics.loadErrorFallback')))
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [activeCountry, t])

  useEffect(() => { load() }, [load])

  // Lazy-load the selected asset's raw rows for the detail view.
  useEffect(() => {
    if (!selected) { setSelectedRecords([]); return }
    let cancelled = false
    analytics.listAssetTyreRecords({ assetNo: selected, country: activeCountry })
      .then(({ data }) => { if (!cancelled) setSelectedRecords(data || []) })
      .catch(() => { if (!cancelled) setSelectedRecords([]) })
    return () => { cancelled = true }
  }, [selected, activeCountry])

  // Overlay the authoritative expense-grid tyre cost onto each asset's totalCost
  // (key = asset_no UPPER/trim). Absent grid, or an asset the grid does not carry,
  // keeps the tyre_records total (honest fallback). Every downstream per-asset and
  // fleet total (summary, table, sort, export, drill header) then reconciles to
  // the Expense module.
  const assetMetricsView = useMemo(() => {
    if (!gridCost) return assetMetrics
    return assetMetrics.map(a => {
      const key = String(a.assetNo ?? '').trim().toUpperCase()
      return gridCost.has(key) ? { ...a, totalCost: gridCost.get(key) } : a
    })
  }, [assetMetrics, gridCost])

  const sorted = useMemo(() => {
    const arr = [...assetMetricsView]
    if (sortBy === 'count')    return arr.sort((a, b) => b.count - a.count)
    if (sortBy === 'cost')     return arr.sort((a, b) => b.totalCost - a.totalCost)
    if (sortBy === 'risk')     return arr.sort((a, b) => b.highRiskCount - a.highRiskCount)
    if (sortBy === 'freq')     return arr.sort((a, b) => b.failureFreqPerMonth - a.failureFreqPerMonth)
    return arr
  }, [assetMetricsView, sortBy])

  // Unique sites derived from per-asset metrics
  const allSites = useMemo(() =>
    [...new Set(assetMetricsView.flatMap(a => a.sites || []))].sort(),
    [assetMetricsView]
  )

  const filtered = useMemo(() => {
    return sorted.filter(a => {
      if (search && !a.assetNo.toLowerCase().includes(search.toLowerCase())) return false
      if (dateFrom && a.lastSeen && a.lastSeen < dateFrom) return false
      if (dateTo && a.lastSeen && a.lastSeen > dateTo) return false
      if (siteFilter && !a.sites.includes(siteFilter)) return false
      return true
    })
  }, [sorted, search, dateFrom, dateTo, siteFilter])

  if (loading) return (
    <div className="space-y-5">
      <PageHeader title={t('fleetanalytics.title')} subtitle={t('fleetanalytics.loading')} icon={BarChart2} />
      <SkeletonCards count={4} />
      <SkeletonChart />
    </div>
  )

  if (error && !assetMetrics.length) return (
    <div className="space-y-5">
      <PageHeader title={t('fleetanalytics.title')} subtitle={t('fleetanalytics.subtitleError')} icon={BarChart2} />
      <div className="card p-8 text-center">
        <AlertTriangle size={40} className="mx-auto text-red-400 mb-3" />
        <p className="text-red-300 font-medium mb-1">{t('fleetanalytics.loadErrorTitle')}</p>
        <p className="text-gray-400 text-sm mb-4">{error}</p>
        <button onClick={load} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
          <RefreshCw size={16} /> {t('fleetanalytics.retry')}
        </button>
      </div>
    </div>
  )

  const selectedAsset = selected
    ? { ...assetMetricsView.find(a => a.assetNo === selected), records: selectedRecords }
    : null

  return (
    <div className="space-y-6">
      <SectionTabs tabs={FLEET_TABS} />
      {/* Header */}
      <PageHeader
        title={t('fleetanalytics.title')}
        subtitle={t('fleetanalytics.subtitleFull')}
        icon={BarChart2}
      />

      {error && (
        <div className="flex items-center justify-between gap-3 bg-red-900/30 border border-red-700 rounded-xl p-3 text-red-300 text-sm">
          <span className="flex items-center gap-2"><AlertTriangle size={16} /> {error}</span>
          <button onClick={load} className="flex items-center gap-1 text-red-200 hover:text-white"><RefreshCw size={14} /> {t('fleetanalytics.retry')}</button>
        </div>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('fleetanalytics.summary.totalAssets'),    value: assetMetrics.length,       color: 'text-blue-400' },
          { label: t('fleetanalytics.summary.totalRecords'),   value: totalRecords.toLocaleString(), color: 'text-white' },
          { label: t('fleetanalytics.summary.highFreqAssets'),
            value: assetMetrics.filter(a => a.failureFreqPerMonth > 2).length,
            color: 'text-red-400' },
          { label: t('fleetanalytics.summary.avgCostPerAsset'),
            value: assetMetricsView.length
              ? formatCurrencyCompact(assetMetricsView.reduce((s, a) => s + a.totalCost, 0) / assetMetricsView.length, activeCurrency)
              : '-',
            color: 'text-green-400' },
        ].map(({ label, value, color }, i) => (
          <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <div className="card text-center">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-gray-400 text-sm mt-1">{label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Asset list */}
      <div className="card">
        <div className="flex flex-wrap gap-3 mb-3">
          <input
            className="input flex-1 min-w-48"
            placeholder={t('fleetanalytics.filters.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="input w-44" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="count">{t('fleetanalytics.filters.sortCount')}</option>
            <option value="cost">{t('fleetanalytics.filters.sortCost')}</option>
            <option value="risk">{t('fleetanalytics.filters.sortRisk')}</option>
            <option value="freq">{t('fleetanalytics.filters.sortFreq')}</option>
          </select>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={async () => { try { await exportToExcel(
                filtered.slice(0, 1000).map(a => ({
                  asset_no: a.assetNo, records: a.count,
                  total_cost: a.totalCost, high_risk: a.highRiskCount,
                  fail_per_month: a.failureFreqPerMonth.toFixed(1),
                  sites: a.sites.join(', '), brands: a.brands.join(', '),
                  last_seen: a.lastSeen ?? '',
                })),
                ['asset_no','records','total_cost','high_risk','fail_per_month','sites','brands','last_seen'],
                ['Asset No','Records','Total Cost','High Risk','Fail/Mo','Sites','Brands','Last Seen'],
                'TyrePulse_FleetAnalytics'
              ) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <Download size={14} /> {t('fleetanalytics.actions.excel')}
            </button>
            <button
              onClick={async () => { try { await exportToPdf(
                filtered.slice(0, 200).map(a => ({
                  asset_no: a.assetNo, records: a.count,
                  total_cost: formatCurrencyCompact(a.totalCost, activeCurrency),
                  high_risk: a.highRiskCount,
                  fail_per_month: a.failureFreqPerMonth.toFixed(1),
                })),
                [
                  { key: 'asset_no',       header: 'Asset No' },
                  { key: 'records',        header: 'Records' },
                  { key: 'total_cost',     header: 'Total Cost' },
                  { key: 'high_risk',      header: 'High Risk' },
                  { key: 'fail_per_month', header: 'Fail/Mo' },
                ],
                'Fleet Analytics Report',
                'TyrePulse_FleetAnalytics',
                'landscape'
              ) } catch (e) { setError(toUserMessage(e, 'Could not export. Try again.')) } }}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <FileText size={14} /> {t('fleetanalytics.actions.pdf')}
            </button>
            <EmailPdfButton
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
              getPdf={async () => ({
                base64: await exportToPdf(
                  filtered.slice(0, 200).map(a => ({
                    asset_no: a.assetNo, records: a.count,
                    total_cost: formatCurrencyCompact(a.totalCost, activeCurrency),
                    high_risk: a.highRiskCount,
                    fail_per_month: a.failureFreqPerMonth.toFixed(1),
                  })),
                  [
                    { key: 'asset_no',       header: 'Asset No' },
                    { key: 'records',        header: 'Records' },
                    { key: 'total_cost',     header: 'Total Cost' },
                    { key: 'high_risk',      header: 'High Risk' },
                    { key: 'fail_per_month', header: 'Fail/Mo' },
                  ],
                  'Fleet Analytics Report',
                  'TyrePulse_FleetAnalytics',
                  'landscape',
                  '',
                  { returnBase64: true }
                ),
                filename: 'TyrePulse_FleetAnalytics.pdf',
                subject: 'Fleet Analytics',
                bodyHtml: '<p>Attached is the Fleet Analytics report.</p>',
              })}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <span className="text-xs text-gray-400">{t('fleetanalytics.filters.dateRange')}</span>
          <input
            type="date"
            className="input w-40"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            placeholder={t('fleetanalytics.filters.fromPlaceholder')}
          />
          <span className="text-gray-500 text-xs">{t('fleetanalytics.filters.to')}</span>
          <input
            type="date"
            className="input w-40"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            placeholder={t('fleetanalytics.filters.toPlaceholder')}
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo('') }}
              className="text-xs text-gray-400 hover:text-white"
            >
              {t('fleetanalytics.filters.clearDates')}
            </button>
          )}
          <select
            className="input w-44"
            value={siteFilter}
            onChange={e => setSiteFilter(e.target.value)}
          >
            <option value="">{t('fleetanalytics.filters.allSites')}</option>
            {allSites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {siteFilter && (
            <button
              onClick={() => setSiteFilter('')}
              className="text-xs text-gray-400 hover:text-white"
            >
              {t('fleetanalytics.filters.clearSite')}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800">
                <th className="pb-2 pr-4">{t('fleetanalytics.table.assetNo')}</th>
                <th className="pb-2 pr-4 text-right">{t('fleetanalytics.table.records')}</th>
                <th className="pb-2 pr-4 text-right">{t('fleetanalytics.table.totalCost')}</th>
                <th className="pb-2 pr-4 text-right">{t('fleetanalytics.table.highRisk')}</th>
                <th className="pb-2 pr-4 text-right">{t('fleetanalytics.table.failPerMonth')}</th>
                <th className="pb-2 pr-4">{t('fleetanalytics.table.sites')}</th>
                <th className="pb-2 pr-4">{t('fleetanalytics.table.brands')}</th>
                <th className="pb-2">{t('fleetanalytics.table.lastSeen')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map(a => (
                <tr
                  key={a.assetNo}
                  onClick={() => setSelected(selected === a.assetNo ? null : a.assetNo)}
                  className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                    selected === a.assetNo ? 'bg-blue-900/20' : 'hover:bg-gray-800/20'
                  }`}
                >
                  <td className="py-2 pr-4 font-mono text-xs text-blue-400 font-medium">{a.assetNo}</td>
                  <td className="py-2 pr-4 text-gray-300 text-right">{a.count}</td>
                  <td className="py-2 pr-4 text-gray-300 text-right">
                    {formatCurrencyCompact(a.totalCost, activeCurrency)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {a.highRiskCount > 0
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400">{a.highRiskCount}</span>
                      : <span className="text-gray-600">0</span>
                    }
                  </td>
                  <td className="py-2 pr-4 text-right text-xs text-gray-400">{a.failureFreqPerMonth.toFixed(1)}</td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">{a.sites.slice(0, 2).join(', ')}</td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">{a.brands.slice(0, 2).join(', ')}</td>
                  <td className="py-2 text-gray-500 text-xs">{a.lastSeen || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-10">
              <BarChart2 size={32} className="text-gray-700 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">{t('fleetanalytics.empty.noMatch')}</p>
            </div>
          )}
          {filtered.length > 100 && (
            <p className="text-xs text-gray-500 text-center pt-3">
              {t('fleetanalytics.empty.showing', { count: filtered.length })}
            </p>
          )}
        </div>
      </div>

      {/* Drill-down */}
      {selectedAsset && <AssetDrillDown asset={selectedAsset} currency={activeCurrency} />}
    </div>
  )
}

function AssetDrillDown({ asset, currency }) {
  const { t } = useLanguage()
  const monthly = useMemo(() =>
    bucketByMonth(asset.records, r => r.issue_date, r => recordCost(r)),
    [asset]
  )

  const points    = monthly.map((d, i) => [i, d.count])
  const reg       = points.length >= 2 ? linearRegression(points) : null

  const costData = {
    labels: monthly.map(d => d.month),
    datasets: [{
      label: t('fleetanalytics.drill.costDataset', { currency }),
      data: monthly.map(d => Math.round(d.total)),
      backgroundColor: 'rgba(59,130,246,0.5)',
      borderColor: 'rgba(59,130,246,1)',
      borderRadius: 4,
    }],
  }

  const countData = {
    labels: monthly.map(d => d.month),
    datasets: [
      {
        label: t('fleetanalytics.drill.recordsDataset'),
        data: monthly.map(d => d.count),
        borderColor: 'rgba(16,185,129,1)',
        backgroundColor: 'rgba(16,185,129,0.1)',
        fill: true, tension: 0.4,
      },
      reg && {
        label: t('fleetanalytics.drill.trendDataset'),
        data: monthly.map((_, i) => Math.max(0, parseFloat(reg.predict(i).toFixed(1)))),
        borderColor: 'rgba(107,114,128,0.6)',
        borderDash: [4, 4], fill: false, pointRadius: 0,
      },
    ].filter(Boolean),
  }

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af', font: { size: 11 } } } },
    scales: {
      x: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
      y: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
    },
  }

  const barOpts = {
    ...chartOpts,
    plugins: { ...chartOpts.plugins, legend: { display: false } },
  }

  // Tyre lifecycle: group by serial_no
  const bySerial = {}
  asset.records.forEach(r => {
    if (!r.serial_no) return
    if (!bySerial[r.serial_no]) bySerial[r.serial_no] = []
    bySerial[r.serial_no].push(r)
  })
  const serials = Object.entries(bySerial)
    .sort(([, a], [, b]) => new Date(b[0].issue_date) - new Date(a[0].issue_date))
    .slice(0, 10)

  return (
    <div className="card border border-blue-500/30 space-y-6">
      {/* Asset header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-white font-bold text-lg font-mono">{asset.assetNo}</h3>
          <p className="text-gray-400 text-sm mt-1">
            {t('fleetanalytics.drill.recordsSummary', {
              count: asset.count,
              cost: formatCurrencyCompact(asset.totalCost, currency),
              date: asset.firstSeen || '?',
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {asset.sites.map(s => (
            <span key={s} className="text-xs bg-blue-900/30 text-blue-400 border border-blue-700/50 px-2 py-0.5 rounded-full">{s}</span>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-gray-400 mb-2">{t('fleetanalytics.drill.monthlyCost', { currency })}</p>
          <div style={{ height: 200 }}>
            <Bar data={costData} options={barOpts} />
          </div>
          <p className="text-xs text-gray-500 mt-1">Breakdown from tyre records; authoritative total from the expense grid.</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-2">{t('fleetanalytics.drill.failureFrequency')}</p>
          <div style={{ height: 200 }}>
            <Line data={countData} options={chartOpts} />
          </div>
          {reg && (
            <p className="text-xs text-gray-500 mt-1">
              R² = {reg.r2.toFixed(2)} · {t('fleetanalytics.drill.slope')} {reg.slope > 0 ? '↑' : '↓'}{Math.abs(reg.slope).toFixed(2)}{t('fleetanalytics.drill.perMonth')}
            </p>
          )}
        </div>
      </div>

      {/* Tyre Lifecycle / Serial number history */}
      <div>
        <p className="text-sm font-medium text-gray-300 mb-3">{t('fleetanalytics.drill.lifecycleTitle')}</p>
        {serials.length > 0 ? (
          <div className="space-y-2">
            {serials.map(([serial, recs]) => {
              const latest = recs[0]
              return (
                <div key={serial} className="bg-gray-800/40 rounded-lg p-3 flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xs text-blue-300">{serial}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${RISK_BADGE[latest.risk_level] || RISK_BADGE.Unknown}`}>
                    {latest.risk_level || t('fleetanalytics.drill.unknownRisk')}
                  </span>
                  <span className="text-xs text-gray-400">{latest.brand || t('fleetanalytics.drill.unknownBrand')}</span>
                  <span className="text-xs text-gray-400">{latest.category || t('fleetanalytics.drill.uncategorised')}</span>
                  <span className="text-xs text-gray-500 ml-auto">{t('fleetanalytics.drill.events', { count: recs.length })}</span>
                  <span className="text-xs text-gray-600">{latest.issue_date || '-'}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">{t('fleetanalytics.drill.noSerialData')}</p>
        )}
      </div>

      {/* Full record history table */}
      <div>
        <p className="text-sm font-medium text-gray-300 mb-3">{t('fleetanalytics.drill.fullHistory')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-800 text-left">
                <th className="pb-1.5 pr-3">{t('fleetanalytics.drill.columns.date')}</th>
                <th className="pb-1.5 pr-3">{t('fleetanalytics.drill.columns.serial')}</th>
                <th className="pb-1.5 pr-3">{t('fleetanalytics.drill.columns.brand')}</th>
                <th className="pb-1.5 pr-3">{t('fleetanalytics.drill.columns.category')}</th>
                <th className="pb-1.5 pr-3">{t('fleetanalytics.drill.columns.risk')}</th>
                <th className="pb-1.5 pr-3 text-right">{t('fleetanalytics.drill.columns.cost')}</th>
                <th className="pb-1.5">{t('fleetanalytics.drill.columns.remarks')}</th>
              </tr>
            </thead>
            <tbody>
              {asset.records.slice(0, 30).map(r => (
                <tr key={r.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                  <td className="py-1.5 pr-3 text-gray-400">{r.issue_date || '-'}</td>
                  <td className="py-1.5 pr-3 font-mono text-gray-400">{r.serial_no || '-'}</td>
                  <td className="py-1.5 pr-3 text-gray-300">{r.brand || '-'}</td>
                  <td className="py-1.5 pr-3 text-gray-400">{r.category || '-'}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs border ${RISK_BADGE[r.risk_level] || RISK_BADGE.Unknown}`}>
                      {r.risk_level || '?'}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-right text-gray-400">
                    {formatCurrencyCompact(recordCost(r), currency)}
                  </td>
                  <td className="py-1.5 text-gray-500 max-w-xs truncate">{r.remarks_cleaned || r.remarks || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
