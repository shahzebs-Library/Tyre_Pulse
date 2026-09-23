export const meterKey = row => JSON.stringify([row.organisation_id ?? null, row.country ?? null, String(row.asset_no || '').trim().toUpperCase()])
export const finiteMeter = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value)
export function newMeterDraft(vehicle) {
  return { km: '', hours: '', date: meterToday(vehicle.country), notes: '',
    requestId: crypto.randomUUID() }
}
export function meterTimezone(country) {
  return country === 'UAE' ? 'Asia/Dubai' : country === 'Egypt' ? 'Africa/Cairo' : 'Asia/Riyadh'
}
export function meterToday(country, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: meterTimezone(country), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key).value).join('-')
}
export function readingDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Not recorded'
  return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
}
export function receivedDate(value, country) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Not recorded'
  return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: meterTimezone(country), timeZoneName: 'short' }).format(new Date(value))
}
export function meterSource(value) {
  const source = String(value || '').trim()
  if (!source) return 'Unknown'
  if (/^mobile$/i.test(source)) return 'Mobile'
  if (/^telematics$/i.test(source)) return 'Telematics'
  if (/^(web manual|web)$/i.test(source)) return 'Web Manual'
  if (/^tyre_change(?:_|$)/i.test(source)) return 'Tyre change records'
  if (/^manual$/i.test(source)) return 'Manual entry'
  if (/import|upload|erp/i.test(source)) return 'Import'
  return source
}
export function latestMeters(rows) {
  const map = new Map()
  for (const row of rows) {
    const key = meterKey(row)
    const prior = map.get(key)
    const stamp = r => `${r.reading_date || ''}|${r.created_at || ''}|${r.id}`
    if (!prior || stamp(row) > stamp(prior)) map.set(key, row)
  }
  return map
}
export function buildVehicleMeters(fleet, odometer, hours) {
  const kmMap = latestMeters(odometer), hourMap = latestMeters(hours)
  const counts = new Map()
  fleet.forEach(v => counts.set(meterKey(v), (counts.get(meterKey(v)) || 0) + 1))
  return fleet.map(vehicle => {
    const key = meterKey(vehicle), kmLog = kmMap.get(key), hoursLog = hourMap.get(key)
    const kmValues = [finiteMeter(vehicle.current_km), finiteMeter(kmLog?.odometer_km)].filter(v => v != null)
    const km = kmValues.length ? Math.max(...kmValues) : null
    const hourValues = [finiteMeter(hoursLog?.engine_hours), finiteMeter(vehicle.current_engine_hours), finiteMeter(vehicle.current_hours)].filter(v => v != null)
    const engineHours = hourValues.length ? Math.max(...hourValues) : null
    const type = String(vehicle.vehicle_type || '').toUpperCase().replaceAll('_', ' ')
    const roadEngine = /^(TR-MIXER|PUMPS|LINE PUMP|BUS|PICKUP|D TANKER)$/.test(type)
    const stationaryEngine = /GENERATOR|LOADER|EXCAVATOR|FORKLIFT|STATIONARY PUMP|SPIDER PUMP|BT-PLANT|ICE PLANT|CHILLER|RECLAIMER/.test(type)
    const supportsKm = km != null || Boolean(kmLog) || roadEngine
    const supportsHours = engineHours != null || Boolean(hoursLog) || roadEngine || stationaryEngine
    return { ...vehicle, kmLog, hoursLog, km, engineHours, supportsKm, supportsHours, duplicate: counts.get(key) > 1 }
  })
}
export function validateMeterDraft(draft, vehicle) {
  const km = draft.km === '' ? null : finiteMeter(draft.km)
  const hours = draft.hours === '' ? null : finiteMeter(draft.hours)
  if ((draft.km !== '' && (km == null || km < 0)) || (draft.hours !== '' && (hours == null || hours < 0))) return 'Enter a valid, non-negative reading.'
  if (km == null && hours == null) return 'Enter kilometres, hours, or both.'
  if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || draft.date > meterToday(vehicle.country)) return 'Choose a reading date no later than today.'
  if (vehicle.duplicate) return 'This asset has duplicate fleet records. Resolve its identity before saving.'
  return ''
}
