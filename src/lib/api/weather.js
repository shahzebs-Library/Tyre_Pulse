/**
 * Weather service: live ambient temperature from Open-Meteo, a free, keyless,
 * CORS-enabled public API (https://open-meteo.com). Heat Intelligence uses it to
 * ground the tyre heat model in real conditions instead of seasonal averages.
 *
 * Design choices:
 *  - No API key and no Supabase. This is a public HTTP source, not our database,
 *    so it does not go through the src/lib/api/_client.js Supabase layer.
 *  - Results are cached in localStorage per rounded coordinate for one hour, so a
 *    dashboard covering a handful of locations makes at most one request per
 *    location per hour (low volume, cost free).
 *  - Every failure path returns { ok: false, error } instead of throwing, so the
 *    caller can fall back to offline climatology and never shows a broken screen
 *    or a fabricated number.
 */

const BASE = 'https://api.open-meteo.com/v1/forecast'
const CACHE_PREFIX = 'tp.weather.v1.'
const TTL_MS = 60 * 60 * 1000 // one hour

const round1 = (v) => Math.round(v * 10) / 10
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
// Strict variant: null/undefined/'' are treated as missing (null), not coerced
// to 0 the way Number() would. Used by the air-quality mapping and band helper.
const snum = (v) => (v == null || v === '' ? null : num(v))

function cacheKey(lat, lon) {
  return `${CACHE_PREFIX}${lat.toFixed(3)},${lon.toFixed(3)}`
}

function readCache(key) {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || (Date.now() - parsed.at) > TTL_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache(key, data) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
    }
  } catch {
    /* storage full or unavailable: caching is best effort only */
  }
}

/**
 * Map a raw Open-Meteo forecast response to our compact shape. Pure and
 * defensive: returns null when the payload lacks a usable current temperature.
 */
export function normaliseWeather(raw, now = new Date()) {
  const cur = raw && raw.current
  const ambient = cur ? num(cur.temperature_2m) : null
  if (ambient == null) return null

  const daily = []
  const d = raw.daily
  if (d && Array.isArray(d.time)) {
    for (let i = 0; i < d.time.length; i += 1) {
      daily.push({
        date: d.time[i],
        max_c: num(d.temperature_2m_max?.[i]),
        min_c: num(d.temperature_2m_min?.[i]),
        apparent_max_c: num(d.apparent_temperature_max?.[i]),
        uv_index_max: num(d.uv_index_max?.[i]),
      })
    }
  }

  const hourly = []
  const h = raw.hourly
  if (h && Array.isArray(h.time)) {
    for (let i = 0; i < h.time.length; i += 1) {
      const t = num(h.temperature_2m?.[i])
      if (t != null) hourly.push({ time: h.time[i], temp_c: t })
    }
  }

  const apparent = num(cur.apparent_temperature)
  const wind = num(cur.wind_speed_10m)
  const gusts = num(cur.wind_gusts_10m)
  const precip = num(cur.precipitation)
  // UV comes from the current block when present, otherwise today's daily max.
  const uv = num(cur.uv_index) ?? num(daily[0]?.uv_index_max)
  return {
    ambient_c: round1(ambient),
    apparent_c: apparent != null ? round1(apparent) : null,
    humidity_pct: num(cur.relative_humidity_2m),
    wind_kmh: wind != null ? round1(wind) : null,
    wind_gusts_kmh: gusts != null ? round1(gusts) : null,
    precipitation_mm: precip != null ? round1(precip) : null,
    uv_index: uv != null ? round1(uv) : null,
    weather_code: num(cur.weather_code),
    observed_at: cur.time || null,
    daily,
    hourly,
    source: 'Open-Meteo',
    fetched_at: (now instanceof Date ? now : new Date(now)).toISOString(),
  }
}

/**
 * Fetch live weather for a coordinate. Returns { ok: true, data, cached } on
 * success or { ok: false, error } on any failure. Never throws.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {{ signal?: AbortSignal, force?: boolean }} [opts]
 */
export async function getCurrentWeather(lat, lon, { signal, force = false } = {}) {
  const la = num(lat)
  const lo = num(lon)
  if (la == null || lo == null || la < -90 || la > 90 || lo < -180 || lo > 180) {
    return { ok: false, error: 'No mapped coordinates for this location.' }
  }

  const key = cacheKey(la, lo)
  if (!force) {
    const hit = readCache(key)
    if (hit) return { ok: true, data: hit, cached: true }
  }

  const params = new URLSearchParams({
    latitude: String(la),
    longitude: String(lo),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,uv_index,weather_code',
    hourly: 'temperature_2m',
    daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,uv_index_max',
    timezone: 'auto',
    forecast_days: '7',
    wind_speed_unit: 'kmh',
  })

  try {
    const res = await fetch(`${BASE}?${params.toString()}`, { signal })
    if (!res.ok) return { ok: false, error: `Weather service returned ${res.status}.` }
    const raw = await res.json()
    const data = normaliseWeather(raw)
    if (!data) return { ok: false, error: 'Weather service returned no usable reading.' }
    writeCache(key, data)
    return { ok: true, data, cached: false }
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, error: 'aborted', aborted: true }
    return { ok: false, error: 'Live weather is unavailable right now.' }
  }
}

