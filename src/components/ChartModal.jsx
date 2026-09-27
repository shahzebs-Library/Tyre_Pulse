import { Download } from 'lucide-react'
import { downloadChartPng } from '../lib/chartCapture'
import Modal from './ui/Modal'

const GRANULARITY_OPTIONS = ['Daily', 'Weekly', 'Monthly', 'Yearly']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function generateYears(count = 5) {
  const now = new Date().getFullYear()
  return Array.from({ length: count }, (_, i) => now - i)
}

/**
 * ChartModal - enlarged chart view with optional filter controls, on the shared
 * Modal shell (focus trap, Escape, backdrop close, viewport sizing, theme tokens).
 *
 * Props:
 *   open            boolean. Defaults to true, so a caller that mounts the modal
 *                   conditionally ({expanded && <ChartModal ...>}) still shows it.
 *   onClose         () => void
 *   title           string
 *   children        JSX  (the chart element)
 *   chartRef        React ref pointing to the Chart.js instance (for PNG download)
 *   filters         object  { granularity, year, month, site, brand }
 *   onFilterChange  (key, value) => void
 *   filterOptions   { sites: string[], brands: string[], years: number[] }
 *   showGranularity boolean (default false)
 *   showMonth       boolean - override: force show/hide month picker
 *   showSite        boolean (default true when sites provided)
 *   showBrand       boolean (default true when brands provided)
 */
export function ChartModal({
  open = true,
  onClose,
  title,
  children,
  chartRef,
  filters = {},
  onFilterChange,
  filterOptions = {},
  showGranularity = false,
  showMonth,
  showSite = true,
  showBrand = true,
}) {
  const years  = filterOptions.years?.length ? filterOptions.years : generateYears(5)
  const sites  = filterOptions.sites  || []
  const brands = filterOptions.brands || []

  const granularity = filters.granularity || 'Monthly'
  const displayMonth =
    showMonth !== undefined
      ? showMonth
      : showGranularity && (granularity === 'Daily' || granularity === 'Monthly')

  function handleDownloadPng() {
    // Re-renders the live chart on a white "paper" theme so the PNG never has a
    // black/transparent background (see src/lib/chartCapture.js).
    if (!chartRef?.current) return
    try {
      downloadChartPng(chartRef.current, title || 'chart')
    } catch {
      // chart ref not ready yet; nothing to download
    }
  }

  function change(key, value) {
    if (onFilterChange) onFilterChange(key, value)
  }

  const hasFilters = showGranularity || filters.year !== undefined
    || (showSite && sites.length > 0) || (showBrand && brands.length > 0)
  const selectCls = 'input py-1 px-2 text-sm min-h-[44px]'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="xl"
      headerExtra={chartRef ? (
        <button
          type="button"
          onClick={handleDownloadPng}
          aria-label="Download chart as PNG"
          title="Download PNG"
          className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Download size={16} aria-hidden="true" />
        </button>
      ) : null}
    >
      {hasFilters && (
        <div className="flex flex-wrap items-center gap-3 pb-3 mb-3 border-b border-[var(--border)]" role="group" aria-label="Chart filters">
          {showGranularity && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Granularity">
              {GRANULARITY_OPTIONS.map(g => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={granularity === g}
                  onClick={() => change('granularity', g)}
                  className={`px-3 min-h-[44px] rounded-lg text-xs font-medium transition-colors ${
                    granularity === g ? 'btn-primary' : 'btn-secondary'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          )}

          {filters.year !== undefined && (
            <select aria-label="Year" value={filters.year} onChange={e => change('year', Number(e.target.value))} className={`${selectCls} w-28`}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}

          {displayMonth && filters.month !== undefined && (
            <select aria-label="Month" value={filters.month} onChange={e => change('month', Number(e.target.value))} className={`${selectCls} w-36`}>
              <option value={0}>All Months</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          )}

          {showSite && sites.length > 0 && (
            <select aria-label="Site" value={filters.site || ''} onChange={e => change('site', e.target.value)} className={`${selectCls} w-40`}>
              <option value="">All Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          {showBrand && brands.length > 0 && (
            <select aria-label="Brand" value={filters.brand || ''} onChange={e => change('brand', e.target.value)} className={`${selectCls} w-40`}>
              <option value="">All Brands</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
        </div>
      )}

      {/* A bare chart (maintainAspectRatio false) sizes to this area; callers that
          wrap their chart in their own fixed-height box simply grow past it. */}
      <div className="relative w-full" style={{ minHeight: 'max(260px, min(50vh, 420px))' }}>
        {children}
      </div>
    </Modal>
  )
}
