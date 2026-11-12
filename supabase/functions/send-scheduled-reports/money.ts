// money.ts - currency-safe money helpers for the scheduled report e-mails.
//
// WHY THIS FILE EXISTS (MODC-05)
//   The executive digest used ONE global currency label (system_config
//   default_currency) for every figure, and the server aggregate summed
//   tyre_records.cost_per_tyre across every country of the organisation. A
//   company working in SAR, AED and EGP therefore received one number that was
//   three currencies added together, labelled SAR, from a different source than
//   the Expenses screen (which reads the expense grid, parts_consumption).
//
// THE RULES ENCODED HERE
//   1. Money is always carried WITH its currency. There is no helper in this
//      file that adds two different currencies together.
//   2. A single total is produced only when every amount in scope is in the
//      same currency. Otherwise the caller gets one line per currency.
//   3. A country with no known currency is shown without a currency code and is
//      never merged into another currency.
//   4. Pure functions only (no Deno, no network) so the web test suite can
//      import this module directly.
//
// This file must stay free of backslash-u escape sequences and of dash
// punctuation in output strings (report output rule).

export type CurrencyMap = Record<string, string>

export type MoneyPart = { currency: string; amount: number }

export type TrendPoint = { label: string; value: number; count: number }
export type RankItem = { label: string; value: number; count?: number }

/** One country's money block. Every amount is in `currency` and nothing else. */
export type CountryMoney = {
  country: string
  currency: string
  tyre_spend_all: number | null
  tyre_spend_cur: number | null
  tyre_spend_prev: number | null
  tyre_spend_12m: number | null
  expense_lines: number | null
  first_date: string | null
  last_date: string | null
  wo_cost: number | null
  accident_cost: number | null
  monthly_budget: number | null
  monthly_trend: TrendPoint[]
  top_sites: RankItem[]
  top_assets: RankItem[]
}

/** Where the tyre spend figures came from. Printed in the e-mail. */
export type MoneyBasis = 'expense_grid' | 'tyre_records'

export type ExecMoney = {
  basis: MoneyBasis
  period_days: number
  win_from: string | null
  win_to: string | null
  countries: CountryMoney[]
}

const NO_COUNTRY = '(no country)'

