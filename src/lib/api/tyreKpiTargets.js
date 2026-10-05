/**
 * Tyre KPI targets for the Tyre Failure and CPK board: fleet CPK and average
 * tyre life, stored as ordinary rows in the existing kpi_targets table
 * (metric, target_value, year, country; month and site left blank = a fleet
 * target for the year). No new table.
 *
 * Writes look the row up first and update it, else insert: the table's
 * upsert key (metric, year, month, site) cannot match blank month/site
 * values, so an upsert would add a duplicate row on every save.
 */
import { supabase, unwrap } from './_client'

const COLS = 'id,metric,target_value,target,year,month,site,country,unit'
const METRICS = ['fleet_cpk', 'avg_tyre_life_km']

/** Fleet-level tyre targets for a year (country rows plus country-blank rows). */
export async function listTyreTargets({ year }) {
  return unwrap(await supabase
    .from('kpi_targets')
    .select(COLS)
    .in('metric', METRICS)
    .eq('year', year)
    .is('month', null)
    .limit(50))
}

/**
 * Save one target. A null/blank value deletes nothing: it is refused, so a
 * cleared box can never be stored as a target of 0.
 */
export async function saveTyreTarget({ metric, value, year, country, unit }) {
  if (!METRICS.includes(metric)) throw new Error('Unknown target.')
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) throw new Error('Enter a target greater than zero.')
  let q = supabase.from('kpi_targets').select('id').eq('metric', metric).eq('year', year).is('month', null).is('site', null)
  q = country ? q.eq('country', country) : q.is('country', null)
  const existing = unwrap(await q.limit(1))
  if (existing && existing[0]) {
    return unwrap(await supabase.from('kpi_targets').update({ target_value: v, unit: unit || null }).eq('id', existing[0].id))
  }
  return unwrap(await supabase.from('kpi_targets').insert({
    metric, target_value: v, year, month: null, site: null, country: country || null, unit: unit || null,
  }))
}
