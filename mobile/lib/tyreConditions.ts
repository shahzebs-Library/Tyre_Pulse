/**
 * Single source of truth for tyre-condition presentation.
 *
 * Each condition maps to a distinct, intuitive icon + colour so the state is
 * readable at a glance everywhere it appears: the vehicle diagram, the position
 * list, the detail popup and the condition picker.
 */

import { TyreCondition } from './types'

export interface ConditionMeta {
  /** Ionicons glyph name */
  icon: string
  /** Solid brand colour for the condition */
  color: string
  /** Soft background tint (color @ ~12% alpha) */
  tint: string
  /** i18n key for the human label */
  i18nKey: string
}

export const CONDITION_META: Record<TyreCondition, ConditionMeta> = {
  Good:    { icon: 'checkmark-circle', color: '#16a34a', tint: 'rgba(22,163,74,0.12)',  i18nKey: 'tyre.good' },
  Worn:    { icon: 'alert-circle',     color: '#f59e0b', tint: 'rgba(245,158,11,0.12)', i18nKey: 'tyre.worn' },
  Damaged: { icon: 'warning',          color: '#ef4444', tint: 'rgba(239,68,68,0.12)',  i18nKey: 'tyre.damaged' },
  Flat:    { icon: 'close-circle',     color: '#dc2626', tint: 'rgba(220,38,38,0.12)',  i18nKey: 'tyre.flat' },
  Missing: { icon: 'help-circle',      color: '#6b7280', tint: 'rgba(107,114,128,0.12)', i18nKey: 'tyre.missing' },
}

/** Ordered list for pickers. */
export const CONDITIONS: TyreCondition[] = ['Good', 'Worn', 'Damaged', 'Flat', 'Missing']

/**
 * Tread-depth capture is temporarily disabled in the field workflow. Flip to
 * `true` to restore the input and its summary chip everywhere at once — the
 * underlying data model (`tread_depth_mm`) is left intact.
 */
export const SHOW_TREAD_DEPTH = false
