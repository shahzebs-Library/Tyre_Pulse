/**
 * Login Scene State (Zustand)
 * ───────────────────────────
 * Single source of truth for the 3D login experience. The UI layer only ever
 * mutates `phase`; every motion in the scene is derived from it. Nothing in the
 * 3D layer animates "randomly" — it reads state from here.
 *
 * Phases (see CLAUDE.md → 3D Login UI Engine):
 *   idle                    slow float + rotation
 *   typing                  micro vibration
 *   loading                 forward motion begins, slight camera follow
 *   success                 accelerate forward, camera chase, brightness up
 *   error                   shake, stop
 *   transition_to_dashboard accelerate + camera zoom-through, fade to dashboard
 */
import { create } from 'zustand'

export const PHASES = Object.freeze({
  IDLE: 'idle',
  TYPING: 'typing',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
  TRANSITION: 'transition_to_dashboard',
})

const TYPING_DECAY_MS = 900

export const useLoginScene = create((set, get) => ({
  /** Current MCU phase. */
  phase: PHASES.IDLE,

  /** Quality tier — downgraded automatically on low-end devices / low FPS. */
  quality: 'high', // 'high' | 'low' | 'off'

  /** Whether the user prefers reduced motion (a11y). */
  reducedMotion:
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,

  /** Measured FPS (rolling), surfaced for the adaptive-quality governor. */
  fps: 60,

  _typingTimer: null,

  setPhase(phase) {
    if (get().phase === phase) return
    set({ phase })
  },

  /**
   * Call on each keystroke. Pulses the truck into a brief `typing` micro-state
   * that auto-decays back to idle, so holding a key feels alive but releasing
   * settles. Never overrides terminal phases (loading/success/error/transition).
   */
  pokeTyping() {
    const { phase, _typingTimer } = get()
    if (
      phase === PHASES.LOADING ||
      phase === PHASES.SUCCESS ||
      phase === PHASES.TRANSITION
    )
      return

    if (_typingTimer) clearTimeout(_typingTimer)
    const timer = setTimeout(() => {
      // Only relax to idle if we are still in a typing/error transient.
      const p = get().phase
      if (p === PHASES.TYPING || p === PHASES.ERROR) set({ phase: PHASES.IDLE })
      set({ _typingTimer: null })
    }, TYPING_DECAY_MS)

    set({ phase: PHASES.TYPING, _typingTimer: timer })
  },

  setQuality(quality) {
    if (get().quality !== quality) set({ quality })
  },

  reportFps(fps) {
    set({ fps })
  },

  reset() {
    const { _typingTimer } = get()
    if (_typingTimer) clearTimeout(_typingTimer)
    set({ phase: PHASES.IDLE, _typingTimer: null })
  },
}))
