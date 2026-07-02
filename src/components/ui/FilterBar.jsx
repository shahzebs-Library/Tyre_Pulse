import { Search, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useLanguage } from '../../contexts/LanguageContext'

/**
 * FilterBar - glassmorphic filter row with search + selects + optional extra controls.
 *
 * @param {string}   search         - controlled search value
 * @param {function} onSearch       - onChange(value)
 * @param {string}   placeholder
 * @param {Array}    selects        - [{ value, onChange, options:[{value,label}], placeholder }]
 * @param {ReactNode} children      - extra controls appended to the right
 * @param {string}   className
 */
export default function FilterBar({
  search = '',
  onSearch,
  placeholder,
  selects = [],
  children,
  className,
}) {
  const { t } = useLanguage()
  const searchPlaceholder = placeholder ?? t('ui.filterBar.searchPlaceholder')
  return (
    <div className={cn(
      'flex flex-wrap items-center gap-2 p-3 rounded-2xl',
      'bg-surface-1 border border-[var(--border-dim)]',
      'backdrop-blur-md',
      className
    )}>
      {/* Search */}
      {onSearch !== undefined && (
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className={cn(
              'w-full pl-8 pr-8 py-2 rounded-xl text-sm',
              'bg-surface-2 border border-[var(--border-dim)] text-white placeholder-muted',
              'focus:outline-none focus:border-brand/40 focus:bg-surface-3',
              'transition-all duration-200'
            )}
          />
          {search && (
            <button
              onClick={() => onSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Selects */}
      {selects.map((s, i) => (
        <select
          key={i}
          value={s.value}
          onChange={e => s.onChange(e.target.value)}
          className={cn(
            'px-3 py-2 rounded-xl text-sm min-w-[130px]',
            'bg-surface-2 border border-[var(--border-dim)] text-white',
            'focus:outline-none focus:border-brand/40',
            'transition-all duration-200 cursor-pointer',
            !s.value && 'text-muted'
          )}
        >
          <option value="">{s.placeholder || t('common.all')}</option>
          {s.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ))}

      {/* Extra */}
      {children}
    </div>
  )
}
