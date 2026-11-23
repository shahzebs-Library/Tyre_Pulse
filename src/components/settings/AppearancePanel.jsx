import { useState } from 'react'
import { Palette, Sun, Moon, Monitor, Check, RotateCcw, AlignJustify, Menu, Sparkles } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../contexts/LanguageContext'

/**
 * Appearance — personal theme, accent colour, density and motion controls.
 * Every choice applies live, is kept on this device (localStorage, applied
 * before first paint) and is saved to the user's account so it follows them to
 * other devices. A personal accent overrides the organisation brand for this
 * user only.
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
        <div
          role="radiogroup"
          aria-label={t('appearance.accent')}
          className="flex flex-wrap gap-2 mt-1"
          onKeyDown={(e) => {
            if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return
            e.preventDefault()
            const ids = presets.map((p) => p.value)
            const cur = Math.max(0, ids.indexOf(accent))
            const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
            const next = ids[(cur + step + ids.length) % ids.length]
            setAccent(next)
            e.currentTarget.querySelector(`[data-accent-id="${next}"]`)?.focus()
          }}
        >
          {presets.map((p) => {
            const active = accent === p.value
            const tabbable = active || (!presets.some((x) => x.value === accent) && p.value === presets[0].value)
            const name = t(`appearance.accents.${p.id}`)
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={name}
                title={name}
                tabIndex={tabbable ? 0 : -1}
                data-accent-id={p.value}
                onClick={() => setAccent(p.value)}
                className={`w-8 h-8 rounded-full grid place-items-center transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)] ${active ? 'ring-2 ring-offset-2 ring-offset-[var(--surface-1)]' : ''}`}
                style={{ background: p.swatch, boxShadow: active ? `0 0 0 2px ${p.swatch}` : 'none' }}
              >
                {active && <Check size={15} className="text-white drop-shadow" aria-hidden="true" />}
              </button>
            )
          })}
          {/* Custom */}
          <button
            type="button"
            onClick={() => setCustomOpen((v) => !v)}
            title={t('appearance.custom')}
            className="w-8 h-8 rounded-full grid place-items-center border border-dashed border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            style={{ background: 'conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #2a78d6, #475569, #ef4444)' }}
          >
            <Sparkles size={14} className="text-white drop-shadow" />
          </button>
        </div>
        {customOpen && (
          <div className="flex items-center gap-2 mt-3">
            <input
              type="color"
              value={accent.startsWith('#') ? accent : '#16a34a'}
              onChange={(e) => setAccent(e.target.value)}
              className="w-10 h-9 rounded-lg bg-transparent border border-[var(--input-border)] cursor-pointer p-0.5"
              aria-label={t('appearance.custom')}
            />
            <input
              type="text"
              value={accent.startsWith('#') ? accent : ''}
              onChange={(e) => setAccent(e.target.value)}
              placeholder="#16a34a"
              spellCheck={false}
              className="input flex-1 font-mono text-sm"
            />
          </div>
        )}
        {/* Live preview: painted from the same accent tokens the whole app reads. */}
        <div className="mt-3 rounded-xl border border-[var(--input-border)] p-3 flex flex-wrap items-center gap-3" aria-label={t('appearance.preview')}>
          <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] w-full">{t('appearance.preview')}</span>
          <span
            className="inline-flex items-center gap-2 py-1.5 ps-2.5 pe-3 rounded-xl text-[12.5px] font-medium text-[var(--accent-ink)]"
            style={{
              background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.16) 0%, rgba(var(--accent-rgb),0.07) 100%)',
              border: '1px solid rgba(var(--accent-rgb),0.24)',
            }}
          >
            <span className="w-[3px] h-3.5 rounded-full" style={{ background: 'linear-gradient(180deg, var(--accent-light), var(--accent-strong), var(--accent-deep))' }} />
            <Palette size={13} className="text-[var(--accent-icon)]" aria-hidden="true" /> {t('appearance.previewNav')}
          </span>
          <span className="btn-primary pointer-events-none" aria-hidden="true">{t('appearance.previewButton')}</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--brand-on-tint)' }}>{t('appearance.previewLink')}</span>
        </div>
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
