import { buildVehicleMeters } from './vehicleMeters'
import { addTimeInterval } from './pmSchedule'

export function pmVehicleProfile(vehicle) {
  if (!vehicle) return null
  const meters = buildVehicleMeters([vehicle], [], [])[0]
  const type = String(vehicle.vehicle_type || '').toUpperCase()
  const category = /GENERATOR/.test(type) ? 'generator'
    : /PLANT|CHILLER|RECLAIMER/.test(type) ? 'plant'
      : /LOADER|EXCAVATOR|FORKLIFT/.test(type) ? 'machinery'
        : meters.supportsKm ? 'vehicle' : meters.supportsHours ? 'equipment' : ''
  return { category, sources: ['none', ...(meters.supportsKm ? ['odometer'] : []), ...(meters.supportsHours ? ['engine_hours'] : [])] }
}

export function pmNextDueFromService(form) {
  const next = {}
  const date = addTimeInterval(form.last_done, form.interval_type, form.interval_value)
  if (date) next.next_due = date
  const last = form.last_done_meter
  const interval = Number(form.meter_interval)
  if (form.meter_source !== 'none' && last !== '' && last != null && Number.isFinite(Number(last)) && Number(last) >= 0 && Number.isFinite(interval) && interval > 0) {
    next.next_due_meter = Number(last) + interval
  }
  return next
}
