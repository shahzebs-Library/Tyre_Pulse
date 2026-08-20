import { supabase, applyCountry, fetchAllPages, ServiceError } from './_client'

function periodBounds(period) {
  const v = period || { mode: 'all' }
  if (v.mode === 'year') {
    const y = Number(v.year)
    if (!Number.isFinite(y)) return null
    return { from: `${y}-01-01`, toExclusive: `${y + 1}-01-01` }
  }
  if (v.mode === 'custom') {
    const from = v.from && /^\d{4}-\d{2}-\d{2}/.test(v.from) ? v.from.slice(0, 10) : null
    let toExclusive = null
    if (v.to && /^\d{4}-\d{2}-\d{2}/.test(v.to)) {
      const d = new Date(`${v.to.slice(0, 10)}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + 1)
      toExclusive = d.toISOString().slice(0, 10)
    }
    if (!from && !toExclusive) return null
    return { from, toExclusive }
  }
  return null
}

export async function loadExecutiveData({ country, period } = {}) {
  const bounds = periodBounds(period)
  const scoped = (query, dateField) => {
    let s = applyCountry(query, country)
    if (bounds?.from) s = s.gte(dateField, bounds.from)
    if (bounds?.toExclusive) s = s.lt(dateField, bounds.toExclusive)
    return s
  }

  const [rRes, iRes, aRes, fRes] = await Promise.all([
    fetchAllPages((from, to) => scoped(supabase.from('tyre_records').select(
      'id,asset_no,site,brand,position,risk_level,category,findings,km_at_fitment,km_at_removal,cost_per_tyre,qty,issue_date,tread_depth,pressure_reading,country'
    ), 'issue_date').order('issue_date', { ascending: false }).range(from, to), { max: 50000 }),
    fetchAllPages((from, to) => scoped(supabase.from('inspections').select(
      'id,asset_no,site,status,scheduled_date,completed_date,findings,country'
    ), 'scheduled_date').order('scheduled_date', { ascending: false }).range(from, to), { max: 50000 }),
    fetchAllPages((from, to) => scoped(supabase.from('corrective_actions').select(
      'id,site,status,priority,title,created_at,resolved_at,country'
    ), 'created_at').order('created_at', { ascending: false }).range(from, to), { max: 50000 }),
    fetchAllPages((from, to) => applyCountry(
      supabase.from('vehicle_fleet').select('asset_no,site,vehicle_type,monthly_tyre_budget,country'),
      country).order('id').range(from, to), { max: 20000 }).then(
      res => ({ data: res.data || [], error: null, truncated: !!res.truncated })
    ).catch(() => ({ data: [], error: null, truncated: false })),
  ])

  if (rRes.error) throw new ServiceError(rRes.error.message, rRes.error.code, rRes.error)
  if (iRes.error) throw new ServiceError(iRes.error.message, iRes.error.code, iRes.error)
  if (aRes.error) throw new ServiceError(aRes.error.message, aRes.error.code, aRes.error)

  return {
    records: rRes.data || [],
    inspections: iRes.data || [],
    actions: aRes.data || [],
    fleet: fRes.data || [],
    truncated: {
      records: !!rRes.truncated,
      inspections: !!iRes.truncated,
      actions: !!aRes.truncated,
    }
  }
}

const isoDate = (d) => d.toISOString().slice(0, 10)

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getFullYear(), to.getMonth() - 11, 1)
  return { from: isoDate(from), to: isoDate(to) }
}

export async function loadExecutiveAnalyticsData({ country, dateFrom, dateTo } = {}) {
  const from = dateFrom || defaultRange().from
  const to = dateTo || isoDate(new Date())
  const inspSince = isoDate(new Date(Date.now() - 90 * 86400000))
  const byCountry = (q) => (country && country !== 'All' ? q.eq('country', country) : q)

  const [tyresRes, inspectionsRes, fleetRes, openTyresRes] = await Promise.all([
    fetchAllPages((f, t) => byCountry(supabase
      .from('tyre_records')
      .select('asset_no,site,brand,size,supplier,cost_per_tyre,qty,issue_date'))
      .gte('issue_date', from)
      .lte('issue_date', to)
      .range(f, t), { max: 50000 }).then(
        r => ({ data: r.data || [], error: r.error, truncated: !!r.truncated })
      ).catch(e => ({ data: [], error: e, truncated: false })),
    fetchAllPages((f, t) => supabase
      .from('inspections')
      .select('asset_no,site,status,findings,scheduled_date,completed_date')
      .gte('scheduled_date', inspSince)
      .range(f, t), { max: 10000 }).then(
        r => ({ data: r.data || [], error: r.error, truncated: !!r.truncated })
      ).catch(e => ({ data: [], error: e, truncated: false })),
    fetchAllPages((f, t) => supabase
      .from('vehicle_fleet')
      .select('asset_no,site,status')
      .range(f, t), { max: 20000 }).then(
        r => ({ data: r.data || [], error: r.error, truncated: !!r.truncated })
      ).catch(e => ({ data: [], error: e, truncated: false })),
    fetchAllPages((f, t) => byCountry(supabase
      .from('tyre_records')
      .select('asset_no,site,risk_level'))
      .is('removal_date', null)
      .in('risk_level', ['High', 'Critical'])
      .range(f, t), { max: 50000 }).then(
        r => ({ data: r.data || [], error: r.error, truncated: !!r.truncated })
      ).catch(e => ({ data: [], error: e, truncated: false })),
  ])

  return {
    tyres: {
      data: tyresRes.data,
      error: tyresRes.error ? (tyresRes.error.message || String(tyresRes.error)) : null,
      truncated: tyresRes.truncated
    },
    inspections: {
      data: inspectionsRes.data,
      error: inspectionsRes.error ? (inspectionsRes.error.message || String(inspectionsRes.error)) : null,
      truncated: inspectionsRes.truncated
    },
    fleet: {
      data: fleetRes.data,
      error: fleetRes.error ? (fleetRes.error.message || String(fleetRes.error)) : null,
      truncated: fleetRes.truncated
    },
    openTyres: {
      data: openTyresRes.data,
      error: openTyresRes.error ? (openTyresRes.error.message || String(openTyresRes.error)) : null,
      truncated: openTyresRes.truncated
    }
  }
}
