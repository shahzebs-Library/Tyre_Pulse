/**
 * Meter logs service — daily driver-captured odometer (km) and engine-hour
 * readings for fleets without telematics (e.g. Egypt). Reads go direct to
 * Supabase (RLS/country enforced server-side); the WRITE routes through the
 * typed, offline-safe record queue so a reading captured with no signal is
 * never lost. Odometer readings feed vehicle_fleet.current_km via a V213
 * trigger, so "actual current km" stays authoritative.
 */
import { supabase } from './supabase'
import { saveCommand } from './recordQueue'
import { safeUuid } from './ids'

export interface MeterReading {
  id: string
  asset_no: string
  odometer_km: number | null
  reading_date: string | null
  site: string | null
  source: string | null
  notes: string | null
  photos: string[] | null
  created_at: string | null
}

export interface LastReading {
  odometer_km: number | null
  reading_date: string | null
}

const ODO_COLS = 'id,asset_no,odometer_km,reading_date,site,source,notes,photos,created_at'

/** Local (device-timezone) YYYY-MM-DD so a reading is dated the driver's day. */
export function todayISODate(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

/** The most recent odometer reading for an asset (for validation + display). */
export async function getLastOdometer(assetNo: string): Promise<LastReading | null> {
  const a = assetNo.trim()
  if (!a) return null
  const { data, error } = await supabase
    .from('odometer_logs')
    .select('odometer_km,reading_date,created_at')
    .eq('asset_no', a)
    .not('odometer_km', 'is', null)
    .order('reading_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data || !data.length) return null
  return { odometer_km: data[0].odometer_km, reading_date: data[0].reading_date }
}

/** Recent meter readings (this org, country-scoped by RLS), newest first. */
export async function listRecentReadings(limit = 50): Promise<MeterReading[]> {
  const { data, error } = await supabase
    .from('odometer_logs')
    .select(ODO_COLS)
    .order('reading_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as MeterReading[]
}

export interface SubmitMeterInput {
  assetNo: string
  site?: string | null
  country?: string | null
  createdBy?: string | null
  readingDate?: string | null
  odometerKm: number
  odometerPhoto?: string | null
  /** Optional engine-hour reading captured alongside the odometer. */
  engineHours?: number | null
  hoursPhoto?: string | null
  notes?: string | null
  /** Optional self-contained SVG signature (from SignaturePad), stored as text. */
  signature?: string | null
}

/**
 * Log a daily meter reading. Always writes an odometer row; writes a second
 * engine-hours row only when an hours value is supplied. Each row carries its
 * own gauge photo through the queue's photo pipeline. Returns whether anything
 * was stored offline.
 */
export async function submitMeterReading(input: SubmitMeterInput): Promise<{ offline: boolean }> {
  const asset = input.assetNo.trim()
  const date = input.readingDate ?? todayISODate()
  const signature = input.signature?.trim() || null
  const base = {
    asset_no: asset,
    reading_date: date,
    source: 'Mobile',
    site: input.site?.trim() || null,
    country: input.country ?? null,
    created_by: input.createdBy ?? null,
    notes: input.notes?.trim() || null,
    // Only include the column when a signature was actually drawn; otherwise
    // omit it entirely so the row is written without it (queue sanitize()
    // drops undefined keys).
    ...(signature ? { signature } : {}),
  }

  let offline = false

  const odo = await saveCommand(
    'ODOMETER_LOG',
    {
      ...base,
      odometer_km: input.odometerKm,
      photos: input.odometerPhoto ? [input.odometerPhoto] : null,
    },
    // Idempotency: one reading per asset per day from this device.
    `odo_${asset}_${date}_${safeUuid().slice(0, 8)}`,
  )
  offline = offline || !!odo.offline

  if (input.engineHours != null && !Number.isNaN(input.engineHours)) {
    const hrs = await saveCommand(
      'ENGINE_HOURS_LOG',
      {
        ...base,
        engine_hours: input.engineHours,
        photos: input.hoursPhoto ? [input.hoursPhoto] : null,
      },
      `hrs_${asset}_${date}_${safeUuid().slice(0, 8)}`,
    )
    offline = offline || !!hrs.offline
  }

  return { offline }
}
