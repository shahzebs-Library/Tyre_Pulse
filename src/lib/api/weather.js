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
  return {
    ambient_c: round1(ambient),
    apparent_c: apparent != null ? round1(apparent) : null,
    humidity_pct: num(cur.relative_humidity_2m),
    wind_kmh: wind != null ? round1(wind) : null,
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
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code',
    hourly: 'temperature_2m',
    daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max',
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
