import { describe, it, expect } from 'vitest'
import { normaliseWeather } from '../lib/api/weather'
import {
  GCC_CITY_COORDS, GCC_CITIES, cityCoords, hottestHours, mergeLiveConditions,
  currentConditions, heatSeverity, pressureIncreasePct, ROAD_SURFACE_DELTA,
} from '../lib/heatIntelligence'

// A trimmed but realistic Open-Meteo forecast payload.
const SAMPLE = {
  latitude: 24.71, longitude: 46.68, timezone: 'Asia/Riyadh',
  current: {
    time: '2026-07-16T12:00',
    temperature_2m: 44.3,
    apparent_temperature: 47.9,
    relative_humidity_2m: 12,
    wind_speed_10m: 18.6,
    weather_code: 0,
  },
  hourly: {
    time: ['2026-07-16T11:00', '2026-07-16T12:00', '2026-07-16T13:00', '2026-07-16T14:00'],
    temperature_2m: [42.0, 44.3, 46.1, 45.0],
  },
  daily: {
    time: ['2026-07-16', '2026-07-17', '2026-07-18'],
    temperature_2m_max: [46.1, 45.4, 47.0],
    temperature_2m_min: [30.2, 29.9, 31.1],
    apparent_temperature_max: [49.8, 48.7, 50.2],
  },
}

describe('normaliseWeather', () => {
  it('maps an Open-Meteo payload into the compact shape', () => {
    const w = normaliseWeather(SAMPLE, new Date('2026-07-16T12:00:00Z'))
    expect(w).not.toBeNull()
    expect(w.ambient_c).toBe(44.3)
    expect(w.apparent_c).toBe(47.9)
    expect(w.humidity_pct).toBe(12)
    expect(w.wind_kmh).toBe(18.6)
    expect(w.source).toBe('Open-Meteo')
    expect(w.hourly).toHaveLength(4)
    expect(w.daily).toHaveLength(3)
    expect(w.daily[0]).toMatchObject({ date: '2026-07-16', max_c: 46.1, min_c: 30.2, apparent_max_c: 49.8 })
  })

  it('returns null when there is no usable current temperature', () => {
    expect(normaliseWeather(null)).toBeNull()
    expect(normaliseWeather({})).toBeNull()
    expect(normaliseWeather({ current: {} })).toBeNull()
    expect(normaliseWeather({ current: { temperature_2m: 'x' } })).toBeNull()
  })

  it('tolerates a missing hourly/daily block', () => {
    const w = normaliseWeather({ current: { temperature_2m: 40, time: 't' } })
    expect(w.ambient_c).toBe(40)
    expect(w.hourly).toEqual([])
    expect(w.daily).toEqual([])
    expect(w.apparent_c).toBeNull()
  })

  it('renders present-but-non-numeric apparent/wind as null, never 0', () => {
    const w = normaliseWeather({ current: { temperature_2m: 40, apparent_temperature: 'NaN', wind_speed_10m: 'calm' } })
    expect(w.apparent_c).toBeNull()
    expect(w.wind_kmh).toBeNull()
  })
})

describe('cityCoords', () => {
  it('has coordinates for every covered GCC city', () => {
    for (const c of GCC_CITIES) {
      const co = cityCoords(c)
      expect(co, c).not.toBeNull()
      expect(co.lat).toBeGreaterThanOrEqual(-90)
      expect(co.lat).toBeLessThanOrEqual(90)
      expect(co.lon).toBeGreaterThanOrEqual(-180)
      expect(co.lon).toBeLessThanOrEqual(180)
    }
    expect(Object.keys(GCC_CITY_COORDS).sort()).toEqual([...GCC_CITIES].sort())
  })

  it('returns null for an unmapped city', () => {
    expect(cityCoords('Atlantis')).toBeNull()
    expect(cityCoords(undefined)).toBeNull()
  })
})

describe('hottestHours', () => {
  const hourly = [
    { time: '2026-07-16T10:00', temp_c: 41 },
    { time: '2026-07-16T13:00', temp_c: 46 },
    { time: '2026-07-16T14:00', temp_c: 45 },
    { time: '2026-07-16T15:00', temp_c: 43 },
  ]
  it('returns the hottest upcoming hours, hottest first, capped at n', () => {
    const res = hottestHours(hourly, 2, new Date('2026-07-16T12:00:00'))
    expect(res.map((h) => h.temp_c)).toEqual([46, 45])
  })
  it('excludes hours already in the past', () => {
    const res = hottestHours(hourly, 5, new Date('2026-07-16T14:30:00'))
    expect(res.map((h) => h.temp_c)).toEqual([43]) // only 15:00 is still ahead
  })
  it('is safe on bad input', () => {
    expect(hottestHours(null)).toEqual([])
    expect(hottestHours(undefined, 3)).toEqual([])
  })
})

describe('mergeLiveConditions', () => {
  it('overlays a live ambient temperature and recomputes derived fields', () => {
    const base = currentConditions('Riyadh', new Date('2026-01-15')) // cool month baseline
    const live = mergeLiveConditions(base, 44, 'Open-Meteo')
    expect(live.ambient_c).toBe(44)
    expect(live.road_surface_c).toBe(44 + ROAD_SURFACE_DELTA)
    expect(live.heat_severity).toBe(heatSeverity(44).severity)
    expect(live.pressure_increase_pct).toBe(pressureIncreasePct(44))
    expect(live.live).toBe(true)
    expect(live.source).toBe('Open-Meteo')
    // preserved from the base
    expect(live.month).toBe(base.month)
    expect(live.all_city_temps).toEqual(base.all_city_temps)
  })

  it('returns the base object unchanged when the live value is not finite', () => {
    const base = currentConditions('Dubai')
    expect(mergeLiveConditions(base, null)).toBe(base)
    expect(mergeLiveConditions(base, 'x')).toBe(base)
    expect(mergeLiveConditions(null, 40)).toBeNull()
  })
})
