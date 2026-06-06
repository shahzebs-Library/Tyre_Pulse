import { X, Download } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

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
 * ChartModal — fullscreen chart enlargement with optional filter controls.
 *
 * Props:
 *   open            boolean
 *   onClose         () => void
 *   title           string
 *   children        JSX  (the chart element)
 *   chartRef        React ref pointing to the Chart.js instance (for PNG download)
 *   filters         object  { granularity, year, month, site, brand }
 *   onFilterChange  (key, value) => void
 *   filterOptions   { sites: string[], brands: string[], years: number[] }
 *   showGranularity boolean (default false)
 *   showMonth       boolean — override: force show/hide month picker
 *   showSite        boolean (default true when sites provided)
 *   showBrand       boolean (default true when brands provided)
 */
export function ChartModal({
  open,
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
    if (!chartRef?.current) return
    try {
      const url = chartRef.current.toBase64Image('image/png', 1.0)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title || 'chart'}.png`
      a.click()
    } catch {
      // silently ignore if chart ref not ready
    }
  }

  function change(key, value) {
    if (onFilterChange) onFilterChange(key, value)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="chart-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6"
          onClick={onClose}
        >
          <motion.div
            key="chart-modal-card"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1,   y: 0  }}
            exit={{ opacity: 0, scale: 0.95,   y: 16 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-5xl flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* Header row */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-800 flex-shrink-0">
              <h2 className="text-lg font-semibold text-white">{title}</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadPng}
                  title="Download PNG"
                  className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"
                >
                  <Download size={16} />
                </button>
                <button
                  onClick={onClose}
                  title="Close"
                  className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Filter bar */}
            {(showGranularity || filters.year !== undefined || (showSite && sites.length > 0) || (showBrand && brands.length > 0)) && (
              <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-gray-800 flex-shrink-0 bg-gray-900/60">

                {/* Granularity pills */}
                {showGranularity && (
                  <div className="flex gap-1">
                    {GRANULARITY_OPTIONS.map(g => (
                      <button
                        key={g}
                        onClick={() => change('granularity', g)}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                          granularity === g
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                )}

                {/* Year */}
                {filters.year !== undefined && (
                  <select
                    value={filters.year}
                    onChange={e => change('year', Number(e.target.value))}
                    className="input py-1 px-2 text-xs h-7 w-24"
                  >
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}

                {/* Month (conditional) */}
                {displayMonth && filters.month !== undefined && (
                  <select
                    value={filters.month}
                    onChange={e => change('month', Number(e.target.value))}
                    className="input py-1 px-2 text-xs h-7 w-28"
                  >
                    <option value={0}>All Months</option>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                )}

                {/* Site */}
                {showSite && sites.length > 0 && (
                  <select
                    value={filters.site || ''}
                    onChange={e => change('site', e.target.value)}
                    className="input py-1 px-2 text-xs h-7 w-36"
                  >
                    <option value="">All Sites</option>
                    {sites.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}

                {/* Brand */}
                {showBrand && brands.length > 0 && (
                  <select
                    value={filters.brand || ''}
                    onChange={e => change('brand', e.target.value)}
                    className="input py-1 px-2 text-xs h-7 w-36"
                  >
                    <option value="">All Brands</option>
                    {brands.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                )}
              </div>
            )}

            {/* Chart area */}
            <div className="flex-1 min-h-0 p-6">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
