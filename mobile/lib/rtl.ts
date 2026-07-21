/**
 * lib/rtl.ts - small, pure RTL layout helpers.
 * ----------------------------------------------------------------------------
 * This app uses NATIVE RTL: LanguageContext calls `I18nManager.forceRTL(true)`
 * for Arabic/Urdu and reloads. Under native RTL, Yoga AUTOMATICALLY mirrors
 * `flexDirection: 'row'` and physical edges (left/right, marginLeft/Right,
 * paddingLeft/Right). So the reliable, low-regression fix is:
 *
 *   1. Use LOGICAL edges (marginStart/End, paddingStart/End, borderStart/End)
 *      instead of Left/Right. These are unambiguous and are a no-op in LTR
 *      (start == left), so they cannot regress the English layout.
 *   2. Use `textStart` / `textEnd` for text you must pin to the reading edge,
 *      because `textAlign: 'left'` does NOT auto-flip under RTL (only the
 *      default, unset alignment follows the writing direction).
 *
 * All helpers are PURE: pass the current `isRTL` (from `useLanguage()`), or read
 * the layout truth from `I18nManager.isRTL` (see `getIsRTL`).
 */
import { I18nManager } from 'react-native'
import type { TextStyle, ViewStyle } from 'react-native'

type FlexDirection = NonNullable<ViewStyle['flexDirection']>
type TextAlign = NonNullable<TextStyle['textAlign']>

/**
 * The layout direction the native runtime is actually using. Prefer the
 * `useLanguage().isRTL` flag inside components; this is for non-React code.
 */
export function getIsRTL(): boolean {
  return I18nManager.isRTL
}

/**
 * Row direction for MANUAL mirroring.
 *
 * NOTE: under native RTL (this app), Yoga already mirrors `flexDirection: 'row'`,
 * so you normally do NOT need this - a plain `row` visually reverses on its own,
 * and forcing `row-reverse` here would DOUBLE-flip it. Use this only for a row
 * you are laying out deterministically without relying on native auto-mirroring.
 */
export function rtlRow(isRTL: boolean): FlexDirection {
  return isRTL ? 'row-reverse' : 'row'
}

/** Align text to the reading START edge (left in LTR, right in RTL). */
export function textStart(isRTL: boolean): TextAlign {
  return isRTL ? 'right' : 'left'
}

/** Align text to the reading END edge (right in LTR, left in RTL). */
export function textEnd(isRTL: boolean): TextAlign {
  return isRTL ? 'left' : 'right'
}

/**
 * Logical horizontal margins. Maps a start/end intent onto marginStart/End so
 * spacing follows the reading direction. Omit an edge to leave it unset.
 *   marginX({ start: 8 })  ->  { marginStart: 8 }
 */
export function marginX(
  { start, end }: { start?: number; end?: number },
): Pick<ViewStyle, 'marginStart' | 'marginEnd'> {
  return {
    ...(start != null ? { marginStart: start } : null),
    ...(end != null ? { marginEnd: end } : null),
  }
}

/** Logical horizontal padding (start/end -> paddingStart/paddingEnd). */
export function paddingX(
  { start, end }: { start?: number; end?: number },
): Pick<ViewStyle, 'paddingStart' | 'paddingEnd'> {
  return {
    ...(start != null ? { paddingStart: start } : null),
    ...(end != null ? { paddingEnd: end } : null),
  }
}
