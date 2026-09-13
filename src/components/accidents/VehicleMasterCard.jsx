/**
 * VehicleMasterCard — the full fleet-master field set for ONE vehicle, matching
 * (field-for-field) the "Overview" card on the Flutter app's canonical vehicle
 * detail screen (tyre_pulse_flutter/lib/features/assets/presentation/
 * vehicle_detail_screen.dart), so a reporter confirming an asset here sees the
 * same real data the field team sees there. Verified against the live
 * vehicle_fleet column definitions (MASTER_MIGRATION.sql / MIGRATIONS_V6.sql)
 * before building this - every field below maps to a genuine column.
 *
 * ONE DELIBERATE DIFFERENCE FROM FLUTTER: Flutter's field list also shows
 * "Region", but `vehicle_fleet` has NO region column anywhere in this repo's
 * migration history - region is recorded ONCE, on the sites register
 * (sites.region), never duplicated onto vehicle_fleet (see src/lib/api/sites.js
 * siteRegionMap/regionForSite). Selecting a non-existent column would fail the
 * whole query, so Region is intentionally left off here rather than guessed at
 * or silently reproduced from a field that may not really exist on the Flutter
 * side either.
 *
 * `asset` is a `vehicle_fleet` row shaped by assets.js's exported `COLS` - the
 * ONE column list every full-vehicle-record reader in this app now shares.
 */
const km = (v) => (v == null ? null : `${Number(v).toLocaleString()} km`)

// [label, resolver, {always}] - always:false rows only render when the value
// is present, matching Flutter's conditional rows (serial/engine/capacity/
// ops status) exactly.
const ROWS = [
  ['Fleet number', (a) => a.fleet_number, true],
  ['Type', (a) => a.vehicle_type, true],
  ['Make and model', (a) => [a.make, a.model].filter(Boolean).join(' '), true],
  ['Year', (a) => a.year, true],
  ['Current odometer', (a) => km(a.current_km), true],
  ['Operator', (a) => a.operator_name, true],
  ['Department', (a) => a.department, true],
  ['Site', (a) => a.site, true],
  ['Country', (a) => a.country, true],
  ['Tyre size', (a) => a.tyre_size, true],
  ['Registration', (a) => a.registration_no, true],
  ['Equipment serial', (a) => a.serial_no, false],
  ['Engine number', (a) => a.engine_no, false],
  ['Capacity', (a) => a.capacity, false],
  ['Operational status', (a) => a.ops_status, false],
]

export default function VehicleMasterCard({ asset }) {
  if (!asset) return null
  const rows = ROWS
    .map(([label, get, always]) => {
      const value = get(asset)
      const present = value != null && String(value).trim() !== ''
      return { label, value, show: always || present }
    })
    .filter((r) => r.show)

  return (
    <div className="rounded-lg border border-[var(--input-border)] divide-y divide-[var(--input-border)]">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
          <span className="text-[var(--text-muted)]">{label}</span>
          <span className="text-[var(--text-primary)] font-medium text-right">
            {value != null && String(value).trim() !== '' ? value : 'N/A'}
          </span>
        </div>
      ))}
    </div>
  )
}
