// First-visit brand intro (owner-approved, 6 s). An overlay on the login page:
// the login form is already mounted underneath, so the intro never delays
// sign-in. Shown once per browser (localStorage flag), never to a signed-in
// user; the parent decides the route. Skip button (first in tab order, so
// focus is not stolen from the login field) and Escape dismiss it;
// prefers-reduced-motion shows the finished logo for about a second instead.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../../contexts/LanguageContext'
import './brandIntro.css'

export const INTRO_SEEN_KEY = 'tp_intro_seen_v1'
export const INTRO_DURATION_MS = 6000
const FADE_MS = 450
const REDUCED_HOLD_MS = 1000

export function hasSeenIntro() {
  try { return window.localStorage.getItem(INTRO_SEEN_KEY) === '1' } catch { return true }
}

function markIntroSeen() {
  try { window.localStorage.setItem(INTRO_SEEN_KEY, '1') } catch { /* private mode: show again next time */ }
}

function prefersReducedMotion() {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches } catch { return false }
}

const clamp = (x) => Math.max(0, Math.min(1, x))
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3)

// Same blocks and bowl as the approved TP mark.
const BLOCKS = [
  [0, 0, 13], [18, 0, 13], [36, 0, 13],
  [18, 17, 16], [36, 17, 16],
  [18, 37, 16], [36, 37, 16],
  [18, 57, 13], [36, 57, 13],
]
const BOWL = 'M54.0,1.6 A1.6,1.6 0 0 1 55.6,0 H60.0 A16.5,16.5 0 0 1 60.0,33.0 H55.6 A1.6,1.6 0 0 1 54.0,31.4 V22.1 A1.6,1.6 0 0 1 55.6,20.5 H60.0 A4.0,4.0 0 0 0 60.0,12.5 H55.6 A1.6,1.6 0 0 1 54.0,10.9 Z'
const PULSE = 'M0 60 H300 L330 60 L355 10 L385 110 L410 30 L430 60 H800'
const PULSE_LEN = 1300 // dash length longer than the path, so it starts hidden

export default function BrandIntro({ enabled = true }) {
  const { t, isRTL } = useLanguage()
  const [visible, setVisible] = useState(() => enabled && !hasSeenIntro())
  const [leaving, setLeaving] = useState(false)
  const refs = useRef({ blocks: [] })
  const timers = useRef([])

  const render = useCallback((tSec) => {
    const r = refs.current
    r.blocks.forEach((b, k) => {
      if (!b) return
      const p = ease((tSec - (0.15 + k * 0.11)) / 0.35)
      b.style.opacity = p
      b.setAttribute('transform', `translate(0 ${(-14 * (1 - p)).toFixed(2)})`)
    })
    if (r.bowl) {
      const pb = ease((tSec - 1.25) / 0.5)
      r.bowl.style.opacity = pb
      r.bowl.setAttribute('transform', `rotate(${(-90 * (1 - pb)).toFixed(1)} 60 16.5)`)
    }
    if (r.word) {
      const pw = ease((tSec - 1.9) / 0.6)
      r.word.style.opacity = pw
      r.word.style.transform = `translateY(${(0.6 * (1 - pw)).toFixed(3)}em)`
    }
    if (r.pulse) r.pulse.style.strokeDashoffset = PULSE_LEN * (1 - clamp((tSec - 2.4) / 0.9))
    if (r.tag) r.tag.style.opacity = ease((tSec - 3.1) / 0.6)
    if (r.mark) {
      const beat = tSec > 3.6 && tSec < 4.8 ? 1 + 0.035 * Math.max(0, Math.sin((tSec - 3.6) * Math.PI / 0.6)) : 1
      r.mark.style.transform = `scale(${beat})`
    }
    if (r.bar) r.bar.style.width = `${clamp(tSec / 6) * 100}%`
  }, [])

  const close = useCallback(() => {
    setLeaving(true)
    timers.current.push(setTimeout(() => setVisible(false), FADE_MS))
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    markIntroSeen()

    let raf = 0
    const reduced = prefersReducedMotion()
    if (reduced) {
      render(4.8)
      if (refs.current.bar) refs.current.bar.style.width = '100%'
      timers.current.push(setTimeout(close, REDUCED_HOLD_MS))
    } else {
      const start = performance.now()
      render(0)
      const tick = (now) => {
        const s = (now - start) / 1000
        render(Math.min(s, 6))
        if (s < 6) raf = requestAnimationFrame(tick)
      }
      if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick)
      timers.current.push(setTimeout(close, INTRO_DURATION_MS - FADE_MS))
    }

    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    const pending = timers.current
    return () => {
      window.removeEventListener('keydown', onKey)
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
      pending.forEach(clearTimeout)
    }
  }, [visible, render, close])

  if (!visible) return null

  return (
    <div
      className={`tp-intro${leaving ? ' tp-intro--leaving' : ''}`}
      role="dialog"
      aria-label={t('common.intro.label')}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="brand-intro"
    >
      <button
        type="button"
        className="tp-intro__skip"
        onClick={close}
        aria-label={t('common.intro.skipLabel')}
      >
        {t('common.intro.skip')}
      </button>

      <div className="tp-intro__stage" aria-hidden="true">
        <svg
          ref={(el) => { refs.current.mark = el }}
          className="tp-intro__mark"
          viewBox="-4 -4 92 80"
        >
          <g transform="translate(11.0869 0) skewX(-9)">
            {BLOCKS.map(([x, y, h], i) => (
              <rect
                key={i}
                ref={(el) => { refs.current.blocks[i] = el }}
                className="tp-intro__blk"
                x={x} y={y} width="14" height={h} rx="1.6"
                style={{ opacity: 0 }}
              />
            ))}
            <path
              ref={(el) => { refs.current.bowl = el }}
              className="tp-intro__blk"
              d={BOWL}
              style={{ opacity: 0 }}
            />
          </g>
        </svg>

        <div ref={(el) => { refs.current.word = el }} className="tp-intro__word" dir="ltr" translate="no" style={{ opacity: 0 }}>
          <span className="tp-intro__word-a">TYRE </span>
          <span className="tp-intro__word-b">PULSE</span>
        </div>

        <svg className="tp-intro__pulse" viewBox="0 0 800 120" dir="ltr">
          <path
            ref={(el) => { refs.current.pulse = el }}
            d={PULSE}
            fill="none"
            stroke="#FFC629"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ strokeDasharray: PULSE_LEN, strokeDashoffset: PULSE_LEN }}
          />
        </svg>

        <div ref={(el) => { refs.current.tag = el }} className="tp-intro__tags" style={{ opacity: 0 }}>
          <div className="tp-intro__tag">{t('common.intro.tagline')}</div>
          <div className="tp-intro__tag2">{t('common.intro.secondary')}</div>
        </div>
      </div>

      <div className="tp-intro__bar" aria-hidden="true">
        <i ref={(el) => { refs.current.bar = el }} />
      </div>
    </div>
  )
}
