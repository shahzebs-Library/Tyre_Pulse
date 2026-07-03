import { Database, Search, Filter, RefreshCw } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'

const ICONS = { database: Database, search: Search, filter: Filter }

export default function EmptyState({
  icon = 'database',
  title,
  description,
  action = null,     // { label: string, onClick: fn }
  compact = false,
}) {
  const { t } = useLanguage()
  const heading = title ?? t('ui.emptyState.title')
  const desc = description === undefined ? t('ui.emptyState.description') : description
  const Icon = typeof icon === 'string' ? (ICONS[icon] ?? Database) : icon

  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-16'} px-6`}>
      <div className="w-14 h-14 rounded-2xl bg-gray-800/60 border border-gray-700/40 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-gray-500" />
      </div>
      <p className={`font-semibold text-gray-300 ${compact ? 'text-sm' : 'text-base'}`}>{heading}</p>
      {desc && (
        <p className={`text-gray-500 mt-1.5 max-w-xs leading-relaxed ${compact ? 'text-xs' : 'text-sm'}`}>
          {desc}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {action.label}
        </button>
      )}
    </div>
  )
}
