/**
 * Fleet analytics for the phone - ONE row from the server, never a table.
 *
 * WHY THIS EXISTS: the analytics screen used to page the whole tyre_records
 * table (and the whole vehicle_fleet, purely to build a site dropdown) into
 * device memory and count the rows itself. On the low-end handsets this fleet
 * actually uses, that made it both the slowest screen in the app and a real
 * out-of-memory risk - the same class of failure behind the native crashes in
 * Play Console. The counting now happens in get_mobile_analytics (V479); the
 * phone renders the answer.
 *
 * No chart library and no rendering engine - plain numbers and simple bars.
 * That is deliberate: a charting engine on a 2GB handset is exactly the kind of
 * thing we are removing, not adding.
 *
 * CURRENCY RULE: SAR, AED and EGP are never summed. On the All-countries view
 * every cost below arrives as null, and the caller must show 'N/A' and rank by
 * volume rather than invent a blended total.
 */
import { supabase } from './supabase'

export interface RiskSlice { risk: string; count: number }
export interface SiteSlice { site: string; count: number; cost: number | null }
export interface BrandSlice { brand: string; count: number; cost: number | null }

export interface MobileAnalytics {
  country: string | null
  site: string | null
  tyres_total: number
  tyres_critical: number
  tyres_high: number
  /** null on the All-countries view: costs from three currencies are not addable. */
  tyre_spend: number | null
  vehicles_total: number
  inspections_30d: number
  open_actions: number
  by_risk: RiskSlice[]
  by_site: SiteSlice[]
  by_brand: BrandSlice[]
  /** Distinct sites for the filter chips, already scoped by RLS. */
  sites: string[]
  generated_at: string | null
}

export interface AnalyticsFilter {
  country?: string | null
  /** Inclusive YYYY-MM-DD bounds. Either side may be omitted for open-ended. */
  from?: string | null
  to?: string | null
  site?: string | null
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Money stays null when it is not comparable, rather than collapsing to 0. */
const money = (v: unknown): number | null => (v == null ? null : num(v))

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Coerce the RPC payload into a predictable shape. Pure - safe to unit test. */
export function shapeAnalytics(raw: unknown): MobileAnalytics | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    country: str(r.country),
    site: str(r.site),
    tyres_total: num(r.tyres_total),
    tyres_critical: num(r.tyres_critical),
    tyres_high: num(r.tyres_high),
    tyre_spend: money(r.tyre_spend),
    vehicles_total: num(r.vehicles_total),
    inspections_30d: num(r.inspections_30d),
    open_actions: num(r.open_actions),
    by_risk: arr(r.by_risk).map((x) => {
      const o = (x || {}) as Record<string, unknown>
      return { risk: str(o.risk) || 'Unknown', count: num(o.count) }
    }),
    by_site: arr(r.by_site).map((x) => {
      const o = (x || {}) as Record<string, unknown>
      return { site: str(o.site) || 'Unknown', count: num(o.count), cost: money(o.cost) }
    }),
    by_brand: arr(r.by_brand).map((x) => {
      const o = (x || {}) as Record<string, unknown>
      return { brand: str(o.brand) || 'Unknown', count: num(o.count), cost: money(o.cost) }
    }),
    sites: arr(r.sites).filter((s): s is string => typeof s === 'string' && s.length > 0),
    generated_at: str(r.generated_at),
  }
}

/**
 * Fetch the analytics row. Throws on failure so the screen can show the real
 * reason and a Retry, rather than a page of zeros that read as real numbers.
 */
export async function getMobileAnalytics(f: AnalyticsFilter = {}): Promise<MobileAnalytics | null> {
  const { data, error } = await supabase.rpc('get_mobile_analytics', {
    p_country: f.country ?? null,
    p_from: f.from || null,
    p_to: f.to || null,
    p_site: f.site || null,
  })
  if (error) throw error
  return shapeAnalytics(data)
}

/** Count of tyres that are neither Critical nor High. Never negative. */
export function safeCount(a: Pick<MobileAnalytics, 'tyres_total' | 'tyres_critical' | 'tyres_high'>): number {
  return Math.max(0, a.tyres_total - a.tyres_critical - a.tyres_high)
}

/** Average spend per tyre, or null when spend is not comparable / nothing counted. */
export function avgCostPerTyre(a: Pick<MobileAnalytics, 'tyre_spend' | 'tyres_total'>): number | null {
  if (a.tyre_spend == null || a.tyres_total <= 0) return null
  return a.tyre_spend / a.tyres_total
}

/** Compact display string, e.g. 12400 -> "12.4k". Keeps tiles narrow on a phone. */
export function compactNumber(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  const n = Number(v)
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}k`
  if (Math.abs(n) >= 1_000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

/** Currency for a country. Returns null when the country is unknown or 'All'. */
export function currencyFor(country: string | null | undefined): string | null {
  switch ((country || '').trim().toUpperCase()) {
    case 'KSA': case 'SAUDI ARABIA': return 'SAR'
    case 'UAE': return 'AED'
    case 'EGYPT': return 'EGP'
    default: return null
  }
}

/**
 * Money for one country. 'N/A' when the amount is not comparable, so a reader
 * is never shown a confident figure that silently mixes three currencies.
 */
export function formatSpend(v: number | null | undefined, country: string | null | undefined): string {
  const cur = currencyFor(country)
  if (v == null || cur == null || !Number.isFinite(Number(v))) return 'N/A'
  return `${cur} ${compactNumber(Number(v))}`
}
