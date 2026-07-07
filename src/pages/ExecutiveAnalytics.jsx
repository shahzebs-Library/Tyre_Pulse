import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BarChart3, FileSpreadsheet, Filter, Gauge as GaugeIcon,
  Image as ImageIcon, Layers, LineChart, Lock, Network, RefreshCw, ShieldAlert,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import PageHeader from '../components/ui/PageHeader'
import SectionTabs, { ANALYTICS_TABS } from '../components/ui/SectionTabs'
import { SkeletonChart } from '../components/ui/Skeleton'
import EChart from '../components/charts/EChart'
import { getEchartsTheme } from '../components/charts/echartsTheme'
import { exportToExcel } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  buildBrandSizeTreemap, buildCostHeatmap, buildFlowSankey, buildGauges,
  buildMonthlyCombo, buildRiskMatrix, toExcelRows,
} from '../lib/executiveAnalytics'

/**
 * Executive Analytics — presentation-quality boardroom analytics built on
 * Apache ECharts (heatmap, treemap, sankey, gauges, multi-axis, risk matrix).
 * Every chart exports to PNG (canvas snapshot) and Excel (underlying rows).
 *
 * Designed for the `/executive-analytics` route (wired by App.jsx/Layout.jsx).
 * RBAC: Admin / Manager / Director (matches Analytics-family gating).
 */

const VIEW_ROLES = ['Admin', 'Manager', 'Director']

const isoDate = (d) => d.toISOString().slice(0, 10)

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getFullYear(), to.getMonth() - 11, 1)
  return { from: isoDate(from), to: isoDate(to) }
}

/** Whole months covered by the range, clamped 1..24 (heatmap/combo axis size). */
function monthsInRange(from, to) {
  const a = new Date(from); const b = new Date(to)
  if (isNaN(a) || isNaN(b) || b < a) return 12
  const n = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1
  return Math.max(1, Math.min(24, n))
}

const EMPTY_SLICE = { data: [], error: null }

