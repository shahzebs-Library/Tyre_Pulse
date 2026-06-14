/**
 * Single source of truth for tyre-condition presentation.
 * Matches the web app's condition set: Good / Worn / Damaged / Puncture / Flat / Missing
 */

import { TyreCondition } from './types'

export interface ConditionMeta {
  icon: string        // Ionicons glyph
  emoji: string       // Visual emoji (matches web ✅⚠️❌🔴)
  color: string       // Brand colour
  tint: string        // Soft background tint
  borderColor: string // Active border
  i18nKey: string     // i18n label key
}

export const CONDITION_META: Record<TyreCondition, ConditionMeta> = {
  Good: {
    icon:        'checkmark-circle',
    emoji:       '✅',
    color:       '#16a34a',
    tint:        'rgba(22,163,74,0.10)',
    borderColor: '#22c55e',
    i18nKey:     'tyre.good',
  },
  Worn: {
    icon:        'alert-circle',
    emoji:       '⚠️',
    color:       '#d97706',
    tint:        'rgba(245,158,11,0.10)',
    borderColor: '#f59e0b',
    i18nKey:     'tyre.worn',
  },
  Damaged: {
    icon:        'close-circle',
    emoji:       '❌',
    color:       '#ef4444',
    tint:        'rgba(239,68,68,0.10)',
    borderColor: '#ef4444',
    i18nKey:     'tyre.damaged',
  },
  Puncture: {
    icon:        'radio-button-on',
    emoji:       '🔴',
    color:       '#dc2626',
    tint:        'rgba(220,38,38,0.10)',
    borderColor: '#dc2626',
    i18nKey:     'tyre.puncture',
  },
  Flat: {
    icon:        'remove-circle',
    emoji:       '🟠',
    color:       '#ea580c',
    tint:        'rgba(234,88,12,0.10)',
    borderColor: '#f97316',
    i18nKey:     'tyre.flat',
  },
  Missing: {
    icon:        'help-circle',
    emoji:       '⬜',
    color:       '#6b7280',
    tint:        'rgba(107,114,128,0.10)',
    borderColor: '#9ca3af',
    i18nKey:     'tyre.missing',
  },
}

/** Ordered conditions for the picker — most common first */
export const CONDITIONS: TyreCondition[] = ['Good', 'Worn', 'Damaged', 'Puncture', 'Flat', 'Missing']

/** Map DB/legacy condition strings → canonical TyreCondition */
export function normaliseCondition(raw: string | null | undefined): TyreCondition {
  switch ((raw ?? '').toLowerCase()) {
    case 'good':     return 'Good'
    case 'worn':
    case 'wear':     return 'Worn'
    case 'damaged':
    case 'damage':   return 'Damaged'
    case 'puncture': return 'Puncture'
    case 'flat':     return 'Flat'
    case 'missing':  return 'Missing'
    default:         return 'Good'
  }
}

export const SHOW_TREAD_DEPTH = false
