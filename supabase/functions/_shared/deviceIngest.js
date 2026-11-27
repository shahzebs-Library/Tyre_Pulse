// Device ingest: canonical message format, validation and vendor adapters.
//
// ONE source of truth, plain JS with no imports, so it runs unchanged in
// three places: the `device-ingest` edge function (Deno), the web Devices &
// Integrations page "send test payload" helper (Vite), and the tests (Vitest).
//
// Canonical message (what the database function _device_ingest_process reads):
//   {
//     type:        'gps'|'odometer'|'engine_hours'|'tpms'|'tread'|'fuel_level'|
//                  'fuel_transaction'|'dtc'|'rfid'|'dashcam',
//     message_id:  string (optional; idempotency key. When absent the server
//                  derives one from the message content, so a resent identical
//                  message is still a duplicate),
//     recorded_at: ISO-8601 timestamp (optional, defaults to receive time),
//     device_id:   string (IMEI / serial of the sending unit, optional),
//     asset:       { asset_no?, vin?, chassis_no?, registration_no?, imei?, country? },
//     data:        type-specific fields, see VALIDATORS below.
//   }
// Units are fixed in the canonical form: km, hours, psi, degrees C, mm,
// litres, km/h. Adapters convert.

export const MESSAGE_TYPES = Object.freeze([
  'gps', 'odometer', 'engine_hours', 'tpms', 'tread',
  'fuel_level', 'fuel_transaction', 'dtc', 'rfid', 'dashcam',
])
export const VENDORS = Object.freeze(['generic', 'teltonika', 'wialon', 'samsara'])
export const MAX_MESSAGES = 500
export const MAX_BODY_BYTES = 512 * 1024

const DASHCAM_TYPES = ['collision', 'harsh_brake', 'tailgating', 'distraction', 'drowsiness', 'phone_use', 'no_seatbelt', 'other']

// ── small coercers ─────────────────────────────────────────────────────────
export function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
function str(v, max = 200) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}
/** Accepts ISO strings, unix seconds or unix milliseconds. Returns ISO or null; NaN-date -> undefined. */
export function toIso(v) {
  if (v === null || v === undefined || v === '') return null
  let d
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v)
    d = new Date(n < 1e12 ? n * 1000 : n)
  } else {
    d = new Date(String(v))
  }
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}
export function pressureToPsi(value, unit) {
  const n = toNum(value)
  if (n === null || Number.isNaN(n)) return n
  const u = String(unit || 'psi').toLowerCase()
  if (u === 'bar') return round(n * 14.5038, 2)
  if (u === 'kpa') return round(n * 0.145038, 2)
  return n
}
function round(n, dp) { const f = 10 ** dp; return Math.round(n * f) / f }
function inRange(n, lo, hi) { return n !== null && !Number.isNaN(n) && n >= lo && n <= hi }

// ── per-type validation: returns { data } or { error } ────────────────────
function need(n, name, lo, hi) {
  if (n === null) return `${name}_required`
  if (Number.isNaN(n) || n < lo || n > hi) return `${name}_out_of_range`
  return null
}
function optional(n, name, lo, hi) {
  if (n === null) return null
  return Number.isNaN(n) || n < lo || n > hi ? `${name}_out_of_range` : null
}

