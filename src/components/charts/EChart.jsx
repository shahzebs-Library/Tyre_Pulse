/**
 * EChart — reusable, lazy-loading React wrapper around Apache ECharts.
 *
 * echarts is loaded via dynamic import() on first mount, so it ships as its
 * own async chunk and never enters the main bundle. The instance is theme-
 * aware (tracks the app's `dark` root class), resizes via ResizeObserver,
 * and is disposed on unmount. On SDK-load or init failure it renders a
 * fallback div instead of throwing, and reports through captureError.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { captureError } from '../../lib/monitoring'
import { useChartTheme, baseOption } from './theme'

let echartsPromise = null

/** Load echarts once per session; all chart instances share the module. */
function loadECharts() {
  if (!echartsPromise) echartsPromise = import('echarts')
  return echartsPromise
}

/**
 * @param {object} props
 * @param {object} props.option    ECharts option object (replaces previous option on change).
 * @param {number|string} [props.height=320]  Chart height (px number or CSS string).
 * @param {string} [props.className]          Extra classes for the wrapper.
 * @param {(chart: object) => void} [props.onReady]  Called once with the echarts instance.
 * @param {string} [props.ariaLabel]           Accessible label for the chart region.
 */
export default function EChart({ option, height = 320, className = '', onReady, ariaLabel }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const theme = useChartTheme()

  // Mount: load echarts lazily, init, wire ResizeObserver; dispose on unmount.
  useEffect(() => {
    let disposed = false
    let resizeObserver = null

    loadECharts()
      .then((echarts) => {
        if (disposed || !containerRef.current) return
        const chart = echarts.init(containerRef.current, null, { renderer: 'canvas' })
        chartRef.current = chart
        setStatus('ready')
        onReadyRef.current?.(chart)
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (chartRef.current && !chartRef.current.isDisposed?.()) chartRef.current.resize()
          })
          resizeObserver.observe(containerRef.current)
        }
      })
      .catch((err) => {
        if (disposed) return
        captureError(err, { component: 'EChart', phase: 'load/init' })
        setStatus('error')
      })

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      if (chartRef.current) {
        chartRef.current.dispose()
        chartRef.current = null
      }
    }
  }, [])

  // Apply option whenever it, the theme, or readiness changes.
  const applyOption = useCallback(() => {
    const chart = chartRef.current
    if (!chart || status !== 'ready' || !option) return
    try {
      chart.setOption({ ...baseOption(theme), ...option }, { notMerge: true })
    } catch (err) {
      captureError(err, { component: 'EChart', phase: 'setOption' })
      setStatus('error')
    }
  }, [option, theme, status])

  useEffect(() => { applyOption() }, [applyOption])

  const style = { height: typeof height === 'number' ? `${height}px` : height, width: '100%' }

  if (status === 'error') {
    return (
      <div
        role="img"
        aria-label={ariaLabel || 'Chart unavailable'}
        style={style}
        className={`flex items-center justify-center rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 ${className}`}
      >
        Chart could not be rendered
      </div>
    )
  }

  return (
    <div style={style} className={`relative ${className}`} role="img" aria-label={ariaLabel || 'Chart'}>
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 dark:border-gray-600 dark:border-t-blue-400" />
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
