/**
 * Executive charting components (Apache ECharts, lazy-loaded).
 * Import from '@/components/charts' — echarts itself only downloads when a
 * chart first mounts (separate async chunk).
 */

export { default as EChart } from './EChart'
export { default as TrendChart, buildTrendOption } from './TrendChart'
export { default as HeatmapChart, buildHeatmapOption } from './HeatmapChart'
export { default as GaugeChart, buildGaugeOption, DEFAULT_BANDS } from './GaugeChart'
export { default as ParetoChart, buildParetoOption } from './ParetoChart'
export { resolveChartTheme, useChartTheme, CATEGORICAL, SEQUENTIAL, STATUS } from './theme'