function finite(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function text(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

/** Lookup key for a country name: trimmed and upper-cased. */
export function countryKey(country: unknown): string {
  return text(country).toUpperCase()
}

/** Build a lookup from rows of the country_currency table. */
export function buildCurrencyMap(rows: Array<{ country?: unknown; currency?: unknown }> | null | undefined): CurrencyMap {
  const map: CurrencyMap = {}
  for (const r of rows ?? []) {
    const k = countryKey(r?.country)
    const c = text(r?.currency).toUpperCase()
    if (k && c) map[k] = c
  }
  return map
}

/**
 * Currency for one row.
 *   known country           -> that country's currency
 *   blank country           -> `fallback` (the tenant default), or '' when the
 *                              caller passes no fallback
 *   country with no mapping -> '' (unknown; never guessed)
 */
export function currencyFor(country: unknown, map: CurrencyMap, fallback = ''): string {
  const k = countryKey(country)
  if (!k) return text(fallback).toUpperCase()
  return map[k] ?? ''
}

/** Format one amount with its own currency. Never invents a currency. */
export function fmtMoney(n: number | null | undefined, currency: string | null | undefined): string {
  const v = finite(n)
  if (v == null) return 'N/A'
  const s = v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  const c = text(currency)
  return c ? `${c} ${s}` : s
}

/**
 * Sum amounts PER CURRENCY. Amounts in different currencies are never added.
 * Zero and missing amounts are skipped. Sorted by currency code so the output
 * is stable.
 */
export function sumByCurrency(items: Array<{ currency: string; amount: number | null | undefined }>): MoneyPart[] {
  const acc = new Map<string, number>()
  for (const it of items ?? []) {
    const a = finite(it?.amount)
    if (a == null || a === 0) continue
    const c = text(it?.currency).toUpperCase()
    acc.set(c, (acc.get(c) ?? 0) + a)
  }
  return [...acc.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

/**
 * A single total, but ONLY when every part is in one currency. Returns null
 * when the parts span more than one currency (the caller must then show one
 * line per currency). An empty list is a real zero in no particular currency.
 */
export function singleCurrencyTotal(parts: MoneyPart[]): MoneyPart | null {
  if (!parts || parts.length === 0) return { currency: '', amount: 0 }
  if (parts.length > 1) return null
  return parts[0]
}

/** True when the parts cannot be added together. */
export function isMixedCurrency(parts: MoneyPart[]): boolean {
  return (parts?.length ?? 0) > 1
}

/**
 * Text for a money figure that may span currencies:
 *   one currency   -> "SAR 1,234"
 *   several        -> "SAR 1,234 | AED 56 | EGP 789"  (never one added number)
 *   none           -> `empty`
 */
export function fmtMoneyParts(parts: MoneyPart[], empty = 'N/A'): string {
  if (!parts || parts.length === 0) return empty
  return parts.map((p) => fmtMoney(p.amount, p.currency)).join(' | ')
}

/**
 * Sum one money column of raw table rows per currency, taking each row's
 * currency from its own country. When NO row carries a country the tenant is
 * treated as single-currency and `fallback` is used; when at least one row has
 * a country, rows without one are kept apart with no currency code.
 */
export function sumRowsByCurrency(
  rows: Array<Record<string, unknown>>,
  moneyCol: string,
  countryCol: string | null,
  map: CurrencyMap,
  fallback = '',
): MoneyPart[] {
  const anyCountry = !!countryCol && (rows ?? []).some((r) => countryKey(r?.[countryCol]))
  return sumByCurrency((rows ?? []).map((r) => ({
    currency: rowCurrency(r, countryCol, map, fallback, anyCountry),
    amount: finite(r?.[moneyCol]),
  })))
}

/** Currency of one raw row. See sumRowsByCurrency for the blank-country rule. */
export function rowCurrency(
  row: Record<string, unknown>,
  countryCol: string | null,
  map: CurrencyMap,
  fallback = '',
  anyCountryInSet = true,
): string {
  if (!countryCol) return text(fallback).toUpperCase()
  const k = countryKey(row?.[countryCol])
  if (!k) return anyCountryInSet ? '' : text(fallback).toUpperCase()
  return map[k] ?? ''
}

function trendPoints(v: unknown): TrendPoint[] {
  if (!Array.isArray(v)) return []
  return v
    .map((p) => ({ label: text(p?.label), value: finite(p?.value) ?? 0, count: finite(p?.count) ?? 0 }))
    .filter((p) => p.label)
}

function rankItems(v: unknown): RankItem[] {
  if (!Array.isArray(v)) return []
  return v
    .map((p) => ({ label: text(p?.label) || '(unknown)', value: finite(p?.value) ?? 0, count: finite(p?.count) ?? undefined }))
    .filter((p) => p.value !== 0)
}

/**
 * Clean the report_exec_money_by_country RPC result. Unknown shapes become an
 * empty country list rather than throwing, so a bad payload can never produce
 * a wrong number: it produces "no figures".
 */
export function normaliseExecMoney(raw: unknown): ExecMoney {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(r.countries) ? r.countries : []
  const countries: CountryMoney[] = list.map((c: Record<string, unknown>) => ({
    country: text(c?.country) || NO_COUNTRY,
    currency: text(c?.currency).toUpperCase(),
    tyre_spend_all: finite(c?.tyre_spend_all),
    tyre_spend_cur: finite(c?.tyre_spend_cur),
    tyre_spend_prev: finite(c?.tyre_spend_prev),
    tyre_spend_12m: finite(c?.tyre_spend_12m),
    expense_lines: finite(c?.expense_lines),
    first_date: text(c?.first_date) || null,
    last_date: text(c?.last_date) || null,
    wo_cost: finite(c?.wo_cost),
    accident_cost: finite(c?.accident_cost),
    monthly_budget: finite(c?.monthly_budget),
    monthly_trend: trendPoints(c?.monthly_trend),
    top_sites: rankItems(c?.top_sites),
    top_assets: rankItems(c?.top_assets),
  }))
  countries.sort((a, b) => a.country.localeCompare(b.country))
  return {
    basis: 'expense_grid',
    period_days: finite(r.period_days) ?? 30,
    win_from: text(r.win_from) || null,
    win_to: text(r.win_to) || null,
    countries,
  }
}

/**
 * Fallback used ONLY while the per-country aggregate RPC is not installed.
 * Builds per-country tyre spend from the legacy digest's `by_country` list
 * (tyre record prices, NOT the expense grid) so that even then nothing is
 * blended. Every other money figure is left null and renders as N/A.
 * The legacy list is capped at 6 countries by the old aggregate.
 */
export function execMoneyFromLegacy(
  legacy: { period_days?: unknown; win_from?: unknown; win_to?: unknown; by_country?: Array<{ label?: unknown; value?: unknown }> } | null | undefined,
  map: CurrencyMap,
  fallback = '',
): ExecMoney {
  const list = Array.isArray(legacy?.by_country) ? legacy!.by_country! : []
  const named = list.filter((c) => {
    const l = text(c?.label)
    return l && l !== '(none)'
  })
  const anyCountry = named.length > 0
  const countries: CountryMoney[] = list.map((c) => {
    const label = text(c?.label)
    const blank = !label || label === '(none)'
    return {
      country: blank ? NO_COUNTRY : label,
      currency: blank ? (anyCountry ? '' : text(fallback).toUpperCase()) : (map[countryKey(label)] ?? ''),
      tyre_spend_all: finite(c?.value),
      tyre_spend_cur: null,
      tyre_spend_prev: null,
      tyre_spend_12m: null,
      expense_lines: null,
      first_date: null,
      last_date: null,
      wo_cost: null,
      accident_cost: null,
      monthly_budget: null,
      monthly_trend: [],
      top_sites: [],
      top_assets: [],
    }
  })
  countries.sort((a, b) => a.country.localeCompare(b.country))
  return {
    basis: 'tyre_records',
    period_days: finite(legacy?.period_days) ?? 30,
    win_from: text(legacy?.win_from) || null,
    win_to: text(legacy?.win_to) || null,
    countries,
  }
}

type MoneyField = 'tyre_spend_all' | 'tyre_spend_cur' | 'tyre_spend_prev' | 'tyre_spend_12m' | 'wo_cost' | 'accident_cost' | 'monthly_budget'

/** One money field across countries, as per-currency parts (never blended). */
export function partsFor(m: ExecMoney, field: MoneyField): MoneyPart[] {
  return sumByCurrency(m.countries.map((c) => ({ currency: c.currency, amount: c[field] })))
}

/** True when at least one country reported this field (so N/A is honest). */
export function fieldKnown(m: ExecMoney, field: MoneyField): boolean {
  return m.countries.some((c) => c[field] != null)
}

/** Text for one field across the whole organisation. */
export function fmtField(m: ExecMoney, field: MoneyField): string {
  if (!fieldKnown(m, field)) return 'N/A'
  const parts = partsFor(m, field)
  if (parts.length === 0) return fmtMoney(0, m.countries.length === 1 ? m.countries[0].currency : '')
  return fmtMoneyParts(parts)
}

/**
 * Budget outlook for ONE country: trailing 12 month tyre spend against twelve
 * times the monthly tyre budget of that country's fleet. Null when either side
 * is missing. Never compares across countries.
 */
export function budgetOutlook(c: CountryMoney): { over: boolean; pct: number; annual_budget: number; run_rate: number } | null {
  const run = finite(c.tyre_spend_12m)
  const monthly = finite(c.monthly_budget)
  if (run == null || monthly == null || monthly <= 0) return null
  const annual = monthly * 12
  return { over: run > annual, pct: Math.round(Math.abs((run - annual) / annual) * 100), annual_budget: annual, run_rate: run }
}

/** PostgREST / Postgres signals that a function does not exist yet. */
export function isMissingRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = text(error.code)
  if (code === 'PGRST202' || code === '42883') return true
  const msg = text(error.message).toLowerCase()
  return msg.includes('could not find the function') || (msg.includes('function') && msg.includes('does not exist'))
}
