/**
 * GaugeChart — KPI gauge with threshold bands (e.g. pressure compliance %,
 * inspection compliance %). Thin config-builder over EChart.
 */

import EChart from './EChart'
import { useChartTheme, STATUS } from './theme'

/** Default good → warning → critical bands for a 0–100 compliance-style KPI. */
export const DEFAULT_BANDS = [
  { upTo: 60, color: STATUS.critical },
  { upTo: 85, color: STATUS.warning },
  { upTo: 100, color: STATUS.good },
]

/**
 * Pure option builder — exported for tests.
 * @param {object} cfg
 * @param {number} cfg.value  Current KPI value.
 * @param {number} [cfg.min=0]
 * @param {number} [cfg.max=100]
 * @param {{upTo: number, color: string}[]} [cfg.bands]  Threshold bands in
 *   ascending upTo order; each colors the arc from the previous bound to upTo.
 * @param {string} [cfg.label]  KPI name shown under the value.
 * @param {string} [cfg.unit]   Unit suffix, e.g. '%'.
 * @param {object} theme  Token set from resolveChartTheme/useChartTheme.
 * @returns {object} ECharts option.
 */
export function buildGaugeOption({ value = 0, min = 0, max = 100, bands = DEFAULT_BANDS, label = '', unit = '' }, theme) {
  const span = max - min || 1
  const sorted = [...bands].sort((a, b) => a.upTo - b.upTo)
  const colorStops = sorted.map((b) => [
    Math.min(1, Math.max(0, (b.upTo - min) / span)),
    b.color,
  ])
  if (colorStops.length === 0 || colorStops[colorStops.length - 1][0] < 1) {
    colorStops.push([1, sorted.length ? sorted[sorted.length - 1].color : STATUS.good])
  }
  const clamped = Math.min(max, Math.max(min, value))
  const bandColor = (sorted.find((b) => clamped <= b.upTo) || sorted[sorted.length - 1])?.color || theme.palette[0]

  return {
    series: [
      {
        type: 'gauge',
        min,
        max,
        startAngle: 210,
        endAngle: -30,
        axisLine: { lineStyle: { width: 14, color: colorStops } },
        pointer: { length: '60%', width: 4, itemStyle: { color: theme.text } },
        anchor: { show: true, size: 8, itemStyle: { color: theme.text } },
        axisTick: { distance: -14, length: 4, lineStyle: { color: theme.surface, width: 1 } },
        splitLine: { distance: -14, length: 14, lineStyle: { color: theme.surface, width: 2 } },
        axisLabel: { distance: 20, color: theme.textMuted, fontSize: 10 },
        title: { offsetCenter: [0, '72%'], color: theme.textMuted, fontSize: 12 },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, '42%'],
          formatter: (v) => `${Math.round(v * 10) / 10}${unit}`,
          color: bandColor,
          fontSize: 22,
          fontWeight: 700,
        },
        data: [{ value: clamped, name: label }],
      },
    ],
  }
}

/**
 * @param {object} props
 * @param {number} props.value
 * @param {number} [props.min=0]
 * @param {number} [props.max=100]
 * @param {{upTo: number, color: string}[]} [props.bands]
 * @param {string} [props.label]
 * @param {string} [props.unit]
 * @param {number|string} [props.height=240]
 * @param {string} [props.className]
 * @param {(chart: object) => void} [props.onReady]
 */
export default function GaugeChart({ value, min = 0, max = 100, bands = DEFAULT_BANDS, label = '', unit = '', height = 240, className, onReady }) {
  const theme = useChartTheme()

  if (!Number.isFinite(value)) {
    return (
      <div
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
        className={`flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 ${className || ''}`}
      >
        No KPI data available
      </div>
    )
  }

  return (
    <EChart
      option={buildGaugeOption({ value, min, max, bands, label, unit }, theme)}
      height={height}
      className={className}
      onReady={onReady}
      ariaLabel={`${label || 'KPI'} gauge: ${value}${unit}`}
    />
  )
}