const VALIDATORS = {
  gps(d) {
    const lat = toNum(d.lat ?? d.latitude), lon = toNum(d.lon ?? d.lng ?? d.longitude)
    const speed = toNum(d.speed_kmh), heading = toNum(d.heading), alt = toNum(d.altitude_m), odo = toNum(d.odometer_km)
    const e = need(lat, 'lat', -90, 90) || need(lon, 'lon', -180, 180) || optional(speed, 'speed_kmh', 0, 400)
      || optional(heading, 'heading', 0, 360) || optional(alt, 'altitude_m', -500, 9000) || optional(odo, 'odometer_km', 0, 5e6)
    if (e) return { error: e }
    if (lat === 0 && lon === 0) return { error: 'no_gps_fix' }
    const ign = d.ignition === undefined || d.ignition === null ? null : Boolean(d.ignition === true || d.ignition === 1 || d.ignition === '1' || d.ignition === 'true')
    return { data: { lat, lon, speed_kmh: speed, heading, altitude_m: alt, ignition: ign, odometer_km: odo } }
  },
  odometer(d) {
    const km = toNum(d.odometer_km)
    const e = need(km, 'odometer_km', 0, 5e6)
    return e ? { error: e } : { data: { odometer_km: km } }
  },
  engine_hours(d) {
    const h = toNum(d.engine_hours)
    const e = need(h, 'engine_hours', 0, 500000)
    return e ? { error: e } : { data: { engine_hours: h } }
  },
  tpms(d) {
    const psi = pressureToPsi(d.pressure ?? d.pressure_psi, d.pressure_unit ?? (d.pressure_psi !== undefined ? 'psi' : d.unit))
    const target = pressureToPsi(d.target_pressure ?? d.target_psi, d.pressure_unit ?? 'psi')
    const temp = toNum(d.temperature_c ?? d.temperature)
    const position = str(d.position ?? d.tyre_position ?? d.wheel, 20)
    if (!position && !str(d.sensor_id)) return { error: 'position_or_sensor_required' }
    const e = need(psi, 'pressure', 0, 250) || optional(target, 'target_pressure', 1, 250) || optional(temp, 'temperature_c', -60, 200)
    if (e) return { error: e }
    return { data: { position: position ? position.toUpperCase() : null, pressure_psi: psi, target_psi: target, temperature_c: temp,
      sensor_id: str(d.sensor_id, 60), tyre_serial: str(d.tyre_serial, 60) } }
  },
  tread(d) {
    const mm = toNum(d.depth_mm ?? d.tread_mm)
    const e = need(mm, 'depth_mm', 0, 60)
    if (e) return { error: e }
    const source = str(d.source, 20)
    return { data: { depth_mm: mm, position: str(d.position, 20)?.toUpperCase() ?? null, tyre_serial: str(d.tyre_serial, 60),
      source: ['gauge', 'drive_over', 'manual', 'import'].includes(source) ? source : 'gauge' } }
  },
  fuel_level(d) {
    const pct = toNum(d.level_pct), lit = toNum(d.level_litres)
    if (pct === null && lit === null) return { error: 'level_required' }
    const e = optional(pct, 'level_pct', 0, 100) || optional(lit, 'level_litres', 0, 100000)
    return e ? { error: e } : { data: { level_pct: pct, level_litres: lit } }
  },
  fuel_transaction(d) {
    const litres = toNum(d.litres), amount = toNum(d.amount), odo = toNum(d.odometer_km)
    const e = need(litres, 'litres', 0, 100000) || optional(amount, 'amount', 0, 1e7) || optional(odo, 'odometer_km', 0, 5e6)
    if (e) return { error: e }
    const currency = str(d.currency, 3)
    if (currency && !/^[A-Za-z]{3}$/.test(currency)) return { error: 'currency_invalid' }
    return { data: { litres, amount, currency: currency?.toUpperCase() ?? null, odometer_km: odo, station: str(d.station, 120),
      receipt_no: str(d.receipt_no, 60) } }
  },
  dtc(d) {
    const code = str(d.code, 40)
    if (!code) return { error: 'code_required' }
    const sev = String(d.severity || '').toLowerCase()
    return { data: { code: code.toUpperCase(), description: str(d.description, 500), system: str(d.system, 80),
      severity: ['info', 'warning', 'critical'].includes(sev) ? sev : 'warning' } }
  },
  rfid(d) {
    const tag = str(d.tag_id ?? d.epc, 128)
    if (!tag) return { error: 'tag_id_required' }
    return { data: { tag_id: tag.toUpperCase(), reader_id: str(d.reader_id, 80), site: str(d.site, 80) } }
  },
  dashcam(d) {
    const t = String(d.event_type || '').toLowerCase()
    const speed = toNum(d.speed_kmh)
    const e = optional(speed, 'speed_kmh', 0, 400)
    if (e) return { error: e }
    const url = str(d.video_url, 2000)
    const sev = String(d.severity || '').toLowerCase()
    return { data: { event_type: DASHCAM_TYPES.includes(t) ? t : 'other',
      severity: ['low', 'medium', 'high', 'critical'].includes(sev) ? sev : 'medium',
      location: str(d.location, 300), speed_kmh: speed, driver_name: str(d.driver_name, 120),
      video_url: url && /^https:\/\/\S+$/.test(url) ? url : null } }
  },
}

