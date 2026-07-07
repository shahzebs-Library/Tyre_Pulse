import { useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// EChart — lean reusable Apache ECharts wrapper.
//
// - Lazy-loads the ~1 MB echarts module on first mount (dynamic import keeps it
//   out of the main bundle chunk); the module promise is memoised per session.
// - Applies `option` on init and whenever the option object identity changes
//   (theme flips flow through naturally because the page rebuilds options with
//   the new palette, changing identity).
// - Resizes via ResizeObserver; disposes the instance on unmount.
// - `onReady(instance)` exposes the live instance (PNG export via getDataURL).
// ─────────────────────────────────────────────────────────────────────────────

let echartsModule = null
let echartsPromise = null

/** Memoised dynamic import of echarts. Exported for pre-warming if desired. */
export function loadEcharts() {
  if (echartsModule) return Promise.resolve(echartsModule)
  if (!echartsPromise) {
    echartsPromise = import('echarts').then((m) => {
      echartsModule = m.default ?? m
      return echartsModule
    }).catch((err) => {
      // Allow a retry on a later mount instead of caching the rejection forever.
      echartsPromise = null
      throw err
    })
  }
  return echartsPromise
}

export default function EChart({
  option,
  onReady,
  notMerge = true,
  className = '',
  style,
  ariaLabel = 'chart',
}) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  // Refs keep the mount effect independent of prop identity churn.
  const optionRef = useRef(option)
  const onReadyRef = useRef(onReady)
  const notMergeRef = useRef(notMerge)
  optionRef.current = option
  onReadyRef.current = onReady
  notMergeRef.current = notMerge

  // Init once; dispose on unmount.
  useEffect(() => {
    let disposed = false
    let observer = null

    loadEcharts()
      .then((echarts) => {
        if (disposed || !containerRef.current) return
        const instance = echarts.init(containerRef.current, null, { renderer: 'canvas' })
        chartRef.current = instance
        if (optionRef.current) instance.setOption(optionRef.current, notMergeRef.current)
        observer = new ResizeObserver(() => {
          if (chartRef.current && !chartRef.current.isDisposed()) chartRef.current.resize()
        })
        observer.observe(containerRef.current)
        if (typeof onReadyRef.current === 'function') onReadyRef.current(instance)
      })
      .catch((err) => {
        if (import.meta.env?.DEV) console.error('[EChart] failed to load echarts', err)
      })

    return () => {
      disposed = true
      if (observer) observer.disconnect()
      if (chartRef.current && !chartRef.current.isDisposed()) chartRef.current.dispose()
      chartRef.current = null
    }
  }, [])

  // Re-apply on option change (includes theme-driven rebuilds from the page).
  useEffect(() => {
    const instance = chartRef.current
    if (instance && !instance.isDisposed() && option) instance.setOption(option, notMerge)
  }, [option, notMerge])

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ width: '100%', height: '100%', minHeight: 200, ...style }}
    />
  )
}
