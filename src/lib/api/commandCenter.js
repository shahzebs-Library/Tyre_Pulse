/**
 * Command Center reads. One loader per card so each card loads, fails and
 * retries on its own: a slow tyre-life read never holds the fleet tiles back,
 * and a denied insurance read shows "N/A" on one tile instead of an error page.
 *
 * Everything is country-scoped through the same null-safe helpers the rest of
 * the app uses, and reuses the existing services wherever one already answers
 * the question.
 */
import { supabase, applyCountry, fetchAllPages, toServiceError } from './_client'
import { getTyreRunningLife } from './tyreRunningLife'
import { shapeRunningLife } from '../tyreRunningLife'
import { listActionItems } from './actionCenter'
import { loadPmDashboard } from './pmPrograms'
import { listAssetUtilization } from './assetUtilization'
import { loadGovernedCost } from './governedCost'
import {
  listInspectionApprovals, listChecklistApprovals, listAccidentClosures,
} from './approvalsQueue'
import { workshopWindows } from '../commandCenter'

const CACHE_MS = 60_000
const FLEET_MAX = 20_000

/** Fleet register rows: everything the KPI tiles, the map and completeness need. */
export async function loadFleetRows({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) =>
    applyCountry(
      supabase.from('vehicle_fleet')
        .select('id,asset_no,status,make,model,site,country,vehicle_type,expected_km_per_tyre,min_days_between_changes,created_at'),
      country,
    ).order('id').range(from, to), { max: FLEET_MAX })
  if (error) throw toServiceError(error)
  return data || []
}

/** Fitted tyres with their running-life judgement (cached for a minute). */
export async function loadTyreLife({ country } = {}) {
  const res = await getTyreRunningLife({ country, maxAgeMs: CACHE_MS })
  const shaped = res && res.ok !== false ? shapeRunningLife(res) : null
  if (!shaped?.ok) throw new Error(res?.reason || 'Could not load tyre life.')
  return shaped.rows
}

/** Open action items, newest first. */
export function loadActions({ country } = {}) {
  return listActionItems({ country, limit: 200 })
}

async function countOpenedSince(country, iso) {
  const { count, error } = await applyCountry(
    supabase.from('work_orders').select('id', { count: 'exact', head: true }).gte('opened_at', iso),
    country,
  )
  if (error) throw toServiceError(error)
  return count ?? 0
}

/** Work orders opened today / this week / this month, plus the latest jobs. */
export async function loadWorkshop({ country } = {}, now = new Date()) {
  const w = workshopWindows(now)
  const recent = applyCountry(
    supabase.from('work_orders')
      .select('id,work_order_no,asset_no,description,work_type,status,site,opened_at')
      .lte('opened_at', now.toISOString())
      .order('opened_at', { ascending: false }).order('id', { ascending: false })
      .limit(25),
    country,
  )
  const [today, week, month, list] = await Promise.all([
    countOpenedSince(country, w.today), countOpenedSince(country, w.week), countOpenedSince(country, w.month), recent,
  ])
  if (list.error) throw toServiceError(list.error)
  return { counts: { today, week, month }, recent: list.data || [] }
}

/** Preventive plans with the meters needed to judge which are due. */
export function loadMaintenance({ country } = {}) {
  return loadPmDashboard({ country })
}

/** Telematics utilisation snapshots. */
export function loadUtilization({ country } = {}) {
  return listAssetUtilization({ country })
}

/** This year's governed spend against the same span last year. */
export function loadSpend({ country } = {}, now = new Date()) {
  const from = `${now.getFullYear()}-01-01`
  const to = now.toISOString().slice(0, 10)
  return loadGovernedCost({ country, from, to, maxAgeMs: CACHE_MS })
}

async function safeCount(build) {
  try {
    const { count, error } = await build()
    if (error) return null
    return count ?? 0
  } catch { return null }
}

/**
 * The four compliance tiles. Each is null when its source cannot be read, so a
 * role without access sees "N/A" rather than a false 0% or 100%.
 */
export async function loadCompliance({ country } = {}, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
  const q = (t, cols = 'id') => applyCountry(supabase.from(t).select(cols, { count: 'exact', head: true }), country)
  const [polTotal, polActive, certTotal, certValid, inspected] = await Promise.all([
    safeCount(() => q('insurance_policies')),
    safeCount(() => q('insurance_policies').gte('period_to', today)),
    safeCount(() => q('certifications')),
    safeCount(() => q('certifications').or(`expiry_date.is.null,expiry_date.gte.${today}`)),
    (async () => {
      try {
        const { data, error } = await fetchAllPages((from, to) => applyCountry(
          supabase.from('inspections').select('asset_no').gte('inspection_date', since), country,
        ).order('id').range(from, to), { max: 20_000 })
        if (error) return null
        return new Set((data || []).map((r) => String(r.asset_no || '').trim().toUpperCase()).filter(Boolean)).size
      } catch { return null }
    })(),
  ])
  return { polTotal, polActive, certTotal, certValid, inspectedAssets: inspected }
}

/** Pending sign-offs across inspections, checklists and accident closures. */
export async function loadApprovals({ country } = {}) {
  const [ins, chk, acc] = await Promise.allSettled([
    listInspectionApprovals({ country }), listChecklistApprovals({ country }), listAccidentClosures({ country }),
  ])
  const rows = []
  if (ins.status === 'fulfilled') for (const r of ins.value) rows.push({ id: `i-${r.id}`, kind: 'inspection', title: r.title || r.inspection_type || 'Inspection', asset: r.asset_no, site: r.site, at: r.created_at || r.inspection_date, to: '/approvals' })
  if (chk.status === 'fulfilled') for (const r of chk.value) rows.push({ id: `c-${r.id}`, kind: 'checklist', title: r.template_name || r.title || 'Checklist', asset: r.asset_no, site: r.site, at: r.submitted_at, to: '/approvals' })
  if (acc.status === 'fulfilled') for (const r of acc.value) rows.push({ id: `a-${r.id}`, kind: 'accident', title: 'Accident closure', asset: r.asset_no, site: r.site, at: r.close_requested_at || r.incident_date, amount: r.estimated_damage_cost, to: '/approvals' })
  const failed = [ins, chk, acc].every((s) => s.status === 'rejected')
  if (failed) throw new Error('Could not load approvals.')
  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
  return rows
}

/** Recently decided inspections and checklists, for the Approved / Rejected tabs. */
export async function loadDecided({ country } = {}) {
  const pick = async (table, cols, map) => {
    try {
      const { data, error } = await applyCountry(
        supabase.from(table).select(cols).in('approval_status', ['approved', 'rejected']), country,
      ).order('approved_at', { ascending: false, nullsFirst: false }).limit(20)
      if (error) return []
      return (data || []).map(map)
    } catch { return [] }
  }
  const [a, b] = await Promise.all([
    pick('inspections', 'id,title,inspection_type,asset_no,site,approval_status,approved_at', (r) => ({ id: `i-${r.id}`, kind: 'inspection', title: r.title || r.inspection_type || 'Inspection', asset: r.asset_no, site: r.site, at: r.approved_at, status: r.approval_status })),
    pick('checklist_submissions', 'id,template_name,asset_no,site,approval_status,approved_at', (r) => ({ id: `c-${r.id}`, kind: 'checklist', title: r.template_name || 'Checklist', asset: r.asset_no, site: r.site, at: r.approved_at, status: r.approval_status })),
  ])
  return [...a, ...b].sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')))
}