function cleanAsset(a) {
  if (!a || typeof a !== 'object') return {}
  const out = {}
  for (const k of ['asset_no', 'vin', 'chassis_no', 'registration_no', 'imei', 'country']) {
    const v = str(a[k], 80)
    if (v) out[k] = v
  }
  return out
}

/** Validate one canonical-shaped message. Returns { ok:true, message } or { ok:false, type, error }. */
export function normalizeMessage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, type: null, error: 'not_an_object' }
  const type = String(raw.type || '').toLowerCase()
  if (!MESSAGE_TYPES.includes(type)) return { ok: false, type: str(raw.type, 40), error: 'unknown_type' }
  const recorded = toIso(raw.recorded_at ?? raw.timestamp ?? raw.time)
  if (recorded === undefined) return { ok: false, type, error: 'bad_recorded_at' }
  const asset = cleanAsset(raw.asset)
  const deviceId = str(raw.device_id ?? raw.imei, 80)
  if (!deviceId && !Object.keys(asset).some((k) => k !== 'country')) {
    return { ok: false, type, error: 'asset_or_device_required' }
  }
  const res = VALIDATORS[type](raw.data && typeof raw.data === 'object' ? raw.data : {})
  if (res.error) return { ok: false, type, error: res.error }
  const message = { type, data: res.data, asset }
  if (recorded) message.recorded_at = recorded
  if (deviceId) message.device_id = deviceId
  const mid = str(raw.message_id ?? raw.id, 120)
  if (mid) message.message_id = mid
  return { ok: true, message }
}

// ── vendor adapters: vendor payload -> array of canonical-shaped messages ──
// Each adapter only reshapes; normalizeMessage does all the validation.

/** generic: { messages:[...] } | [...] | single canonical message. */
function adaptGeneric(body) {
  if (Array.isArray(body)) return body
  if (body && Array.isArray(body.messages)) return body.messages
  return [body]
}

/**
 * Teltonika devices via flespi-style JSON (flat dotted keys, one record per
 * point): ident, timestamp (unix s), position.latitude/longitude/speed/
 * direction/altitude, engine.ignition.status, vehicle.mileage (km),
 * can.engine.motorhours or engine.motorhours (h), can.fuel.level (%),
 * tpms.<n>.pressure (bar) / tpms.<n>.temperature (C).
 * One record can fan out into several canonical messages.
 */
function adaptTeltonika(body) {
  const recs = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [body]
  const out = []
  for (const r of recs) {
    if (!r || typeof r !== 'object') { out.push(r); continue }
    const base = { device_id: r.ident ?? r['device.id'], recorded_at: r.timestamp, asset: { vin: r['vehicle.vin'], registration_no: r['vehicle.registration.number'] } }
    const idBase = r.ident && r.timestamp ? `${r.ident}:${r.timestamp}` : null
    const push = (type, data, suffix) => out.push({ ...base, type, data, message_id: idBase ? `tlt:${idBase}:${suffix}` : undefined })
    if (r['position.latitude'] !== undefined) {
      push('gps', { lat: r['position.latitude'], lon: r['position.longitude'], speed_kmh: r['position.speed'],
        heading: r['position.direction'], altitude_m: r['position.altitude'], ignition: r['engine.ignition.status'],
        odometer_km: r['vehicle.mileage'] }, 'gps')
    }
    const km = r['vehicle.mileage'] ?? r['can.vehicle.mileage']
    if (km !== undefined) push('odometer', { odometer_km: km }, 'odo')
    const hours = r['can.engine.motorhours'] ?? r['engine.motorhours']
    if (hours !== undefined) push('engine_hours', { engine_hours: hours }, 'eh')
    if (r['can.fuel.level'] !== undefined) push('fuel_level', { level_pct: r['can.fuel.level'] }, 'fuel')
    for (const k of Object.keys(r)) {
      const m = /^tpms\.([^.]+)\.pressure$/.exec(k)
      if (m) push('tpms', { position: m[1], pressure: r[k], pressure_unit: 'bar', temperature_c: r[`tpms.${m[1]}.temperature`] }, `tpms:${m[1]}`)
    }
  }
  return out
}

