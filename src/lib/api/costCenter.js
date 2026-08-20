import { supabase, applyCountry, fetchAllPages, ServiceError } from './_client'

const TYRE_ROW_CEILING = 50000

export async function fetchCostCenterRecords({ country, dateFrom, dateTo } = {}) {
  const { data, error, truncated } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('tyre_records')
      .select(
        'id, asset_number, asset_no, brand, site, country, cost_per_tyre, ' +
        'km_at_fitment, km_at_removal, risk_level, removal_reason, category, ' +
        'created_at, tyre_position, position'
      )

    if (country && country !== 'All') {
      q = q.eq('country', country)
    }
    if (dateFrom) q = q.gte('created_at', dateFrom)
    if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59')

    return q.order('created_at', { ascending: false }).range(from, to)
  }, { max: TYRE_ROW_CEILING })

  if (error) throw new ServiceError(error.message, error.code, error)
  return { data: data ?? [], truncated: Boolean(truncated) }
}

async function sumMeterDeltas(table, valueCol, { country, site, from, to }) {
  try {
    let q = supabase.from(table).select(`asset_no,${valueCol},reading_date`)
    q = applyCountry(q, country)
    if (site && site !== 'All') q = q.eq('site', site)
    if (from) q = q.gte('reading_date', from)
    if (to) q = q.lte('reading_date', to)
    const { data, error } = await q.limit(100000)
    if (error) throw error
    const byAsset = new Map()
    for (const r of data || []) {
      const v = Number(r?.[valueCol])
      if (!Number.isFinite(v)) continue
      const a = r?.asset_no || '__none__'
      const cur = byAsset.get(a)
      if (!cur) byAsset.set(a, { min: v, max: v })
      else { cur.min = Math.min(cur.min, v); cur.max = Math.max(cur.max, v) }
    }
    let total = 0
    for (const { min, max } of byAsset.values()) total += Math.max(0, max - min)
    return total
  } catch {
    return 0
  }
}

export async function getMeterDeltas({ country, site, from, to } = {}) {
  const [odometer, engineHours] = await Promise.all([
    sumMeterDeltas('odometer_logs', 'odometer_km', { country, site, from, to }),
    sumMeterDeltas('engine_hours_logs', 'engine_hours', { country, site, from, to }),
  ])
  return { odometer, engineHours }
}
