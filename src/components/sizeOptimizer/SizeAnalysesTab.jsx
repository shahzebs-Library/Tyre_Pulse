/**
 * Size Optimizer, History tab: the analyses the page always had (size mix,
 * CPK by size, size distribution with brand breakdown, size x brand matrix,
 * position-size compliance, 12-month size-brand CPK trend, consolidation
 * opportunities). Moved here unchanged in behaviour when the page was rebuilt
 * on the Command Center kit. All maths is in src/lib/tyreSizeAnalytics.js.
 */
import { useState, useEffect, useMemo } from 'react'
import { normalizePosition } from '../../lib/tyrePositions'
import { useLanguage } from '../../contexts/LanguageContext'
import { reportFileName } from '../../lib/exportUtils'
import {
  Layers, CheckCircle, TrendingUp, BarChart3, ShieldAlert, Lightbulb, DollarSign, X,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import EnterpriseTable from '../ui/EnterpriseTable'
import { Card } from '../commandCenter/kit'
import { colorAt, withAlpha } from '../../lib/reportColors'
import {
  BENCHMARK_GOOD, BENCHMARK_AVG, MIN_RECORDS_CPK, UNKNOWN_SIZE,
  cpkBand, sizeMetrics as buildSizeMetrics, bySizeCount, sizeKpis, sizeBrandMatrix,
  brandBreakdown, positionCompliance, comboTrend, consolidationOps as buildConsolidationOps,
} from '../../lib/tyreSizeAnalytics'
import { fmtKm, fmtPct, fmtMoney, opTitle, opDesc } from './sizeFormat'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// Theme tokens resolved on the canvas by chartVarPlugin (light and dark mode).
const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--surface-raised)',
      titleColor: 'var(--text-primary)',
      bodyColor: 'var(--text-secondary)',
      borderColor: 'var(--border-bright)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}

// Semantic CPK bands (meaning, not decoration) keep fixed colours + a text label.
const BAND_META = {
  good: { text: 'text-green-400', cell: 'bg-green-900/30', label: 'Good', fill: 'rgba(16,185,129,0.8)' },
  avg: { text: 'text-yellow-400', cell: 'bg-yellow-900/30', label: 'Average', fill: 'rgba(245,158,11,0.8)' },
  poor: { text: 'text-red-400', cell: 'bg-red-900/30', label: 'Poor', fill: 'rgba(239,68,68,0.8)' },
}


function stdFlagColor(flag) {
  if (flag === 'Standard') return 'text-green-400 bg-green-900/20 border border-green-800/60'
  if (flag === 'Low Volume') return 'text-yellow-400 bg-yellow-900/20 border border-yellow-800/60'
  return 'text-red-400 bg-red-900/20 border border-red-800/60'
}

function CpkCell({ value, currency, digits = 4 }) {
  const band = cpkBand(value)
  if (!band) return <span className="text-[var(--text-muted)]">N/A</span>
  const meta = BAND_META[band]
  return (
    <span className={`font-mono tabular-nums ${meta.text}`} title={`${meta.label} CPK`}>
      {currency ? `${currency} ` : ''}{value.toFixed(digits)}
    </span>
  )
}
function Panel({ icon: Icon, title, hint, children, right }) {
  return (
    <Card
      title={<span className="tsz-panel-title"><Icon size={15} aria-hidden="true" /> {title}</span>}
      sub={right ? undefined : hint}
      action={right}
    >
      {children}
    </Card>
  )
}

