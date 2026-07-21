/**
 * reportSnapshot - the SINGLE source of truth for the mobile executive report.
 *
 * Finding #17: the mobile report screen used to run fresh local queries and build
 * its PDF from those, so it could disagree with itself (screen vs PDF) and with the
 * web executive report. This service fetches ONE server-computed snapshot (the same
 * org-scoped aggregate the web report uses) so the on-screen report AND the PDF are
 * rendered from the exact same object: same KPI values, same generated_at, same
 * company / branding, same filters.
 *
 * Server function: public.get_report_snapshot_authed(p_from,p_to,p_site,p_country)
 * (MIGRATIONS_V322). It is the AUTHENTICATED, non-token sibling of the web's
 * token-based get_report_snapshot: it resolves the caller's org server-side via
 * app_current_org() (no token, no cross-org reach) and returns the identical
 * aggregate shape. The mobile app authenticates to it with the signed-in session's
 * JWT that the supabase client already carries - no share token is involved.
 *
 * Honest states: this NEVER throws and NEVER fabricates numbers. If the RPC is not
 * yet deployed, or the caller has no org, or the network fails, it returns
 * { ok: false, reason } so the screen can show "live report data is unavailable"
 * instead of silently falling back to divergent local figures.
 */

import { supabase } from './supabase'
import { errorDetail } from './safeError'

export interface SnapshotKpis {
  fleet: number
  tyres: number
  tyre_spend: number
  accidents: number
  open_accidents: number
  claims_claimed: number
  claims_recovered: number
  inspections: number
  work_orders_open: number
}

export interface SnapshotCost {
  from: string | null
  to: string | null
  tyre_cost: number
  maintenance_cost: number
  total_cost: number
  km: number
  engine_hours: number
  m3: number
  cost_per_km: number | null
  cost_per_hour: number | null
  cost_per_m3: number | null
  tyre_cpk: number | null
  trend: { total: number[] | null; m3: number[] | null }
}

export interface SnapshotTrends {
  tyre_spend: number[] | null
  accidents: number[] | null
  claims_claimed: number[] | null
  claims_recovered: number[] | null
  inspections: number[] | null
}

export interface SnapshotBreakItem { label: string; value: number }

export interface SnapshotBreakdowns {
  severity: SnapshotBreakItem[] | null
  accidents_by_site: SnapshotBreakItem[] | null
  tyres_by_site: SnapshotBreakItem[] | null
  claim_status: SnapshotBreakItem[] | null
}

export interface SnapshotFilters {
  site: string | null
  country: string | null
  from: string | null
  to: string | null
}

/** The server-computed report snapshot. Everything screen + PDF render comes from here. */
export interface ReportSnapshot {
  ok: true
  company: string
  logo: string | null
  generated_at: string
  filters: SnapshotFilters
  labels: string[]
  kpis: SnapshotKpis
  cost: SnapshotCost
  trends: SnapshotTrends
  breakdowns: SnapshotBreakdowns
}

/** Why a snapshot could not be produced. Drives the honest on-screen message. */
export type SnapshotFailReason =
  | 'unavailable' // RPC not deployed yet, or the caller has no org
  | 'network'
  | 'error'

export type SnapshotResult =
  | ReportSnapshot
  | { ok: false; reason: SnapshotFailReason }

export interface SnapshotParams {
  from?: string | null
  to?: string | null
  site?: string | null
  country?: string | null
}

/** True when a Postgres "function does not exist" style error means the RPC is not deployed. */
function isMissingFunction(err: any): boolean {
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '').toLowerCase()
  return (
    code === 'PGRST202' || // PostgREST: could not find the function
    code === '404' ||
    code === '42883' || // undefined_function
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('not found')
  )
}

function isNetworkError(err: any): boolean {
  const msg = String(err?.message ?? '').toLowerCase()
  return (
    msg.includes('network') || msg.includes('failed to fetch') ||
    msg.includes('timeout') || msg.includes('offline')
  )
}

