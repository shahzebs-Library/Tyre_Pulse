import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'

/**
 * ThemeToggle — one-click theme control available to every user.
 *
 * Cycles the app theme selection Light > Dark > System > Light, driving the
 * shared ThemeContext (which flips the `html.light` class). The rendered icon
 * reflects the CURRENT selection (Sun=Light, Moon=Dark, Monitor=System). When
 * `includeSystem` is false it becomes a simple Light/Dark switch.
 *
 * Presentation only: it does not own any palette. Colour comes from the caller
 * via `currentColor`, so it reads correctly on both the dark sidebar and the
 * light field header.
 */

const NEXT = { light: 'dark', dark: 'system', system: 'light' }
const NEXT_TWO = { light: 'dark', dark: 'light', system: 'dark' }
const ICON = { light: Sun, dark: Moon, system: Monitor }
const LABEL = { light: 'Light', dark: 'Dark', system: 'System' }

export default function ThemeToggle({
  size = 15,
  includeSystem = true,
  className = '',
  showLabel = false,
}) {
  const { mode, setTheme } = useTheme()
  const current = mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system'
  const next = (includeSystem ? NEXT : NEXT_TWO)[current]
  const Icon = ICON[current] || Monitor
  const title = `Theme: ${LABEL[current]}. Switch to ${LABEL[next]}`

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={title}
      aria-label={title}
      className={
        className ||
        'inline-flex items-center justify-center gap-1.5 w-7 h-7 rounded-lg text-gray-600 hover:text-green-400 transition-all duration-200 hover:bg-green-400/10'
      }
    >
      <Icon size={size} aria-hidden="true" />
      {showLabel && <span className="text-xs font-semibold">{LABEL[current]}</span>}
    </button>
  )
}
