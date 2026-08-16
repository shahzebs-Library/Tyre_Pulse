/**
 * ReportingScopeBar - which countries an ANALYTICS surface aggregates over.
 *
 * MOUNT THIS ON REPORTING PAGES ONLY. It is deliberately NOT part of the top bar:
 * "which countries does this report cover" is a question only a report asks, and
 * putting it in the global chrome would imply it governs every screen.
 *
 * It is a genuinely different question from the working context, and the two must
 * never be confused:
 *   working context = the ONE operational place I am working in (top bar)
 *   reporting scope = the SET of countries this report aggregates (here)
 * So multi-select is correct here and wrong there. This component never calls
 * setWorkingContext and never touches the legacy `activeCountry` bridge: a
 * cross-country report must not silently re-point the operational selection.
 *
 * CURRENCY: KSA reports in SAR, UAE in AED, Egypt in EGP, and this app never sums
 * across them (a blended SAR+AED+EGP total has been a real, repeatedly-fixed bug
 * here). A multi-country scope therefore means "report each of these side by
 * side", not "add them up". Enforcing that is the consuming report's job; the
 * caption below says so to the reader, and the scope object itself carries no
 * total.
 *
 * Honest states, not flattering ones: an empty resolution renders "No countries",
 * never "All countries", because overstating coverage is how someone signs off a
 * report that covered nothing. When the user may only ever see one country there
 * is nothing to choose, so it renders as a static label.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Globe, BarChart3 } from 'lucide-react'
import useAnchoredPopover from '../ui/useAnchoredPopover'
import { useSettings } from '../../contexts/SettingsContext'
import { useLanguage } from '../../contexts/LanguageContext'
import { SCOPE_ALL, scopeLabel, scopeCountries } from '../../lib/reportingScope'

/**
 * Translate with an honest English fallback. `t(key, vars)` takes interpolation
 * VARS second, not a fallback, so a key with no locale entry comes back as the
 * raw key and would leak into the UI.
 */
function tx(t, key, fallback) {
  const v = typeof t === 'function' ? t(key) : undefined
  return !v || v === key ? fallback : v
}

/**
 * @param {object}   props
 * @param {boolean}  props.showCaption  render the one-line explainer (default true)
 * @param {Function} props.onChange     optional notification after a scope change,
 *                                      called with the resolved country array so a
 *                                      report can refetch without re-deriving it
 * @param {string}   props.className    extra classes on the wrapper
 */