/**
 * Air Quality service: PM2.5, PM10, dust and UV from the Open-Meteo Air Quality
 * API (https://open-meteo.com/en/docs/air-quality-api), also free, keyless and
 * CORS-enabled. High airborne dust and particulates are a real GCC fleet concern
 * (tyre and filter abrasion), so surfacing them beside the heat model is useful.
 * Same rules as the weather service: one-hour localStorage cache per rounded
 * coordinate and never throws (returns { ok, data } or { ok: false, error }).
 */
const AQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const AQ_CACHE_PREFIX = 'tp.aq.v1.'

function aqCacheKey(lat, lon) {
  return `${AQ_CACHE_PREFIX}${lat.toFixed(3)},${lon.toFixed(3)}`
}

/**
 * Map a raw Open-Meteo air-quality response to a compact shape. Pure and
 * defensive: returns null when the payload carries no usable current block.
 */
export function normaliseAirQuality(raw) {
  const cur = raw && raw.current
  if (!cur || typeof cur !== 'object') return null
  const pm2_5 = snum(cur.pm2_5)
  const pm10 = snum(cur.pm10)
  const dust = snum(cur.dust)
  const uv = snum(cur.uv_index)
  const aqi = snum(cur.european_aqi)
  // No usable pollutant reading at all means we have nothing honest to show.
  if (pm2_5 == null && pm10 == null && dust == null && uv == null && aqi == null) return null
  return {
    pm2_5: pm2_5 != null ? round1(pm2_5) : null,
    pm10: pm10 != null ? round1(pm10) : null,
    dust: dust != null ? round1(dust) : null,
    uv: uv != null ? round1(uv) : null,
    aqi: aqi != null ? Math.round(aqi) : null,
    observed_at: cur.time || null,
    source: 'Open-Meteo',
  }
}

/**
 * European AQI band helper. Plain ASCII labels; severity keys mirror the heat
 * palette (low is best, extreme is worst) so the UI can colour it consistently.
 * @param {number|null|undefined} aqi
 * @returns {{ label: string, severity: string }|null}
 */
export function aqiBand(aqi) {
  const v = snum(aqi)
  if (v == null) return null
  if (v < 20) return { label: 'Good', severity: 'low' }
  if (v < 40) return { label: 'Fair', severity: 'moderate' }
  if (v < 60) return { label: 'Moderate', severity: 'high' }
  if (v < 80) return { label: 'Poor', severity: 'very_high' }
  if (v < 100) return { label: 'Very Poor', severity: 'extreme' }
  return { label: 'Extremely Poor', severity: 'extreme' }
}

/**
 * Fetch live air quality for a coordinate. Returns { ok: true, data, cached } on
 * success or { ok: false, error } on any failure. Never throws.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {{ signal?: AbortSignal, force?: boolean }} [opts]
 */
export async function getAirQuality(lat, lon, { signal, force = false } = {}) {
  const la = num(lat)
  const lo = num(lon)
  if (la == null || lo == null || la < -90 || la > 90 || lo < -180 || lo > 180) {
    return { ok: false, error: 'No mapped coordinates for this location.' }
  }

  const key = aqCacheKey(la, lo)
  if (!force) {
    const hit = readCache(key)
    if (hit) return { ok: true, data: hit, cached: true }
  }

  const params = new URLSearchParams({
    latitude: String(la),
    longitude: String(lo),
    current: 'pm10,pm2_5,dust,uv_index,european_aqi',
    timezone: 'auto',
  })

  try {
    const res = await fetch(`${AQ_BASE}?${params.toString()}`, { signal })
    if (!res.ok) return { ok: false, error: `Air quality service returned ${res.status}.` }
    const raw = await res.json()
    const data = normaliseAirQuality(raw)
    if (!data) return { ok: false, error: 'Air quality service returned no usable reading.' }
    writeCache(key, data)
    return { ok: true, data, cached: false }
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, error: 'aborted', aborted: true }
    return { ok: false, error: 'Live air quality is unavailable right now.' }
  }
}
