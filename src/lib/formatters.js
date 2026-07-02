/**
 * Shared formatting utilities for currency, dates, and numbers.
 * Always import these instead of per-file implementations.
 */

// ── Country → date locale map ──────────────────────────────────────────────
const COUNTRY_DATE_LOCALE = {
  KSA:   'en-SA',
  UAE:   'en-AE',
  Egypt: 'en-EG',
  All:   'en-US',
}

/**
 * Format a date string or Date object.
 * @param {string|Date} d
 * @param {string} country - from SettingsContext activeCountry
 * @param {Intl.DateTimeFormatOptions} [opts]
 */
export function formatDate(d, country = 'All', opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!d) return '-'
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return '-'
  const locale = COUNTRY_DATE_LOCALE[country] ?? 'en-US'
  return date.toLocaleDateString(locale, opts)
}

/**
 * Format a date to month+year only (e.g. "Jun 26").
 */
export function formatMonthYear(d, country = 'All') {
  return formatDate(d, country, { month: 'short', year: '2-digit' })
}

/**
 * Format a date to short month only (e.g. "Jun").
 */
export function formatMonth(d, country = 'All') {
  return formatDate(d, country, { month: 'short' })
}

/**
 * Format a datetime string (includes time).
 */
export function formatDateTime(d, country = 'All') {
  if (!d) return '-'
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return '-'
  const locale = COUNTRY_DATE_LOCALE[country] ?? 'en-US'
  return date.toLocaleString(locale, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// ── Currency formatting ────────────────────────────────────────────────────

/**
 * Format a number as currency.
 * @param {number|string} v
 * @param {string} currency - ISO 4217 code (SAR, AED, EGP)
 * @param {number} [decimals=2]
 */
export function formatCurrency(v, currency = 'SAR', decimals = 2) {
  const n = parseFloat(v)
  if (isNaN(n)) return '-'
  return `${currency} ${n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

/**
 * Format a number as compact currency (e.g. "SAR 1.2k", "SAR 3.4M").
 */
export function formatCurrencyCompact(v, currency = 'SAR') {
  const n = parseFloat(v)
  if (isNaN(n)) return '-'
  if (Math.abs(n) >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000)     return `${currency} ${(n / 1_000).toFixed(1)}k`
  return `${currency} ${n.toFixed(0)}`
}

/**
 * Format a number in thousands (e.g. "SAR 1.2k").
 */
export function formatCurrencyK(v, currency = 'SAR') {
  const n = parseFloat(v)
  if (isNaN(n)) return '-'
  return `${currency} ${(n / 1_000).toFixed(1)}k`
}

// ── Number utilities ───────────────────────────────────────────────────────

/**
 * Format a number with fixed decimals, returning '-' for invalid input.
 */
export function fmt(v, decimals = 2) {
  const n = parseFloat(v)
  if (isNaN(n)) return '-'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format kilometers (e.g. "120k km").
 */
export function formatKm(v) {
  const n = parseFloat(v)
  if (isNaN(n) || n === 0) return '-'
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k km`
  return `${n.toFixed(0)} km`
}

// ── Risk badge styles ──────────────────────────────────────────────────────

/**
 * Risk badge Tailwind classes for LIGHT backgrounds (white/off-white pages).
 * All combinations pass WCAG AA (≥4.5:1).
 */
export const RISK_BADGE_LIGHT = {
  Critical: 'bg-red-100 text-red-700 border border-red-200',
  High:     'bg-orange-100 text-orange-700 border border-orange-200',
  Medium:   'bg-amber-100 text-amber-700 border border-amber-200',
  Low:      'bg-green-100 text-green-700 border border-green-200',
}

/**
 * Risk badge Tailwind classes for DARK backgrounds (dark-card pages).
 * All combinations pass WCAG AA on dark surfaces.
 */
export const RISK_BADGE_DARK = {
  Critical: 'bg-red-900/50 text-red-300 border border-red-700/40',
  High:     'bg-orange-900/50 text-orange-300 border border-orange-700/40',
  Medium:   'bg-yellow-900/50 text-yellow-300 border border-yellow-700/40',
  Low:      'bg-green-900/50 text-green-300 border border-green-700/40',
}