export default function ExecutiveAnalytics() {
  const { profile } = useAuth()
  const { isDark } = useTheme()
  const { activeCountry, activeCurrency } = useSettings()

  const initial = defaultRange()
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
  const [country, setCountry] = useState(activeCountry || 'All')

  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [slices, setSlices] = useState({
    tyres: EMPTY_SLICE, inspections: EMPTY_SLICE, fleet: EMPTY_SLICE, openTyres: EMPTY_SLICE,
  })

  const reqIdRef = useRef(0)
  const chartsRef = useRef({}) // chartKey -> echarts instance

  const palette = useMemo(() => getEchartsTheme(isDark), [isDark])
  const canView = VIEW_ROLES.includes(profile?.role)

  // ── Data load: parallel, allSettled, per-slice isolation ────────────────────
  const load = useCallback(async () => {
    const myReq = ++reqIdRef.current
    setLoading(true)

    const from = dateFrom || defaultRange().from
    const to = dateTo || isoDate(new Date())
    const inspSince = isoDate(new Date(Date.now() - 90 * 86400000))
    const byCountry = (q) => (country !== 'All' ? q.eq('country', country) : q)

    const tasks = {
      // Feeds: heatmap, treemap, sankey, combo, risk bubble size
      tyres: () => fetchAllPages((f, t) => byCountry(supabase
        .from('tyre_records')
        .select('asset_no,site,brand,size,supplier,cost_per_tyre,qty,issue_date'))
        .gte('issue_date', from)
        .lte('issue_date', to)
        .range(f, t)),
      // Feeds: pressure-compliance gauge, risk matrix y-axis (90-day window)
      inspections: () => fetchAllPages((f, t) => supabase
        .from('inspections')
        .select('asset_no,site,status,findings,scheduled_date,completed_date')
        .gte('scheduled_date', inspSince)
        .range(f, t), { max: 10000 }),
      // Feeds: availability gauge
      fleet: async () => {
        const { data, error } = await supabase
          .from('vehicle_fleet')
          .select('asset_no,site,status')
        return { data: data ?? [], error }
      },
      // Feeds: risk matrix x-axis (currently-fitted High/Critical tyres)
      openTyres: () => fetchAllPages((f, t) => byCountry(supabase
        .from('tyre_records')
        .select('asset_no,site,risk_level'))
        .is('removal_date', null)
        .in('risk_level', ['High', 'Critical'])
        .range(f, t)),
    }

    const keys = Object.keys(tasks)
    const settled = await Promise.allSettled(keys.map((k) => tasks[k]()))
    if (myReq !== reqIdRef.current) return

    const next = {}
    keys.forEach((k, i) => {
      const s = settled[i]
      if (s.status === 'fulfilled' && !s.value?.error) {
        next[k] = { data: s.value?.data ?? [], error: null }
      } else {
        const err = s.status === 'rejected' ? s.reason : s.value?.error
        next[k] = { data: [], error: err?.message || String(err) || 'Query failed' }
      }
    })
    setSlices(next)
    setUpdatedAt(new Date())
    setLoading(false)
  }, [dateFrom, dateTo, country])

  useEffect(() => { if (canView) load() }, [load, canView])

  // ── Shaped datasets (pure lib) ─────────────────────────────────────────────
  const months = monthsInRange(dateFrom, dateTo)
  const rangeEnd = useMemo(() => (dateTo ? new Date(dateTo) : new Date()), [dateTo])

  const heatData = useMemo(
    () => buildCostHeatmap(slices.tyres.data, { months, now: rangeEnd }),
    [slices.tyres.data, months, rangeEnd])
  const treeData = useMemo(
    () => buildBrandSizeTreemap(slices.tyres.data),
    [slices.tyres.data])
  const sankeyData = useMemo(
    () => buildFlowSankey(slices.tyres.data),
    [slices.tyres.data])
  const comboData = useMemo(
    () => buildMonthlyCombo(slices.tyres.data, { months, now: rangeEnd }),
    [slices.tyres.data, months, rangeEnd])
  const gaugeData = useMemo(
    () => buildGauges({ inspections: slices.inspections.data, fleet: slices.fleet.data }),
    [slices.inspections.data, slices.fleet.data])
  const riskData = useMemo(
    () => buildRiskMatrix({
      openTyres: slices.openTyres.data,
      inspections: slices.inspections.data,
      records: slices.tyres.data,
    }),
    [slices.openTyres.data, slices.inspections.data, slices.tyres.data])

  const fmtC = useCallback((v) => formatCurrencyCompact(v, activeCurrency), [activeCurrency])

  // ── ECharts options (plain objects; rebuilt when palette flips) ────────────
  const baseTooltip = useMemo(() => ({
    backgroundColor: palette.tooltipBg,
    borderColor: palette.tooltipBorder,
    textStyle: { color: palette.tooltipText, fontSize: 12 },
  }), [palette])

  const heatOption = useMemo(() => ({
    tooltip: {
      ...baseTooltip,
      formatter: (p) => `${heatData.sites[p.value[1]]}<br/>${heatData.monthLabels[p.value[0]]}: <b>${fmtC(p.value[2])}</b>`,
    },
    grid: { left: 8, right: 16, top: 8, bottom: 64, containLabel: true },
    xAxis: {
      type: 'category', data: heatData.monthLabels,
      axisLabel: { color: palette.muted, fontSize: 11 },
      axisLine: { lineStyle: { color: palette.axisLine } },
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category', data: heatData.sites,
      axisLabel: { color: palette.subText, fontSize: 11 },
      axisLine: { lineStyle: { color: palette.axisLine } },
    },
    visualMap: {
      min: 0, max: Math.max(1, heatData.max), calculable: true, orient: 'horizontal',
      left: 'center', bottom: 4, itemHeight: 90,
      inRange: { color: palette.heatRamp },
      textStyle: { color: palette.muted, fontSize: 10 },
      formatter: (v) => fmtC(v),
    },
    series: [{
      type: 'heatmap', data: heatData.cells,
      label: { show: false },
      itemStyle: { borderColor: palette.exportBg, borderWidth: 1 },
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.4)' } },
    }],
  }), [heatData, palette, baseTooltip, fmtC])

  const treeOption = useMemo(() => ({
    tooltip: {
      ...baseTooltip,
      formatter: (p) => `${p.treePathInfo?.map((n) => n.name).filter(Boolean).join(' → ') || p.name}<br/><b>${fmtC(p.value)}</b>`,
    },
    series: [{
      type: 'treemap', data: treeData.children, roam: false, nodeClick: 'zoomToNode',
      breadcrumb: { show: true, bottom: 0, itemStyle: { color: palette.tooltipBg, textStyle: { color: palette.subText } } },
      label: { show: true, color: '#ffffff', fontSize: 11, formatter: '{b}' },
      upperLabel: { show: true, height: 22, color: '#ffffff', fontSize: 11 },
      itemStyle: { borderColor: palette.exportBg, borderWidth: 1, gapWidth: 1 },
      levels: [
        { itemStyle: { borderWidth: 0, gapWidth: 2 } },
        { itemStyle: { gapWidth: 1 }, colorSaturation: [0.35, 0.6] },
      ],
      color: palette.series,
    }],
  }), [treeData, palette, baseTooltip, fmtC])

  const sankeyOption = useMemo(() => {
    const labelOf = new Map(sankeyData.nodes.map((n) => [n.name, n.label]))
    return {
      tooltip: {
        ...baseTooltip,
        formatter: (p) => (p.dataType === 'edge'
          ? `${labelOf.get(p.data.source)} → ${labelOf.get(p.data.target)}: <b>${p.data.value} tyres</b>`
          : `${labelOf.get(p.name) ?? p.name}`),
      },
      series: [{
        type: 'sankey', left: 8, right: 90, top: 12, bottom: 12,
        data: sankeyData.nodes.map((n) => ({ name: n.name, depth: n.depth })),
        links: sankeyData.links,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', opacity: isDark ? 0.35 : 0.3, curveness: 0.5 },
        label: { color: palette.subText, fontSize: 11, formatter: (p) => labelOf.get(p.name) ?? p.name },
        itemStyle: { borderWidth: 0 },
        color: palette.series,
        nodeGap: 10,
      }],
    }
  }, [sankeyData, palette, baseTooltip, isDark])

  const comboOption = useMemo(() => ({
    tooltip: {
      ...baseTooltip, trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const m = params[0]?.axisValue ?? ''
        const lines = params.map((p) => (p.seriesName === 'Tyre Spend'
          ? `${p.marker} ${p.seriesName}: <b>${fmtC(p.value)}</b>`
          : `${p.marker} ${p.seriesName}: <b>${p.value}</b>`))
        return [m, ...lines].join('<br/>')
      },
    },
    legend: { top: 0, textStyle: { color: palette.muted, fontSize: 11 } },
    grid: { left: 8, right: 8, top: 32, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: comboData.monthLabels,
      axisLabel: { color: palette.muted, fontSize: 11 },
      axisLine: { lineStyle: { color: palette.axisLine } },
    },
    yAxis: [
      {
        type: 'value', name: 'Spend', nameTextStyle: { color: palette.muted },
        axisLabel: { color: palette.muted, fontSize: 10, formatter: (v) => fmtC(v) },
        splitLine: { lineStyle: { color: palette.splitLine } },
      },
      {
        type: 'value', name: 'Tyres', nameTextStyle: { color: palette.muted },
        axisLabel: { color: palette.muted, fontSize: 10 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Tyre Spend', type: 'bar', data: comboData.cost,
        itemStyle: { color: palette.series[0], borderRadius: [3, 3, 0, 0] }, barMaxWidth: 26,
      },
      {
        name: 'Tyre Count', type: 'line', yAxisIndex: 1, data: comboData.count,
        smooth: true, symbolSize: 6,
        itemStyle: { color: palette.series[1] }, lineStyle: { width: 2.5 },
      },
    ],
  }), [comboData, palette, baseTooltip, fmtC])

  const gaugeOption = useMemo(() => {
    const mk = (name, value, centerX, sub) => ({
      type: 'gauge', center: [centerX, '58%'], radius: '82%',
      startAngle: 210, endAngle: -30, min: 0, max: 100,
      axisLine: {
        lineStyle: {
          width: 14,
          color: [[0.6, palette.bad], [0.85, palette.warn], [1, palette.good]],
        },
      },
      pointer: { itemStyle: { color: palette.text }, length: '58%', width: 4 },
      axisTick: { distance: -14, length: 4, lineStyle: { color: palette.exportBg, width: 1 } },
      splitLine: { distance: -14, length: 14, lineStyle: { color: palette.exportBg, width: 2 } },
      axisLabel: { color: palette.muted, distance: 20, fontSize: 9 },
      title: { offsetCenter: [0, '78%'], color: palette.subText, fontSize: 12 },
      detail: {
        valueAnimation: true, offsetCenter: [0, '46%'],
        formatter: (v) => `${v}%`, color: palette.text, fontSize: 20, fontWeight: 700,
      },
      data: [{ value, name: `${name}\n${sub}` }],
    })
    return {
      tooltip: { ...baseTooltip, formatter: (p) => `${p.seriesName}: <b>${p.value}%</b>` },
      series: [
        {
          ...mk('Pressure Compliance', gaugeData.pressure.value, '26%',
            `${gaugeData.pressure.compliant}/${gaugeData.pressure.total} inspections`),
          name: 'Pressure Compliance',
        },
        {
          ...mk('Fleet Availability', gaugeData.availability.value, '74%',
            `${gaugeData.availability.active}/${gaugeData.availability.total} vehicles active`),
          name: 'Fleet Availability',
        },
      ],
    }
  }, [gaugeData, palette, baseTooltip])

  const riskOption = useMemo(() => {
    const maxSpend = Math.max(1, riskData.maxSpend)
    const quadLabel = (text, align) => ({
      type: 'text', [align.h]: align.hv, [align.v]: align.vv, silent: true,
      style: { text, fill: palette.muted, fontSize: 10, opacity: 0.9 },
    })
    return {
      tooltip: {
        ...baseTooltip,
        formatter: (p) => {
          const d = p.data
          return `<b>${d[3]}</b>${d[4] ? ` · ${d[4]}` : ''}<br/>`
            + `Open High/Critical tyres: <b>${d[0]}</b><br/>`
            + `Overdue inspections (90d): <b>${d[1]}</b><br/>`
            + `12-month tyre spend: <b>${fmtC(d[2])}</b>`
        },
      },
      grid: { left: 8, right: 20, top: 28, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value', name: 'Open High/Critical tyres', nameLocation: 'middle', nameGap: 26,
        nameTextStyle: { color: palette.muted, fontSize: 11 }, minInterval: 1,
        axisLabel: { color: palette.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: palette.splitLine } },
      },
      yAxis: {
        type: 'value', name: 'Overdue inspections (90d)', nameGap: 14,
        nameTextStyle: { color: palette.muted, fontSize: 11, align: 'left' }, minInterval: 1,
        axisLabel: { color: palette.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: palette.splitLine } },
      },
      graphic: [
        quadLabel('Inspection lapses', { h: 'left', hv: 46, v: 'top', vv: 30 }),
        quadLabel('Critical attention', { h: 'right', hv: 26, v: 'top', vv: 30 }),
        quadLabel('Stable', { h: 'left', hv: 46, v: 'bottom', vv: 44 }),
        quadLabel('Tyre risk', { h: 'right', hv: 26, v: 'bottom', vv: 44 }),
      ],
      series: [{
        type: 'scatter',
        data: riskData.points.map((p) => [p.x, p.y, p.spend, p.asset, p.site]),
        symbolSize: (d) => 8 + Math.sqrt((d[2] || 0) / maxSpend) * 34,
        itemStyle: {
          color: palette.series[0], opacity: 0.55,
          borderColor: palette.series[0], borderWidth: 1,
        },
        emphasis: { itemStyle: { opacity: 0.9 } },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: palette.warn, type: 'dashed', opacity: 0.7 },
          label: { color: palette.muted, fontSize: 9, formatter: 'avg' },
          data: [{ xAxis: riskData.xAvg }, { yAxis: riskData.yAvg }],
        },
      }],
    }
  }, [riskData, palette, baseTooltip, fmtC])

  // ── Exports ─────────────────────────────────────────────────────────────────
  const exportPng = useCallback((key) => {
    const inst = chartsRef.current[key]
    if (!inst || inst.isDisposed()) return
    const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: palette.exportBg })
    const a = document.createElement('a')
    a.href = url
    a.download = `executive-${key}-${isoDate(new Date())}.png`
    a.click()
  }, [palette])

  const exportXlsx = useCallback(async (key, data, title) => {
    const { rows, columns, headers } = toExcelRows(key, data)
    if (!rows.length) return
    await exportToExcel(rows, columns, headers, `executive-${key}`, title, {
      title: `Executive Analytics — ${title}`,
      currency: activeCurrency,
      dateRange: `${dateFrom} → ${dateTo}`,
      meta: { Country: country },
    })
  }, [activeCurrency, dateFrom, dateTo, country])

  const onReady = useCallback((key) => (inst) => { chartsRef.current[key] = inst }, [])

  // ── RBAC gate ───────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Executive Analytics" subtitle="Boardroom-grade fleet intelligence" icon={BarChart3} />
        <div className="card p-8 text-center">
          <Lock size={36} className="mx-auto text-[var(--text-muted)] mb-3" />
          <p className="text-[var(--text-primary)] font-medium mb-1">Restricted area</p>
          <p className="text-sm text-[var(--text-secondary)]">
            Executive Analytics requires the Admin, Manager or Director role.
          </p>
        </div>
      </div>
    )
  }

  const tyresEmpty = !loading && !slices.tyres.error && slices.tyres.data.length === 0
  const heatH = Math.max(280, 130 + heatData.sites.length * 28)

  return (
    <div className="space-y-6">
      <SectionTabs tabs={ANALYTICS_TABS} />
      <PageHeader
        title="Executive Analytics"
        subtitle="Boardroom-grade fleet intelligence — heatmaps, flows, gauges and risk quadrants"
        icon={BarChart3}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      {/* Global filter bar */}
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted pb-2">
          <Filter size={13} /> Filters
        </span>
        <div>
          <label htmlFor="ea-from" className="block text-[11px] text-muted mb-1">From</label>
          <input id="ea-from" type="date" className="input text-sm" value={dateFrom}
            max={dateTo} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ea-to" className="block text-[11px] text-muted mb-1">To</label>
          <input id="ea-to" type="date" className="input text-sm" value={dateTo}
            min={dateFrom} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ea-country" className="block text-[11px] text-muted mb-1">Country</label>
          <select id="ea-country" className="input text-sm" value={country}
            onChange={(e) => setCountry(e.target.value)}>
            <option value="All">All countries</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-4 pb-1 text-xs text-[var(--text-secondary)]">
          <span>Spend <b className="text-[var(--text-primary)]">{fmtC(comboData.totalSpend)}</b></span>
          <span>Tyres <b className="text-[var(--text-primary)]">{comboData.totalCount.toLocaleString()}</b></span>
          <span>Sites <b className="text-[var(--text-primary)]">{heatData.sites.length}</b></span>
          <span>At-risk vehicles <b className="text-[var(--text-primary)]">{riskData.points.length}</b></span>
        </div>
      </div>

      {/* Chart grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          className="xl:col-span-2"
          icon={Layers}
          title="Tyre spend heatmap — site × month"
          subtitle="cost_per_tyre × qty grouped by site and issue month"
          loading={loading} error={slices.tyres.error} empty={tyresEmpty || !heatData.cells.length}
          onRetry={load}
          onPng={() => exportPng('heatmap')}
          onExcel={() => exportXlsx('heatmap', heatData, 'Spend Heatmap')}
        >
          <div style={{ height: heatH }}>
            <EChart option={heatOption} onReady={onReady('heatmap')} ariaLabel="Tyre spend heatmap by site and month" />
          </div>
        </ChartCard>

        <ChartCard
          icon={Layers}
          title="Spend by brand → size"
          subtitle="Treemap of tyre spend; click a brand to zoom"
          loading={loading} error={slices.tyres.error} empty={tyresEmpty || !treeData.children.length}
          onRetry={load}
          onPng={() => exportPng('treemap')}
          onExcel={() => exportXlsx('treemap', treeData, 'Brand-Size Treemap')}
        >
          <div style={{ height: 360 }}>
            <EChart option={treeOption} onReady={onReady('treemap')} ariaLabel="Tyre spend treemap by brand and size" />
          </div>
        </ChartCard>

        <ChartCard
          icon={Network}
          title={sankeyData.mode === 'supplier'
            ? 'Tyre flow — supplier → brand → site'
            : 'Tyre flow — brand → size → site'}
          subtitle={sankeyData.mode === 'supplier'
            ? 'Tyre volume routed from suppliers through brands to fitting sites'
            : 'Supplier data is sparse in this range — showing brand → size → site instead'}
          loading={loading} error={slices.tyres.error} empty={tyresEmpty || !sankeyData.links.length}
          onRetry={load}
          onPng={() => exportPng('sankey')}
          onExcel={() => exportXlsx('sankey', sankeyData, 'Tyre Flow Sankey')}
        >
          <div style={{ height: 360 }}>
            <EChart option={sankeyOption} onReady={onReady('sankey')} ariaLabel="Tyre flow sankey diagram" />
          </div>
        </ChartCard>

        <ChartCard
          icon={LineChart}
          title="Monthly spend vs tyre count"
          subtitle="Cost (bars, left axis) against tyres issued (line, right axis)"
          loading={loading} error={slices.tyres.error} empty={tyresEmpty || !comboData.totalCount}
          onRetry={load}
          onPng={() => exportPng('combo')}
          onExcel={() => exportXlsx('combo', comboData, 'Monthly Spend vs Count')}
        >
          <div style={{ height: 320 }}>
            <EChart option={comboOption} onReady={onReady('combo')} ariaLabel="Monthly tyre spend versus count" />
          </div>
        </ChartCard>

        <ChartCard
          icon={GaugeIcon}
          title="Executive gauges"
          subtitle="Pressure compliance (90-day inspections) and fleet availability (active share)"
          loading={loading}
          error={slices.inspections.error && slices.fleet.error
            ? `${slices.inspections.error} / ${slices.fleet.error}`
            : slices.inspections.error || slices.fleet.error}
          empty={!loading && !gaugeData.pressure.total && !gaugeData.availability.total}
          onRetry={load}
          onPng={() => exportPng('gauges')}
          onExcel={() => exportXlsx('gauges', gaugeData, 'Executive Gauges')}
        >
          <div style={{ height: 320 }}>
            <EChart option={gaugeOption} onReady={onReady('gauges')} ariaLabel="Pressure compliance and fleet availability gauges" />
          </div>
        </ChartCard>

        <ChartCard
          icon={ShieldAlert}
          title="Vehicle risk matrix"
          subtitle="Open High/Critical tyres vs overdue inspections; bubble = 12-month spend"
          loading={loading}
          error={slices.openTyres.error || slices.inspections.error}
          empty={!loading && !riskData.points.length}
          emptyText="No vehicles with open tyre risk or overdue inspections — fleet is in the clear."
          onRetry={load}
          onPng={() => exportPng('risk')}
          onExcel={() => exportXlsx('risk', riskData, 'Vehicle Risk Matrix')}
        >
          <div style={{ height: 360 }}>
            <EChart option={riskOption} onReady={onReady('risk')} ariaLabel="Vehicle risk matrix scatter" />
          </div>
        </ChartCard>
      </div>
    </div>
  )
}

// ── Chart card shell: header + export actions + loading/error/empty states ───
function ChartCard({
  icon: Icon, title, subtitle, loading, error, empty, emptyText,
  onRetry, onPng, onExcel, className = '', children,
}) {
  const hasBody = !loading && !error && !empty
  return (
    <section className={`card p-4 flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            {Icon && <Icon size={15} className="text-[var(--accent)] shrink-0" />}
            <span className="truncate">{title}</span>
          </h2>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onPng}
            disabled={!hasBody}
            title="Export PNG"
            aria-label={`Export ${title} as PNG`}
            className="p-1.5 rounded-lg border border-[var(--border-dim)] text-muted hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors"
          >
            <ImageIcon size={14} />
          </button>
          <button
            type="button"
            onClick={onExcel}
            disabled={!hasBody}
            title="Export Excel"
            aria-label={`Export ${title} data to Excel`}
            className="p-1.5 rounded-lg border border-[var(--border-dim)] text-muted hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors"
          >
            <FileSpreadsheet size={14} />
          </button>
        </div>
      </div>

      {loading && <SkeletonChart />}

      {!loading && error && (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <AlertTriangle size={26} className="text-red-400 mb-2" />
          <p className="text-sm text-[var(--text-secondary)] mb-3 max-w-sm break-words">{String(error)}</p>
          {onRetry && (
            <button type="button" onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs transition-colors">
              <RefreshCw size={13} /> Retry
            </button>
          )}
        </div>
      )}

      {!loading && !error && empty && (
        <div className="flex-1 flex items-center justify-center py-12">
          <p className="text-sm text-muted text-center max-w-sm">
            {emptyText || 'No data for the selected date range and country.'}
          </p>
        </div>
      )}

      {hasBody && children}
    </section>
  )
}