export default function SizeAnalysesTab({ filtered, label, currency: activeCurrency, recordsCount, hasActiveFilter, onClearFilters }) {
  const { t } = useLanguage()
  const [selectedSize, setSelectedSize] = useState(null)
  const sizeMetrics = useMemo(() => buildSizeMetrics(filtered, label), [filtered, label])
  const sortedSizeMetrics = useMemo(() => bySizeCount(sizeMetrics), [sizeMetrics])
  const kpis = useMemo(() => sizeKpis(filtered, sizeMetrics), [filtered, sizeMetrics])
  const matrixData = useMemo(() => sizeBrandMatrix(filtered, sizeMetrics, label), [filtered, sizeMetrics, label])
  const posCompliance = useMemo(() => positionCompliance(filtered, label, normalizePosition), [filtered, label])
  const trend = useMemo(() => comboTrend(filtered, label, new Date()), [filtered, label])
  const consolidationOps = useMemo(
    () => buildConsolidationOps(filtered, sizeMetrics, label, kpis.fleetAvgCpk),
    [filtered, sizeMetrics, label, kpis.fleetAvgCpk],
  )
  const breakdown = useMemo(
    () => (selectedSize ? brandBreakdown(filtered, selectedSize, label) : []),
    [filtered, selectedSize, label],
  )

  // Drop a selection the current filters no longer contain.
  useEffect(() => {
    if (selectedSize && !sizeMetrics.some((m) => m.size === selectedSize)) setSelectedSize(null)
  }, [selectedSize, sizeMetrics])
  // ── Charts ───────────────────────────────────────────────────────────────────
  const doughnutData = useMemo(() => {
    const top8 = sortedSizeMetrics.slice(0, 8)
    const restCount = sortedSizeMetrics.slice(8).reduce((s, m) => s + m.count, 0)
    const labels = [...top8.map((m) => m.size), ...(restCount > 0 ? ['Other'] : [])]
    const data = [...top8.map((m) => m.count), ...(restCount > 0 ? [restCount] : [])]
    return {
      labels,
      datasets: [{
        data,
        backgroundColor: [...top8.map((_, i) => colorAt(i)), ...(restCount > 0 ? ['var(--text-muted)'] : [])],
        borderColor: 'var(--surface-1)',
        borderWidth: 2,
      }],
    }
  }, [sortedSizeMetrics])

  const doughnutOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: 'var(--text-muted)', font: { size: 11 }, padding: 10, boxWidth: 12 } },
      tooltip: {
        ...CHART_BASE.plugins.tooltip,
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed
            const total = ctx.dataset.data.reduce((s, v) => s + v, 0)
            const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0
            return ` ${t('tyresize.charts.doughnutTooltip', { count: val, pct })}`
          },
        },
      },
    },
  }), [t])

  const cpkBarData = useMemo(() => {
    const withCpk = sizeMetrics.filter((m) => m.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk).slice(0, 15)
    return {
      labels: withCpk.map((m) => m.size),
      datasets: [{
        label: t('tyresize.charts.avgCpkSeries'),
        data: withCpk.map((m) => m.avgCpk),
        backgroundColor: withCpk.map((m) => BAND_META[cpkBand(m.avgCpk)].fill),
        borderRadius: 3,
      }],
    }
  }, [sizeMetrics, t])

  const cpkBarOpts = useMemo(() => ({
    ...CHART_BASE,
    indexAxis: 'y',
    plugins: {
      ...CHART_BASE.plugins,
      legend: { display: false },
      tooltip: {
        ...CHART_BASE.plugins.tooltip,
        callbacks: { label: (ctx) => ` ${activeCurrency} ${ctx.parsed.x.toFixed(4)}/km` },
      },
    },
    scales: {
      x: { ...CHART_BASE.scales.x, title: { display: true, text: `CPK (${activeCurrency}/km)`, color: 'var(--text-muted)' } },
      y: { ...CHART_BASE.scales.y },
    },
  }), [activeCurrency])

  const trendData = useMemo(() => ({
    labels: trend.labels,
    datasets: trend.series.map((s, i) => ({
      label: s.label,
      data: s.data,
      borderColor: colorAt(i),
      backgroundColor: withAlpha(colorAt(i), 0.13),
      tension: 0.3,
      fill: false,
      spanGaps: true,
      pointRadius: 3,
      borderDash: i === 1 ? [6, 4] : i === 2 ? [2, 3] : undefined,
    })),
  }), [trend])

  const trendOpts = useMemo(() => ({
    ...CHART_BASE,
    plugins: {
      ...CHART_BASE.plugins,
      tooltip: {
        ...CHART_BASE.plugins.tooltip,
        callbacks: { label: (ctx) => (ctx.parsed.y == null ? ' No measured CPK' : ` ${activeCurrency} ${ctx.parsed.y.toFixed(4)}/km`) },
      },
    },
    scales: {
      x: { ...CHART_BASE.scales.x, ticks: { ...CHART_BASE.scales.x.ticks, autoSkip: true, maxRotation: 0 } },
      y: { ...CHART_BASE.scales.y, title: { display: true, text: `CPK (${activeCurrency}/km)`, color: 'var(--text-muted)' } },
    },
  }), [activeCurrency])

  // ── Table columns ────────────────────────────────────────────────────────────
  const sizeColumns = useMemo(() => [
    { id: 'size', header: 'Size', accessorFn: (m) => m.size,
      cell: ({ row }) => <span className="font-mono text-[var(--text-primary)] font-medium whitespace-nowrap">{row.original.size}</span> },
    { id: 'count', header: 'Count', accessorFn: (m) => m.count, meta: { align: 'right' },
      cell: ({ row }) => row.original.count.toLocaleString() },
    { id: 'pct', header: '% Fleet', accessorFn: (m) => m.pct, meta: { align: 'right', exportValue: (m) => fmtPct(m.pct) },
      cell: ({ row }) => fmtPct(row.original.pct) },
    { id: 'avgCpk', header: `Avg CPK (${activeCurrency}/km)`, accessorFn: (m) => m.avgCpk ?? -1, meta: { align: 'right', exportValue: (m) => (m.avgCpk != null ? m.avgCpk.toFixed(4) : '') },
      cell: ({ row }) => <CpkCell value={row.original.avgCpk} /> },
    { id: 'avgLife', header: 'Avg Life', accessorFn: (m) => m.avgLife ?? -1, meta: { align: 'right', exportValue: (m) => (m.avgLife != null ? Math.round(m.avgLife) : '') },
      cell: ({ row }) => fmtKm(row.original.avgLife) },
    { id: 'failRate', header: 'Fail Rate', accessorFn: (m) => m.failRate ?? -1, meta: { align: 'right', exportValue: (m) => fmtPct(m.failRate) },
      cell: ({ row }) => {
        const m = row.original
        if (m.failRate == null) return <span className="text-[var(--text-muted)]" title="No tyre of this size carries a risk rating">N/A</span>
        return <span className={m.failRate > 20 ? 'text-red-400' : m.failRate > 10 ? 'text-yellow-400' : 'text-[var(--text-secondary)]'} title={`Over ${m.ratedCount} rated tyres`}>{fmtPct(m.failRate)}</span>
      } },
    { id: 'brands', header: 'Brands', accessorFn: (m) => m.brands.join(', '), enableSorting: false,
      cell: ({ row }) => {
        const b = row.original.brands
        return <span className="text-[var(--text-muted)]" title={b.join(', ')}>{b.slice(0, 3).join(', ')}{b.length > 3 ? ` +${b.length - 3}` : ''}{b.length === 0 ? 'N/A' : ''}</span>
      } },
    { id: 'sites', header: 'Sites', accessorFn: (m) => m.sites.join(', '), enableSorting: false,
      cell: ({ row }) => {
        const s = row.original.sites
        return <span className="text-[var(--text-muted)]" title={s.join(', ')}>{s.slice(0, 2).join(', ')}{s.length > 2 ? ` +${s.length - 2}` : ''}{s.length === 0 ? 'N/A' : ''}</span>
      } },
    { id: 'flag', header: 'Flag', accessorFn: (m) => m.flag,
      cell: ({ row }) => <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${stdFlagColor(row.original.flag)}`}>{row.original.flag}</span> },
  ], [activeCurrency])

  const breakdownColumns = useMemo(() => [
    { id: 'brand', header: 'Brand', accessorFn: (b) => b.brand, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.brand}</span> },
    { id: 'count', header: 'Count', accessorFn: (b) => b.count, meta: { align: 'right' } },
    { id: 'avgCpk', header: `Avg CPK (${activeCurrency}/km)`, accessorFn: (b) => b.avgCpk ?? -1, meta: { align: 'right' }, cell: ({ row }) => <CpkCell value={row.original.avgCpk} /> },
    { id: 'avgLife', header: 'Avg Life', accessorFn: (b) => b.avgLife ?? -1, meta: { align: 'right' }, cell: ({ row }) => fmtKm(row.original.avgLife) },
  ], [activeCurrency])

  const matrixRows = useMemo(
    () => matrixData.sizes.map((sz) => ({ size: sz, ...Object.fromEntries(matrixData.brands.map((br) => [`b:${br}`, matrixData.matrix[sz]?.[br] ?? null])) })),
    [matrixData],
  )
  const matrixColumns = useMemo(() => [
    { id: 'size', header: 'Size / Brand', accessorFn: (r) => r.size, cell: ({ row }) => <span className="font-mono text-[var(--text-primary)] whitespace-nowrap">{row.original.size}</span> },
    ...matrixData.brands.map((br) => ({
      id: `b:${br}`,
      header: br,
      accessorFn: (r) => r[`b:${br}`] ?? -1,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const v = row.original[`b:${br}`]
        const band = cpkBand(v)
        if (!band) return <span className="text-[var(--text-muted)]">N/A</span>
        return (
          <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono ${BAND_META[band].cell} ${BAND_META[band].text}`}>
            {v.toFixed(3)} <span className="sr-only">{BAND_META[band].label}</span>
          </span>
        )
      },
    })),
  ], [matrixData])

  const posColumns = useMemo(() => [
    { id: 'pos', header: 'Position', accessorFn: (p) => p.pos, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.pos}</span> },
    { id: 'required', header: 'Required sizes', accessorFn: (p) => p.required.join(', '), enableSorting: false,
      cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-muted)]">{row.original.required.join(', ') || 'N/A'}</span> },
    { id: 'nonStd', header: 'Non-std', accessorFn: (p) => p.nonStd, meta: { align: 'right' },
      cell: ({ row }) => <span className={row.original.nonStd > 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}>{row.original.nonStd}</span> },
    { id: 'compliance', header: 'Compliance', accessorFn: (p) => p.compliance ?? -1, meta: { align: 'right' },
      cell: ({ row }) => {
        const c = row.original.compliance
        if (c == null) return 'N/A'
        const tone = c >= 90 ? 'text-green-400' : c >= 70 ? 'text-yellow-400' : 'text-red-400'
        const bar = c >= 90 ? 'bg-green-500' : c >= 70 ? 'bg-yellow-500' : 'bg-red-500'
        return (
          <div className="flex items-center justify-end gap-2">
            <span className={`font-medium tabular-nums ${tone}`}>{fmtPct(c)}</span>
            <div className="w-16 bg-[var(--input-bg)] rounded-full h-1.5" aria-hidden="true"><div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${c}%` }} /></div>
          </div>
        )
      } },
  ], [])

  if (filtered.length === 0) {
    return (
      <Card>
        <div className="cc-empty">
          <div>
            {recordsCount === 0 ? 'No tyre records yet. They appear here once they are imported.' : 'No tyres match these filters. Widen the dates or clear a filter.'}
            {hasActiveFilter && <><br /><button type="button" className="cc-btn" onClick={onClearFilters}>Clear filters</button></>}
          </div>
        </div>
      </Card>
    )
  }

  return (
    <div className="tsz-history">
      {kpis.total > 0 && kpis.rated === 0 && (
        <p className="tsz-note">No tyre in scope carries a risk rating, so failure rates read N/A rather than 0%.</p>
      )}
      {/* ── Charts row 1 ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel icon={BarChart3} title="Size mix distribution">
          <div className="p-4">
            {doughnutData.labels.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm">No sizes in scope</div>
            ) : (
              <div className="h-64" role="img" aria-label={`Size mix: ${sortedSizeMetrics.slice(0, 3).map((m) => `${m.size} ${fmtPct(m.pct)}`).join(', ')}`}>
                <Doughnut data={doughnutData} options={doughnutOpts} />
              </div>
            )}
          </div>
        </Panel>

        <Panel
          icon={DollarSign}
          title="CPK by size (ranked)"
          right={(
            <div className="flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-green-500 inline-block" aria-hidden="true" /> Good, up to {BENCHMARK_GOOD}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-yellow-500 inline-block" aria-hidden="true" /> Average, up to {BENCHMARK_AVG}</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-red-500 inline-block" aria-hidden="true" /> Poor, over {BENCHMARK_AVG}</span>
            </div>
          )}
        >
          <div className="p-4">
            {cpkBarData.labels.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm text-center px-4">
                No size has {MIN_RECORDS_CPK}+ tyres with both a price and measured km yet.
              </div>
            ) : (
              <div style={{ height: Math.max(200, cpkBarData.labels.length * 26) }} role="img" aria-label="Average cost per km by tyre size, lowest first">
                <Bar data={cpkBarData} options={cpkBarOpts} />
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Size distribution table + selected-size brand breakdown ─────────── */}
      <Panel icon={Layers} title="Size distribution detail" hint={`${sortedSizeMetrics.length} sizes. Select a row for its brand breakdown.`}>
        <div className="p-3">
          <EnterpriseTable
            columns={sizeColumns}
            data={sortedSizeMetrics}
            getRowId={(m) => m.size}
            onRowClick={(m) => setSelectedSize(selectedSize === m.size ? null : m.size)}
            enableColumnFilters={false}
            searchPlaceholder="Search sizes"
            exportFileName={reportFileName('Tyre Size Distribution')}
            initialPageSize={25}
            viewKey="tyre-size-distribution"
            emptyMessage="No tyre records found"
          />
        </div>
        {selectedSize && (
          <div className="border-t border-[var(--input-border)] p-4 space-y-2" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Brand breakdown for <span className="font-mono">{selectedSize}</span></p>
              <button type="button" onClick={() => setSelectedSize(null)} className="btn-secondary min-h-[44px] inline-flex items-center gap-1 px-3 text-xs">
                <X className="w-3 h-3" aria-hidden="true" /> Close
              </button>
            </div>
            <EnterpriseTable
              columns={breakdownColumns}
              data={breakdown}
              getRowId={(b) => b.brand}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableColumnVisibility={false}
              enableExport={false}
              initialPageSize={25}
              emptyMessage="No brands recorded for this size."
            />
          </div>
        )}
      </Panel>

      {/* ── Size x brand matrix ─────────────────────────────────────────────── */}
      <Panel
        icon={BarChart3}
        title="Size x brand CPK performance matrix"
        hint={`Average CPK in ${activeCurrency}/km. Needs 2+ measured tyres per cell.`}
      >
        <div className="p-3">
          {matrixData.sizes.length === 0 || matrixData.brands.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">Not enough sizes and brands for a matrix</div>
          ) : (
            <EnterpriseTable
              columns={matrixColumns}
              data={matrixRows}
              getRowId={(r) => r.size}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              initialPageSize={25}
              emptyMessage="Not enough data for a matrix"
            />
          )}
        </div>
      </Panel>

      {/* ── Charts row 2 ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel icon={CheckCircle} title="Position-size compliance" hint="Required = the two most used sizes at each position">
          <div className="p-3">
            <EnterpriseTable
              columns={posColumns}
              data={posCompliance}
              getRowId={(p) => p.pos}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              enableExport={false}
              initialPageSize={25}
              emptyMessage="No position data"
            />
          </div>
        </Panel>

        <Panel icon={TrendingUp} title="Top size-brand combos: CPK trend (12 months)">
          <div className="p-4">
            {trendData.datasets.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm text-center px-4">No size-brand combination has a measured CPK in the last 12 months.</div>
            ) : (
              <div className="h-64" role="img" aria-label={`Monthly CPK trend for ${trend.series.map((s) => s.label).join(', ')}`}>
                <Line data={trendData} options={trendOpts} />
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Consolidation opportunities ─────────────────────────────────────── */}
      <Panel icon={Lightbulb} title="Consolidation opportunities" hint={`${consolidationOps.length} recommendation${consolidationOps.length === 1 ? '' : 's'}`}>
        {consolidationOps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-[var(--text-muted)] text-center px-4">
            <CheckCircle className="w-10 h-10 text-green-600" aria-hidden="true" />
            <p className="text-sm">No consolidation opportunities detected. The size mix is well optimized.</p>
          </div>
        ) : (
          <ul className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {consolidationOps.map((op, i) => {
              const impactStyle = {
                Critical: 'border-red-800/60 bg-red-900/10',
                High: 'border-orange-800/60 bg-orange-900/10',
                Low: 'border-[var(--input-border)] bg-[var(--input-bg)]',
              }
              const impactBadge = {
                Critical: 'text-red-400 border border-red-800/60',
                High: 'text-orange-400 border border-orange-800/60',
                Low: 'text-[var(--text-muted)] border border-[var(--input-border)]',
              }
              const typeIcon = {
                eliminate: <X className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />,
                standardize: <CheckCircle className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />,
                review: <ShieldAlert className="w-4 h-4 text-yellow-500 shrink-0" aria-hidden="true" />,
              }
              return (
                <li key={`${op.type}-${op.size}-${i}`} className={`rounded-xl border p-4 ${impactStyle[op.impact] || impactStyle.Low}`}>
                  <div className="flex items-start gap-2 mb-2">
                    {typeIcon[op.type]}
                    <p className="flex-1 min-w-0 text-sm font-semibold text-[var(--text-primary)] leading-tight">{opTitle(op)}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${impactBadge[op.impact]}`}>{op.impact}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">{opDesc(op, activeCurrency)}</p>
                  {op.type !== 'eliminate' && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <DollarSign className="w-3.5 h-3.5 text-green-500" aria-hidden="true" />
                      {op.savings != null
                        ? <span>Est. saving over one tyre life: <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(op.savings, activeCurrency)}</span></span>
                        : <span>Saving not estimated: no measured tyre life for {op.size === UNKNOWN_SIZE ? 'this size' : op.size}.</span>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
