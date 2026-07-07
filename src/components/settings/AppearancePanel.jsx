import { useState } from 'react'
import { Palette, Sun, Moon, Monitor, Check, RotateCcw, AlignJustify, Menu, Sparkles } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'

/**
 * Appearance — personal theme, accent colour, density and motion controls.
 * Every choice applies live and persists per user on this device (localStorage),
 * so anyone can make TyrePulse look the way they want without touching the org
 * brand. A personal accent overrides the organisation brand for this user only.
 */
const MODE_ICON = { light: Sun, dark: Moon, system: Monitor }

function Segment({ options, value, onChange, render }) {
  return (
    <div className="inline-flex w-full gap-1 p-1 rounded-xl bg-[var(--input-bg)] border border-[var(--input-border)]">
      {options.map((o) => {
        const active = value === o.id
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors ${
              active
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {render ? render(o, active) : o.label}
          </button>
        )
      })}
    </div>
  )
}

export default function AppearancePanel() {
  const { t } = useLanguage()
  const {
    mode, setMode, accent, setAccent, density, setDensity,
    reducedMotion, setReducedMotion, reset, presets, modes, densities,
    isDefaultAppearance,
  } = useTheme()
  const [customOpen, setCustomOpen] = useState(false)

  return (
    <div className="card space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Palette size={16} /> {t('appearance.title')}
        </h2>
        {!isDefaultAppearance && (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1.5"
          >
            <RotateCcw size={13} /> {t('appearance.reset')}
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)] -mt-2">{t('appearance.subtitle')}</p>

      {/* Theme mode */}
      <div>
        <label className="label">{t('appearance.theme')}</label>
        <Segment
          options={modes}
          value={mode}
          onChange={setMode}
          render={(o, active) => {
            const Icon = MODE_ICON[o.id] || Monitor
            return <><Icon size={14} className={active ? '' : 'opacity-70'} /> {t(`appearance.modes.${o.id}`)}</>
          }}
        />
      </div>

      {/* Accent colour */}
      <div>
        <div className="flex items-center justify-between">
          <label className="label">{t('appearance.accent')}</label>
          {accent && (
            <button type="button" onClick={() => setAccent('')}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              {t('appearance.useOrgDefault')}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mt-1">
          {presets.map((p) => {
            const active = accent.toLowerCase() === p.value.toLowerCase()
            return (
              <button
                key={p.id}
                type="button"
                title={p.label}
                onClick={() => setAccent(p.value)}
                aria-label={p.label}
                aria-pressed={active}
                className={`w-8 h-8 rounded-full grid place-items-center transition-transform hover:scale-110 ${active ? 'ring-2 ring-offset-2 ring-offset-[var(--surface-1)]' : ''}`}
                style={{ background: p.value, boxShadow: active ? `0 0 0 2px ${p.value}` : 'none' }}
              >
                {active && <Check size={15} className="text-white drop-shadow" />}
              </button>
            )
          })}
          {/* Custom */}
          <button
            type="button"
            onClick={() => setCustomOpen((v) => !v)}
            title={t('appearance.custom')}
            className="w-8 h-8 rounded-full grid place-items-center border border-dashed border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            style={{ background: 'conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #ec4899, #ef4444)' }}
          >
            <Sparkles size={14} className="text-white drop-shadow" />
          </button>
        </div>
        {customOpen && (
          <div className="flex items-center gap-2 mt-3">
            <input
              type="color"
              value={accent || '#16a34a'}
              onChange={(e) => setAccent(e.target.value)}
              className="w-10 h-9 rounded-lg bg-transparent border border-[var(--input-border)] cursor-pointer p-0.5"
              aria-label={t('appearance.custom')}
            />
            <input
              type="text"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              placeholder="#16a34a"
              spellCheck={false}
              className="input flex-1 font-mono text-sm"
            />
          </div>
        )}
      </div>

      {/* Density */}
      <div>
        <label className="label">{t('appearance.density')}</label>
        <Segment
          options={densities}
          value={density}
          onChange={setDensity}
          render={(o, active) => {
            const Icon = o.id === 'compact' ? AlignJustify : Menu
            return <><Icon size={14} className={active ? '' : 'opacity-70'} /> {t(`appearance.densities.${o.id}`)}</>
          }}
        />
      </div>

      {/* Reduced motion */}
      <label className="flex items-center justify-between cursor-pointer">
        <span>
          <span className="block text-sm text-[var(--text-primary)]">{t('appearance.reduceMotion')}</span>
          <span className="block text-xs text-[var(--text-muted)]">{t('appearance.reduceMotionHint')}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={reducedMotion}
          onClick={() => setReducedMotion(!reducedMotion)}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${reducedMotion ? 'bg-[var(--accent)]' : 'bg-[var(--input-bg)] border border-[var(--input-border)]'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${reducedMotion ? 'translate-x-5' : ''}`} />
        </button>
      </label>
    </div>
  )
}