export default function ReportingScopeBar({ showCaption = true, onChange, className = '' }) {
  const settings = useSettings() || {}
  const { t } = useLanguage()
  const { reportingScope, setReportingScope, allowedScopeCountries } = settings

  // Defensive: the context may not have resolved on the first paint, and a
  // not-yet-loaded value must never crash a report page.
  const allowed = useMemo(
    () => (Array.isArray(allowedScopeCountries) ? allowedScopeCountries.filter(Boolean) : []),
    [allowedScopeCountries],
  )
  const selected = useMemo(() => scopeCountries(reportingScope, allowed), [reportingScope, allowed])
  // Same reason as the working-context chip: scopeLabel returns English
  // 'All countries' for the all-case because it is a pure, test-pinned lib.
  // Translate just that case; country names need no translation.
  const rawLabel = scopeLabel(reportingScope, allowed)
  const label = rawLabel === 'All countries'
    ? tx(t, 'shell.allCountries', 'All countries')
    : rawLabel

  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const popRef = useRef(null)
  const { triggerRef, coords } = useAnchoredPopover(open, { width: 248, height: 300, align: 'left' })

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      const inside = rootRef.current?.contains(e.target) || popRef.current?.contains(e.target)
      if (!inside) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const scopeWord = tx(t, 'shell.scope', 'Scope')
  const caption = tx(
    t,
    'shell.scopeCaption',
    'Controls which countries this report aggregates. Each country reports in its own currency; figures are never added across currencies.',
  )

  function apply(countries) {
    // Never write a country the user may not aggregate over, and never write the
    // ALL sentinel for a single-country user (scopeLabel would read "All
    // countries" over one country, which overstates the coverage).
    const resolved = scopeCountries(countries, allowed)
    const next = allowed.length > 1 && resolved.length === allowed.length
      ? { countries: [SCOPE_ALL] }
      : { countries: resolved }
    setReportingScope?.(next)
    onChange?.(resolved)
  }

  function toggleCountry(country) {
    const on = selected.includes(country)
    // Emptying the list entirely would report on nothing, so the last remaining
    // country cannot be switched off; deselecting it is a no-op.
    if (on && selected.length === 1) return
    apply(on ? selected.filter((c) => c !== country) : [...selected, country])
  }

  const allSelected = allowed.length > 0 && selected.length === allowed.length

  /* ── Nothing to aggregate over ─────────────────────────────────────────── */
  if (allowed.length === 0) {
    return (
      <div className={`flex items-center gap-2 text-[12px] ${className}`} style={{ color: 'var(--text-muted)' }}>
        <BarChart3 size={13} aria-hidden="true" className="flex-shrink-0" />
        <span>{tx(t, 'shell.scopeNone', 'No countries are available to report on.')}</span>
      </div>
    )
  }

  /* ── One country: a static label, because there is no choice to make ───── */
  if (allowed.length === 1) {
    return (
      <div className={`min-w-0 ${className}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <BarChart3 size={13} aria-hidden="true" className="flex-shrink-0" style={{ color: 'var(--text-dim)' }} />
          <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{scopeWord}:</span>
          <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
            {allowed[0]}
          </span>
        </div>
        {showCaption && (
          <p className="text-[10.5px] mt-1" style={{ color: 'var(--text-dim)' }}>{caption}</p>
        )}
      </div>
    )
  }

  return (
    <div className={`min-w-0 ${className}`} ref={rootRef}>
      <div className="flex items-center gap-1.5 min-w-0">
        <BarChart3 size={13} aria-hidden="true" className="flex-shrink-0" style={{ color: 'var(--text-dim)' }} />
        <span className="text-[12px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{scopeWord}:</span>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${scopeWord}: ${label}. ${tx(t, 'shell.changeScope', 'Change reporting scope')}`}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-lg text-[12px] font-semibold min-w-0 transition-colors hover:bg-[var(--input-bg)]"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
          }}
        >
          <span className="truncate">{label}</span>
          <ChevronDown
            size={12}
            aria-hidden="true"
            className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {showCaption && (
        <p className="text-[10.5px] mt-1" style={{ color: 'var(--text-dim)' }}>{caption}</p>
      )}

      {open && coords && createPortal(
        <div
          ref={popRef}
          role="menu"
          aria-label={tx(t, 'shell.reportingScope', 'Reporting scope')}
          className="tp-popover w-[248px] p-1.5"
          style={{ top: coords.top, left: coords.left, maxHeight: coords.maxHeight }}
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={allSelected}
            onClick={() => apply([SCOPE_ALL])}
            className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--input-bg)]"
            style={allSelected ? { background: 'rgba(22,163,74,0.1)' } : undefined}
          >
            <Globe
              size={13}
              aria-hidden="true"
              className="flex-shrink-0"
              style={{ color: allSelected ? '#16a34a' : 'var(--text-dim)' }}
            />
            <span
              className="flex-1 text-[12px] font-bold truncate"
              style={{ color: allSelected ? '#16a34a' : 'var(--text-secondary)' }}
            >
              {tx(t, 'shell.allCountries', 'All countries')}
            </span>
            {allSelected && <Check size={13} aria-hidden="true" style={{ color: '#16a34a' }} />}
          </button>

          <div className="my-1 h-px" style={{ background: 'var(--border-dim)' }} />

          {allowed.map((country) => {
            const on = selected.includes(country)
            const isLastOn = on && selected.length === 1
            return (
              <button
                key={country}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                disabled={isLastOn}
                title={isLastOn
                  ? tx(t, 'shell.scopeKeepOne', 'At least one country must stay selected.')
                  : undefined}
                onClick={() => toggleCountry(country)}
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--input-bg)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span
                  aria-hidden="true"
                  className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
                  style={{
                    background: on ? '#16a34a' : 'transparent',
                    border: `1px solid ${on ? '#16a34a' : 'var(--input-border)'}`,
                  }}
                >
                  {on && <Check size={10} style={{ color: '#fff' }} />}
                </span>
                <span
                  className="flex-1 text-[12px] font-medium truncate"
                  style={{ color: on ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                >
                  {country}
                </span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
