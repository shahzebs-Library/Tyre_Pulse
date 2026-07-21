/**
 * lib/format.ts - locale-aware, defensive formatting helpers.
 * ----------------------------------------------------------------------------
 * Pure functions built on the platform Intl API (Hermes on RN 0.81 ships Intl).
 * Every helper is DEFENSIVE: it never throws. If Intl is unavailable or a value
 * is malformed, it falls back to a plain, readable string.
 *
 * DIGIT CHOICE (important, matches existing app behaviour):
 *   The app currently renders WESTERN (Latin) digits everywhere, including under
 *   Arabic. To avoid surprising field users, we force `numberingSystem: 'latn'`
 *   for every locale. This keeps western digits (20, 2026) while still localising
 *   the surrounding text (e.g. Arabic month names, locale-correct separators and
 *   currency placement). Do not remove `numberingSystem: 'latn'` unless the whole
 *   app is intentionally moving to Arabic-Indic digits.
 *
 * `language` is the LanguageContext language ('en' | 'ar' | 'ur'); screens pass
 * it from `useLanguage()`. Anything else falls back to English.
 */

/** LanguageContext language codes mapped to BCP-47 locale tags. */
const LOCALE_TAG: Record<string, string> = {
  en: 'en-US',
  ar: 'ar',
  ur: 'ur',
}

/** Resolve a LanguageContext code (or anything) to a safe BCP-47 tag. */
function localeTag(language?: string): string {
  if (!language) return 'en-US'
  return LOCALE_TAG[language] ?? 'en-US'
}

/** Keep western digits for every locale (see DIGIT CHOICE above). */
const LATN = { numberingSystem: 'latn' } as const

/** Coerce Date | string | number into a valid Date, or null. */
function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input == null) return null
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Coerce to a finite number, or null. */
function toNumber(input: number | string | null | undefined): number | null {
  if (input == null || input === '') return null
  const n = typeof input === 'number' ? input : Number(input)
  return Number.isFinite(n) ? n : null
}

/**
 * Locale date, medium style: "20 Jul 2026" (en) / "٢٠ يوليو ٢٠٢٦"-with-latn-digits (ar).
 * Falls back to ISO date (YYYY-MM-DD) if Intl fails; '' for an invalid input.
 */
export function formatDate(
  input: Date | string | number | null | undefined,
  language?: string,
): string {
  const date = toDate(input)
  if (!date) return ''
  try {
    return new Intl.DateTimeFormat(localeTag(language), {
      year: 'numeric', month: 'short', day: 'numeric', ...LATN,
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/**
 * Locale date + time: "20 Jul 2026, 14:30".
 * Falls back to ISO (no milliseconds) if Intl fails; '' for an invalid input.
 */
export function formatDateTime(
  input: Date | string | number | null | undefined,
  language?: string,
): string {
  const date = toDate(input)
  if (!date) return ''
  try {
    return new Intl.DateTimeFormat(localeTag(language), {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', ...LATN,
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ')
  }
}

/**
 * Locale number with grouping separators, western digits.
 * "1,234.5" (en). Falls back to String(value); '' for null/NaN.
 */
export function formatNumber(
  value: number | string | null | undefined,
  language?: string,
  options?: Intl.NumberFormatOptions,
): string {
  const n = toNumber(value)
  if (n == null) return ''
  try {
    return new Intl.NumberFormat(localeTag(language), {
      maximumFractionDigits: 3, ...LATN, ...options,
    }).format(n)
  } catch {
    return String(n)
  }
}

/**
 * Locale currency: "$1,234.50" / "SAR 1,234.50", western digits.
 * Falls back to "<currency> <number>" if Intl fails; '' for null/NaN.
 */
export function formatCurrency(
  value: number | string | null | undefined,
  currency: string | null | undefined,
  language?: string,
): string {
  const n = toNumber(value)
  if (n == null) return ''
  const code = (currency || 'USD').toUpperCase()
  try {
    return new Intl.NumberFormat(localeTag(language), {
      style: 'currency', currency: code, ...LATN,
    }).format(n)
  } catch {
    const plain = formatNumber(n, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return `${code} ${plain}`.trim()
  }
}