/**
 * Wialon-style (Wialon Retranslator / remote API message JSON):
 * { unit: "<name or IMEI>", t: unix s, pos: { y: lat, x: lon, s: km/h, c: course, z: alt },
 *   p: { mileage, engine_hours, fuel_level, ... } }. Accepts a single object or an array.
 */
function adaptWialon(body) {
  const recs = Array.isArray(body) ? body : Array.isArray(body?.messages) ? body.messages : [body]
  const out = []
  for (const r of recs) {
    if (!r || typeof r !== 'object') { out.push(r); continue }
    const dev = r.uid ?? r.imei ?? r.unit
    const base = { device_id: dev, recorded_at: r.t, asset: { asset_no: r.unit_name } }
    const idBase = dev && r.t ? `wln:${dev}:${r.t}` : null
    const push = (type, data, s) => out.push({ ...base, type, data, message_id: idBase ? `${idBase}:${s}` : undefined })
    if (r.pos) push('gps', { lat: r.pos.y, lon: r.pos.x, speed_kmh: r.pos.s, heading: r.pos.c, altitude_m: r.pos.z }, 'gps')
    const p = r.p || {}
    if (p.mileage !== undefined) push('odometer', { odometer_km: p.mileage }, 'odo')
    if (p.engine_hours !== undefined) push('engine_hours', { engine_hours: p.engine_hours }, 'eh')
    if (p.fuel_level !== undefined) push('fuel_level', { level_litres: p.fuel_level }, 'fuel')
  }
  return out
}

/**
 * Samsara-style vehicle stats feed / webhook:
 * { data: [ { id, name, externalIds:{ 'samsara.vin': ... }, gps:{ latitude, longitude,
 *   speedMilesPerHour, headingDegrees, time }, obdOdometerMeters:{ value, time },
 *   obdEngineSeconds:{ value, time }, fuelPercent:{ value, time },
 *   faultCodes:{ obdii:{ diagnosticTroubleCodes:[{ code, description }] }, time } } ] }
 * Also accepts { eventType, data:{ vehicle:{...}, ... } } single webhook events.
 */
function adaptSamsara(body) {
  const rows = Array.isArray(body?.data) ? body.data : body?.data?.vehicle ? [{ ...body.data.vehicle, ...body.data }] : [body]
  const out = []
  const one = (v) => (Array.isArray(v) ? v[v.length - 1] : v)
  for (const v of rows) {
    if (!v || typeof v !== 'object') { out.push(v); continue }
    const vin = v.externalIds?.['samsara.vin'] ?? v.vin
    const base = { device_id: v.id ? `samsara:${v.id}` : undefined, asset: { vin, asset_no: v.name } }
    const gps = one(v.gps)
    if (gps) {
      out.push({ ...base, type: 'gps', recorded_at: gps.time, message_id: v.id && gps.time ? `sms:${v.id}:gps:${gps.time}` : undefined,
        data: { lat: gps.latitude, lon: gps.longitude, heading: gps.headingDegrees,
          speed_kmh: gps.speedMilesPerHour === undefined ? undefined : round(Number(gps.speedMilesPerHour) * 1.60934, 1) } })
    }
    const odo = one(v.obdOdometerMeters ?? v.gpsOdometerMeters)
    if (odo && odo.value !== undefined) {
      out.push({ ...base, type: 'odometer', recorded_at: odo.time, message_id: v.id && odo.time ? `sms:${v.id}:odo:${odo.time}` : undefined,
        data: { odometer_km: round(Number(odo.value) / 1000, 1) } })
    }
    const eng = one(v.obdEngineSeconds)
    if (eng && eng.value !== undefined) {
      out.push({ ...base, type: 'engine_hours', recorded_at: eng.time, message_id: v.id && eng.time ? `sms:${v.id}:eh:${eng.time}` : undefined,
        data: { engine_hours: round(Number(eng.value) / 3600, 1) } })
    }
    const fuel = one(v.fuelPercent ?? v.fuelPercents)
    if (fuel && fuel.value !== undefined) {
      out.push({ ...base, type: 'fuel_level', recorded_at: fuel.time, message_id: v.id && fuel.time ? `sms:${v.id}:fuel:${fuel.time}` : undefined,
        data: { level_pct: fuel.value } })
    }
    const fc = one(v.faultCodes)
    for (const c of fc?.obdii?.diagnosticTroubleCodes ?? []) {
      out.push({ ...base, type: 'dtc', recorded_at: fc.time, message_id: v.id && fc.time ? `sms:${v.id}:dtc:${c.code}:${fc.time}` : undefined,
        data: { code: c.code, description: c.description, severity: c.severity } })
    }
  }
  return out
}