/**
 * Fetch the authoritative server snapshot for the caller's org.
 * Returns a typed, honest result and NEVER throws.
 */
export async function fetchReportSnapshot(params: SnapshotParams = {}): Promise<SnapshotResult> {
  try {
    const { data, error } = await supabase.rpc('get_report_snapshot_authed', {
      p_from: params.from ?? null,
      p_to: params.to ?? null,
      p_site: params.site ?? null,
      p_country: params.country ?? null,
    })

    if (error) {
      if (isMissingFunction(error)) return { ok: false, reason: 'unavailable' }
      if (isNetworkError(error)) return { ok: false, reason: 'network' }
      if (__DEV__) console.warn('[reportSnapshot] rpc error', errorDetail(error))
      return { ok: false, reason: 'error' }
    }

    const snap = data as any
    if (!snap || snap.ok !== true) {
      // Server said not-ok (e.g. no org resolved) - honest unavailable, never faked.
      return { ok: false, reason: 'unavailable' }
    }

    return normalizeSnapshot(snap)
  } catch (e: any) {
    if (isNetworkError(e)) return { ok: false, reason: 'network' }
    if (__DEV__) console.warn('[reportSnapshot] threw', errorDetail(e))
    return { ok: false, reason: 'error' }
  }
}

const num = (v: any): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: any): number | null => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const numArr = (v: any): number[] | null =>
  Array.isArray(v) ? v.map(num) : null
const breakItems = (v: any): SnapshotBreakItem[] | null =>
  Array.isArray(v)
    ? v.map((r: any) => ({ label: String(r?.label ?? 'Unspecified'), value: num(r?.value) }))
    : null

/** Coerce the raw jsonb into a strongly-typed snapshot with safe defaults. */
function normalizeSnapshot(s: any): ReportSnapshot {
  const k = s.kpis ?? {}
  const c = s.cost ?? {}
  const t = s.trends ?? {}
  const b = s.breakdowns ?? {}
  const f = s.filters ?? {}
  return {
    ok: true,
    company: String(s.company ?? 'TyrePulse'),
    logo: s.logo ? String(s.logo) : null,
    generated_at: String(s.generated_at ?? new Date().toISOString()),
    filters: {
      site: f.site ?? null,
      country: f.country ?? null,
      from: f.from ?? null,
      to: f.to ?? null,
    },
    labels: Array.isArray(s.labels) ? s.labels.map((x: any) => String(x)) : [],
    kpis: {
      fleet: num(k.fleet),
      tyres: num(k.tyres),
      tyre_spend: num(k.tyre_spend),
      accidents: num(k.accidents),
      open_accidents: num(k.open_accidents),
      claims_claimed: num(k.claims_claimed),
      claims_recovered: num(k.claims_recovered),
      inspections: num(k.inspections),
      work_orders_open: num(k.work_orders_open),
    },
    cost: {
      from: c.from ?? null,
      to: c.to ?? null,
      tyre_cost: num(c.tyre_cost),
      maintenance_cost: num(c.maintenance_cost),
      total_cost: num(c.total_cost),
      km: num(c.km),
      engine_hours: num(c.engine_hours),
      m3: num(c.m3),
      cost_per_km: numOrNull(c.cost_per_km),
      cost_per_hour: numOrNull(c.cost_per_hour),
      cost_per_m3: numOrNull(c.cost_per_m3),
      tyre_cpk: numOrNull(c.tyre_cpk),
      trend: {
        total: numArr(c?.trend?.total),
        m3: numArr(c?.trend?.m3),
      },
    },
    trends: {
      tyre_spend: numArr(t.tyre_spend),
      accidents: numArr(t.accidents),
      claims_claimed: numArr(t.claims_claimed),
      claims_recovered: numArr(t.claims_recovered),
      inspections: numArr(t.inspections),
    },
    breakdowns: {
      severity: breakItems(b.severity),
      accidents_by_site: breakItems(b.accidents_by_site),
      tyres_by_site: breakItems(b.tyres_by_site),
      claim_status: breakItems(b.claim_status),
    },
  }
}
