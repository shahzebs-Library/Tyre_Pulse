import { describe, it, expect } from 'vitest'
import { normaliseWeather, normaliseAirQuality, aqiBand } from '../lib/api/weather'

describe('normaliseWeather extra fields', () => {
  it('maps wind gusts, precipitation and current uv additively', () => {
    const raw = {
      current: {
        time: '2026-07-16T12:00',
        temperature_2m: 44.3,
        apparent_temperature: 47.9,
        relative_humidity_2m: 12,
        wind_speed_10m: 18.6,
        wind_gusts_10m: 32.4,
        precipitation: 0.2,
        uv_index: 9.8,
        weather_code: 0,
      },
      daily: {
        time: ['2026-07-16'],
        temperature_2m_max: [46.1],
        temperature_2m_min: [30.2],
        apparent_temperature_max: [49.8],
        uv_index_max: [11.2],
      },
    }
    const w = normaliseWeather(raw)
    // existing contract intact
    expect(w.ambient_c).toBe(44.3)
    expect(w.humidity_pct).toBe(12)
    expect(w.wind_kmh).toBe(18.6)
    // new additive fields
    expect(w.wind_gusts_kmh).toBe(32.4)
    expect(w.precipitation_mm).toBe(0.2)
    expect(w.uv_index).toBe(9.8) // current uv wins
    expect(w.daily[0].uv_index_max).toBe(11.2)
  })

  it('falls back to daily uv max when current uv is absent', () => {
    const w = normaliseWeather({
      current: { temperature_2m: 40, time: 't' },
      daily: { time: ['2026-07-16'], uv_index_max: [10.5] },
    })
    expect(w.uv_index).toBe(10.5)
  })

  it('renders missing extra fields as null, never 0', () => {
    const w = normaliseWeather({ current: { temperature_2m: 40, time: 't' } })
    expect(w.wind_gusts_kmh).toBeNull()
    expect(w.precipitation_mm).toBeNull()
    expect(w.uv_index).toBeNull()
    // unchanged null-only contract for temperature
    expect(w.ambient_c).toBe(40)
  })

  it('still returns null when ambient temperature is missing', () => {
    expect(normaliseWeather({ current: { uv_index: 9 } })).toBeNull()
  })
})

describe('normaliseAirQuality', () => {
  it('maps the pollutant fields into the compact shape', () => {
    const raw = {
      current: {
        time: '2026-07-16T12:00',
        pm2_5: 38.6,
        pm10: 142.9,
        dust: 210.4,
        uv_index: 9.1,
        european_aqi: 63.7,
      },
    }
    const aq = normaliseAirQuality(raw)
    expect(aq).not.toBeNull()
    expect(aq.pm2_5).toBe(38.6)
    expect(aq.pm10).toBe(142.9)
    expect(aq.dust).toBe(210.4)
    expect(aq.uv).toBe(9.1)
    expect(aq.aqi).toBe(64) // rounded
    expect(aq.source).toBe('Open-Meteo')
  })

  it('is null-safe: non-numeric fields become null, not 0', () => {
    const aq = normaliseAirQuality({ current: { pm2_5: 12, pm10: 'x', dust: null, european_aqi: 25 } })
    expect(aq.pm2_5).toBe(12)
    expect(aq.pm10).toBeNull()
    expect(aq.dust).toBeNull()
    expect(aq.uv).toBeNull()
    expect(aq.aqi).toBe(25)
  })

  it('returns null when there is no usable current block', () => {
    expect(normaliseAirQuality(null)).toBeNull()
    expect(normaliseAirQuality({})).toBeNull()
    expect(normaliseAirQuality({ current: {} })).toBeNull()
    expect(normaliseAirQuality({ current: { pm2_5: 'x', pm10: 'y' } })).toBeNull()
  })
})

describe('aqiBand', () => {
  it('maps European AQI thresholds to labels', () => {
    expect(aqiBand(0)).toEqual({ label: 'Good', severity: 'low' })
    expect(aqiBand(19)).toEqual({ label: 'Good', severity: 'low' })
    expect(aqiBand(20)).toEqual({ label: 'Fair', severity: 'moderate' })
    expect(aqiBand(39)).toEqual({ label: 'Fair', severity: 'moderate' })
    expect(aqiBand(40)).toEqual({ label: 'Moderate', severity: 'high' })
    expect(aqiBand(59)).toEqual({ label: 'Moderate', severity: 'high' })
    expect(aqiBand(60)).toEqual({ label: 'Poor', severity: 'very_high' })
    expect(aqiBand(79)).toEqual({ label: 'Poor', severity: 'very_high' })
    expect(aqiBand(80)).toEqual({ label: 'Very Poor', severity: 'extreme' })
    expect(aqiBand(99)).toEqual({ label: 'Very Poor', severity: 'extreme' })
    expect(aqiBand(100)).toEqual({ label: 'Extremely Poor', severity: 'extreme' })
    expect(aqiBand(180)).toEqual({ label: 'Extremely Poor', severity: 'extreme' })
  })

  it('returns null for a missing or non-numeric value', () => {
    expect(aqiBand(null)).toBeNull()
    expect(aqiBand(undefined)).toBeNull()
    expect(aqiBand('x')).toBeNull()
  })
})
