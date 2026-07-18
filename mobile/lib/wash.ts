/**
 * Vehicle washing service - driver-captured wash records.
 *
 * Reads go direct to Supabase (org / country / site RLS enforced server-side);
 * the WRITE routes through the typed, offline-safe record queue (WASH_RECORD) so
 * a wash logged with no signal is never lost. Mirrors lib/meterLogs.ts.
 */
import { supabase } from './supabase'
import { saveCommand } from './recordQueue'
import { safeUuid } from './ids'

export interface WashRecord {
  id: string
  asset_no: string
  vehicle_type: string | null
  wash_date: string | null
  wash_time: string | null
  wash_type: string | null
  site: string | null
  bay: string | null
  washed_by: string | null
  water_liters: number | null
  cost: number | null
  duration_min: number | null
  odometer_km: number | null
  status: string | null
  notes: string | null
  photos: string[] | null
  created_at: string | null
}

const WASH_COLS =
  'id,asset_no,vehicle_type,wash_date,wash_time,wash_type,site,bay,washed_by,water_liters,cost,duration_min,odometer_km,status,notes,photos,created_at'

/** Local (device-timezone) YYYY-MM-DD so a wash is dated the driver's day. */
export function todayISODate(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

/**
 * Recent wash records (this org, country + site scoped by RLS), newest first.
 * Used both for a recent list and to derive the "due for wash" schedule.
 */
export async function listRecentWashes(limit = 200): Promise<WashRecord[]> {
  const { data, error } = await supabase
    .from('wash_records')
    .select(WASH_COLS)
    .order('wash_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as WashRecord[]
}

/** The two statuses a supervisor picks. Default = first. */
export const WASH_STATUS_CHOICES = ['In Progress', 'Completed'] as const
export type WashStatus = typeof WASH_STATUS_CHOICES[number]

export interface SubmitWashInput {
  assetNo: string
  vehicleType?: string | null
  site?: string | null
  country?: string | null
  createdBy?: string | null
  washedBy?: string | null
  washDate?: string | null
  washType?: string | null
  status?: string | null
  bay?: string | null
  odometerKm?: number | null
  notes?: string | null
  photos?: string[] | null
}

/**
 * Log a vehicle wash. Always dated today (the driver logs a same-day wash).
 * cost / water_liters / duration_min are no longer written (removed per field
 * feedback). Returns whether the record was stored offline (queued for later).
 */
export async function submitWash(input: SubmitWashInput): Promise<{ offline: boolean }> {
  const asset = input.assetNo.trim()
  const date = input.washDate ?? todayISODate()
  const photos = (input.photos ?? []).filter(Boolean)
  const status = input.status?.trim() || 'In Progress'
  // Time is captured automatically at save (local HH:MM), never user-editable.
  const now = new Date()
  const washTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const res = await saveCommand(
    'WASH_RECORD',
    {
      asset_no: asset,
      vehicle_type: input.vehicleType?.trim() || null,
      site: input.site?.trim() || null,
      country: input.country ?? null,
      created_by: input.createdBy ?? null,
      washed_by: input.washedBy?.trim() || null,
      wash_date: date,
      wash_time: washTime,
      wash_type: input.washType?.trim() || null,
      bay: input.bay?.trim() || null,
      odometer_km: input.odometerKm ?? null,
      status,
      notes: input.notes?.trim() || null,
      photos: photos.length ? photos : null,
    },
    // Idempotency: one wash per asset per day from this device (+random suffix
    // so a legitimate second wash the same day still records).
    `wash_${asset}_${date}_${safeUuid().slice(0, 8)}`,
  )

  return { offline: !!res.offline }
}