const ADAPTERS = { generic: adaptGeneric, teltonika: adaptTeltonika, wialon: adaptWialon, samsara: adaptSamsara }

/** Best-effort vendor guess when the caller did not say. */
export function detectVendor(body) {
  const first = Array.isArray(body) ? body[0] : Array.isArray(body?.data) ? body.data[0] : body
  if (!first || typeof first !== 'object') return 'generic'
  if ('ident' in first || 'position.latitude' in first) return 'teltonika'
  if ('pos' in first && ('t' in first || 'p' in first)) return 'wialon'
  if ('obdOdometerMeters' in first || 'externalIds' in first || body?.eventType) return 'samsara'
  return 'generic'
}

/**
 * Turn any supported payload into { vendor, messages, rejected }.
 * messages: validated canonical messages (with their batch index).
 * rejected: [{ index, type, error }]; these never reach a business table.
 */
export function normalizeBatch(body, { vendor } = {}) {
  const v = VENDORS.includes(vendor) ? vendor : detectVendor(body)
  const raw = ADAPTERS[v](body)
  if (raw.length > MAX_MESSAGES) return { vendor: v, messages: [], rejected: [], error: 'too_many_messages' }
  const messages = []
  const rejected = []
  raw.forEach((r, index) => {
    const res = normalizeMessage(r)
    if (res.ok) messages.push({ index, message: res.message })
    else rejected.push({ index, type: res.type, error: res.error })
  })
  return { vendor: v, messages, rejected }
}

/** Ready-made example payloads per vendor (used by the web test helper and docs). */
export const SAMPLE_PAYLOADS = Object.freeze({
  generic: { messages: [
    { type: 'gps', message_id: 'demo-1', recorded_at: '2026-11-27T08:00:00Z', asset: { asset_no: 'TM514' },
      data: { lat: 24.7136, lon: 46.6753, speed_kmh: 42, heading: 90, ignition: true } },
    { type: 'tpms', message_id: 'demo-2', asset: { asset_no: 'TM514' },
      data: { position: 'LHF1', pressure: 7.2, pressure_unit: 'bar', target_pressure: 120, temperature_c: 54 } },
    { type: 'dtc', message_id: 'demo-3', asset: { asset_no: 'TM514' }, data: { code: 'P0217', description: 'Engine over temperature', severity: 'critical' } },
  ] },
  teltonika: [{ ident: '356307042441013', timestamp: 1764230400, 'position.latitude': 24.71, 'position.longitude': 46.67,
    'position.speed': 38, 'position.direction': 180, 'engine.ignition.status': true, 'vehicle.mileage': 152340.5,
    'can.engine.motorhours': 8123.4, 'tpms.1.pressure': 8.1, 'tpms.1.temperature': 41 }],
  wialon: [{ uid: '356307042441013', unit_name: 'TM514', t: 1764230400, pos: { y: 24.71, x: 46.67, s: 40, c: 90, z: 610 },
    p: { mileage: 152340, engine_hours: 8123 } }],
  samsara: { data: [{ id: '281474976710655', name: 'TM514', externalIds: { 'samsara.vin': 'LZGJL5V40MX000001' },
    gps: { latitude: 24.71, longitude: 46.67, speedMilesPerHour: 25, headingDegrees: 90, time: '2026-11-27T08:00:00Z' },
    obdOdometerMeters: { value: 152340000, time: '2026-11-27T08:00:00Z' } }] },
})
