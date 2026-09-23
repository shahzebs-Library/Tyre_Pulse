import { supabase } from '../supabase'
import { fetchAllPages } from '../fetchAll'
import { toUserMessage } from '../safeError'
import { addDays, MAX_PLANNER_BATCH } from '../inspectionPlanner'

const scheduleColumns = 'id, asset_no, site, scheduled_date, inspection_time, inspector_name, inspection_type, priority, status, notes, country, created_at'

function normalizeSchedule(row) {
  return { ...row, inspection_date: row.scheduled_date || '', type: row.inspection_type || 'Routine', status: row.status || 'Scheduled' }
}

export async function loadPlannerData({ country, signal } = {}) {
  async function read(table, columns, dateColumn, includeUnassignedCountry = false) {
    const result = await fetchAllPages((from, to) => {
      let query = supabase.from(table).select(columns)
        .order(dateColumn, { ascending: false }).order('id').range(from, to)
      if (country && country !== 'All') {
        query = includeUnassignedCountry
          ? query.or(`country.eq.${country},country.is.null`)
          : query.eq('country', country)
      }
      if (signal) query = query.abortSignal(signal)
      return query
    }, { max: 50000 })
    if (result.error) throw result.error
    return result
  }
  // Retain independent results so unavailable schedules cannot become a false zero.
  const results = await Promise.allSettled([
    read('inspections', 'id, asset_no, tyre_serial, inspection_date, inspector, site, country, pressure_reading', 'inspection_date'),
    read('tyre_records', 'id, asset_no, serial_number, site, country, risk_level, tread_depth, issue_date', 'issue_date'),
    read('inspection_schedules', scheduleColumns, 'scheduled_date', true),
  ])
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const [inspectionResult, tyreResult, scheduleResult] = results
  const dataError = [inspectionResult, tyreResult].some(result => result.status === 'rejected')
    ? 'Could not load inspection and tyre history. Retry to view the work queue.' : null
  return {
    inspections: inspectionResult.status === 'fulfilled'
      ? inspectionResult.value.data.map(row => ({ ...row, inspector_name: row.inspector })) : [],
    tyreRecords: tyreResult.status === 'fulfilled' ? tyreResult.value.data : [],
    schedule: scheduleResult.status === 'fulfilled' ? scheduleResult.value.data.map(normalizeSchedule) : [],
    dataError,
    scheduleError: scheduleResult.status === 'rejected' ? 'Could not load the schedule. Retry before scheduling work.' : null,
    truncated: results.some(result => result.status === 'fulfilled' && result.value.truncated),
  }
}

function payload(item) {
  return {
    asset_no: item.asset_no?.trim() || null,
    site: item.site?.trim() || null,
    scheduled_date: item.inspection_date || null,
    inspection_time: item.inspection_time || null,
    inspector_name: item.inspector_name?.trim() || null,
    inspection_type: item.type || 'Routine',
    priority: item.priority || null,
    status: item.status || 'Scheduled',
    notes: item.notes?.trim() || null,
  }
}

function validateSchedule(item) {
  if (!item || typeof item.asset_no !== 'string' || !item.asset_no.trim()) {
    throw new Error('Choose a vehicle before scheduling an inspection.')
  }
  if (typeof item.inspector_name !== 'string' || !item.inspector_name.trim()) {
    throw new Error('Enter an inspector before scheduling an inspection.')
  }
  addDays(item.inspection_date, 0)
  if (typeof item.inspection_time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(item.inspection_time)) {
    throw new Error('Enter a valid inspection time.')
  }
}

function verifyWrite(result, count, fallback) {
  if (result.error) throw new Error(toUserMessage(result.error, fallback))
  if (!Array.isArray(result.data) || result.data.length !== count) {
    throw new Error('The change could not be confirmed. Refresh and check your access before trying again.')
  }
  return result.data
}

export async function savePlannerSchedules(items, { country, profileId } = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error('Select at least one vehicle.')
  if (items.length > MAX_PLANNER_BATCH) throw new Error(`Schedule up to ${MAX_PLANNER_BATCH} vehicles at a time.`)
  items.forEach(validateSchedule)
  if (items.length === 1 && items[0].id) {
    return verifyWrite(await supabase.from('inspection_schedules').update(payload(items[0]))
      .eq('id', items[0].id).select('id'), 1, 'Could not save the inspection schedule.')
  }
  if (typeof country !== 'string' || !country.trim() || country.trim() === 'All') throw new Error('Select a country before scheduling inspections.')
  if (items.some(item => item.id)) throw new Error('Edit existing appointments individually.')
  return verifyWrite(await supabase.from('inspection_schedules').insert(items.map(item => ({
    ...payload(item), country: country.trim(), created_by: profileId || null,
  }))).select('id'), items.length, 'Could not save the inspection schedule.')
}

export async function updateScheduleStatus(id, status) {
  if (status !== 'Cancelled') throw new Error('This status change is not supported.')
  return verifyWrite(await supabase.from('inspection_schedules').update({ status }).eq('id', id).select('id'),
    1, 'Could not cancel the inspection schedule.')
}

export async function deletePlannerSchedule(id) {
  return verifyWrite(await supabase.from('inspection_schedules').delete().eq('id', id).select('id'),
    1, 'Could not delete the inspection schedule.')
}
