import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { vibrate } from '../../hooks/useWakeLock'
import { CHECKLIST_LABELS } from './checklistLabels'
import TyreConditionGlyph from '../tyre/TyreConditionGlyph'
import { conditionKind, CONDITION_KIND, kindHex, currentTheme } from '../../lib/tyreLayoutSpec'

/**
 * Bottom sheet for recording ONE wheel on the daily checklist: condition and
 * pressure, then Next. Built for a phone held in one hand at the vehicle, so
 * every control is a large target and the sheet stays open while the inspector
 * walks round the wheels.
 *
 * Moved out of Inspections.jsx unchanged in behaviour. Neutral surfaces now use
 * theme tokens so the sheet reads in dark mode as well as light; the condition
 * colours stay semantic, and each carries an icon and its word, so colour is
 * never the only signal.
 */
// The words the web form stores (unchanged vocabulary, plus Flat and Missing,
// which the field app already records, so web and phone offer the same six). Colour, picture and label come from the shared
// tyre map (conditions.kinds), so a tyre man who cannot read still knows each
// button: green tick, amber worn tread, red nail, red flat tyre, red warning.
const CONDITIONS = ['Good', 'Wear', 'Damage', 'Puncture', 'Flat', 'Missing']

export default function PositionSheet({ pos, posIdx, total, isLast, unfilledCount, allFilled, lang, onUpdate, onNext, onPrev, onClose }) {
  const { t } = useLanguage()
  const L = CHECKLIST_LABELS[lang] || CHECKLIST_LABELS.en
  const isPuncture = pos.condition === 'Puncture'
  const pressureRef = useRef(null)
  const titleId = `pos-sheet-${pos.position}`

  // Escape closes the sheet, the same as tapping the scrim.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleConditionSelect(cond) {
    onUpdate('condition', cond)
    if (cond === 'Puncture' || cond === 'Damage' || cond === 'Flat') vibrate([100, 50, 100, 50, 200]) // double buzz for critical
    else vibrate(40) // light tap for good/wear
  }

  const nextLabel = isLast
    ? allFilled ? t('inspections.position.allDone') : t('inspections.position.fillMore', { count: unfilledCount })
    : t('inspections.position.next')
  const nextBg = isLast && allFilled ? '#166534' : '#16a34a'

  return (
    <div className="fixed inset-0 z-50" style={{ touchAction: 'none' }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose} aria-hidden />
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl mx-auto max-w-xl"
        style={{
          background: 'var(--surface-1)',
          borderTop: '1px solid var(--border-subtle)',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex justify-center pt-3 pb-1" aria-hidden>
          <div className="w-10 h-1.5 rounded-full" style={{ background: 'var(--border-bright)' }} />
        </div>

        <div className="px-5 pt-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span
                id={titleId}
                className="text-base font-mono font-bold px-3 py-1.5 rounded-xl"
                style={{
                  background: isPuncture ? '#fef2f2' : '#f0fdf4',
                  color: isPuncture ? '#991b1b' : '#166534',
                  border: `1.5px solid ${isPuncture ? '#fca5a5' : '#86efac'}`,
                }}
              >
                {pos.label || pos.position}
              </span>
              <span className="text-sm font-medium text-[var(--text-muted)]">
                {posIdx + 1} / {total}
                {unfilledCount > 0 && <span className="ml-2 text-xs" style={{ color: '#d97706' }}>{t('inspections.position.unfilled', { count: unfilledCount })}</span>}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('inspections.formExtra.closePosition')}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-secondary)]"
            >
              <X size={16} />
            </button>
          </div>

          {isPuncture && (
            <div role="alert" className="mb-3 px-3 py-2.5 rounded-xl flex items-center gap-2 text-sm font-semibold"
              style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', color: '#991b1b' }}>
              {t('inspections.position.punctureAlert')}
            </div>
          )}

          <p className="text-[11px] font-bold uppercase tracking-widest mb-2.5 text-[var(--text-muted)]" id={`${titleId}-cond`}>
            {L.condition}
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4" role="group" aria-labelledby={`${titleId}-cond`}>
            {CONDITIONS.map((cond) => {
              const on = pos.condition === cond
              const kind = conditionKind(cond)
              // Selected: filled with the deep (light palette) colour and white
              // ink, at least 4.5:1 in both themes. Not selected: the card
              // surface with the coloured picture and a coloured border.
              const deep = kindHex(kind, 'light')
              const band = kindHex(kind, currentTheme())
              const label = t(`common.tyreCondition.${kind}`) || CONDITION_KIND[kind]?.label || cond
              return (
                <button
                  key={cond}
                  type="button"
                  aria-pressed={on}
                  aria-label={label}
                  data-kind={kind}
                  onClick={() => handleConditionSelect(cond)}
                  className="py-2.5 min-h-[72px] rounded-2xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
                  style={{
                    background: on ? deep : 'var(--surface-2)',
                    border: `${on ? 3 : 2}px solid ${on ? 'var(--text-primary)' : band}`,
                    color: on ? '#ffffff' : 'var(--text-primary)',
                    boxShadow: on ? '0 4px 12px rgba(0,0,0,0.25)' : 'none',
                  }}
                >
                  <TyreConditionGlyph kind={kind} size={30} color={on ? '#ffffff' : band} strokeWidth={2.6} />
                  <span className="text-xs font-extrabold">{label}</span>
                </button>
              )
            })}
          </div>

          <div className="mb-5">
            <label htmlFor={`${titleId}-psi`} className="text-[11px] font-bold uppercase tracking-widest mb-2 block text-[var(--text-muted)]">
              {L.pressure}
            </label>
            <input
              id={`${titleId}-psi`}
              ref={pressureRef}
              type="number"
              inputMode="numeric"
              min="0"
              placeholder="PSI"
              value={pos.pressure}
              onChange={(e) => onUpdate('pressure', e.target.value)}
              className="input w-full px-3 py-3 rounded-xl text-base font-semibold"
            />
          </div>

          <div className="flex gap-2.5">
            {posIdx > 0 && (
              <button
                type="button"
                onClick={onPrev}
                className="flex-1 py-3 min-h-[48px] rounded-2xl text-sm font-bold bg-[var(--surface-2)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
              >
                {t('inspections.position.prev')}
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              className="flex-[2] py-3 min-h-[48px] rounded-2xl text-sm font-bold text-white"
              style={{ background: nextBg }}
            >
              {nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
