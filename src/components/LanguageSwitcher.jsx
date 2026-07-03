import { Languages } from 'lucide-react'
import { useLanguage } from '../contexts/LanguageContext'

/**
 * Compact language switcher. Two visual styles:
 *  - `variant="pills"` (default): segmented EN / ع toggle for headers & sidebars.
 *  - `variant="segment"`: full-width labelled buttons for Settings / Login.
 */
export default function LanguageSwitcher({ variant = 'pills', className = '' }) {
  const { language, setLanguage, languages } = useLanguage()

  if (variant === 'segment') {
    return (
      <div className={`flex gap-2 ${className}`}>
        {languages.map(l => (
          <button
            key={l.code}
            type="button"
            onClick={() => setLanguage(l.code)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              language === l.code
                ? 'bg-green-700 text-white border-green-600'
                : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'
            }`}
            aria-pressed={language === l.code}
          >
            {l.native}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-lg p-0.5 ${className}`}
      style={{ background: 'var(--input-bg)', border: '1px solid var(--border-dim)' }}
      role="group"
      aria-label="Language"
    >
      <Languages size={13} className="mx-1 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
      {languages.map(l => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLanguage(l.code)}
          className="px-2 py-1 rounded-md text-[11px] font-bold transition-all"
          style={
            language === l.code
              ? { background: 'linear-gradient(135deg,#15803d,#16a34a)', color: '#fff' }
              : { color: 'var(--text-muted)' }
          }
          aria-pressed={language === l.code}
          title={l.label}
        >
          {l.code === 'ar' ? 'ع' : 'EN'}
        </button>
      ))}
    </div>
  )
}
