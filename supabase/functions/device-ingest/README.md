# device-ingest

Status: authored, not deployed. Needs migration `20261127120000_device_ingest.sql` applied first, then
`supabase functions deploy device-ingest --no-verify-jwt`.

`POST /functions/v1/device-ingest[?vendor=generic|teltonika|wialon|samsara]`
Header `x-device-key: tpd_xxxxxxxxxx.<secret>` (or `Authorization: Bearer <key>`). JSON body, at most 512 KB and 500 messages.

Keys are minted by an Admin in Devices & Integrations. A key is shown once, stored only as a sha256 hash, belongs to one
organisation, lists the data types it may send, can be bound to one registered device, and can be revoked.

## Canonical message (vendor `generic`)

```json
{ "messages": [
  { "type": "tpms", "message_id": "unit7-2026-11-27T08:00:00Z-LHF1", "recorded_at": "2026-11-27T08:00:00Z",
    "device_id": "356307042441013", "asset": { "asset_no": "TM514", "country": "KSA" },
    "data": { "position": "LHF1", "pressure": 7.2, "pressure_unit": "bar", "target_pressure": 120, "temperature_c": 54 } }
] }
```

| type | data fields (units) | written to |
|---|---|---|
| gps | lat, lon, speed_kmh, heading, altitude_m, ignition, odometer_km | gps_positions (+ vehicle_fleet location) |
| odometer | odometer_km | odometer_logs, source `telematics` (moves current_km) |
| engine_hours | engine_hours | engine_hours_logs, source `telematics` |
| tpms | position or sensor_id, pressure (+ pressure_unit psi/bar/kpa), target_pressure, temperature_c | tpms_readings, source `sensor` |
| tread | depth_mm, position, tyre_serial | tread_depth_readings |
| fuel_level | level_pct and/or level_litres | fuel_level_readings |
| fuel_transaction | litres, amount, currency, station, receipt_no, odometer_km | fuel_transactions |
| dtc | code, description, system, severity info/warning/critical | dtc_codes (an already active code is not duplicated) |
| rfid | tag_id (or epc), reader_id, site | rfid_tag_events action `read` (+ rfid_tags.last_scanned_at) |
| dashcam | event_type, severity, location, speed_kmh, driver_name, video_url (https only) | dashcam_events |

Asset matching, in order: the device the key is bound to, a registered device id / IMEI, asset code, VIN or chassis,
registration plate. `asset.country` narrows the search. More than one match is never guessed: the reading goes to
Unmatched readings as `ambiguous_asset`; no match goes there as `unknown_asset`. An Admin matches it in one click and
the stored reading is saved then.

`message_id` is the idempotency key. Without one the server hashes the message, so an identical resend is a duplicate.
A rejected message never blocks a corrected retry.

Response: `{ vendor, accepted, duplicates, quarantined, rejected, results: [{ index, status, error?, reason? }] }`.
Errors: 400 bad_json / too_many_messages / empty_batch, 401 invalid_key, 405, 413 too_large, 429 rate_limited
(per key per minute, plus a per-address brake on bad keys), 503 temporarily_unavailable. No internals are returned.

## Vendor adapters (`supabase/functions/_shared/deviceIngest.js`)

- **teltonika**: flespi-style flat JSON records (`ident`, `timestamp` unix s, `position.latitude/longitude/speed/
  direction/altitude`, `engine.ignition.status`, `vehicle.mileage` km, `can.engine.motorhours`, `can.fuel.level` %,
  `tpms.<n>.pressure` bar / `tpms.<n>.temperature`). One record fans out into gps, odometer, engine hours, fuel and
  tpms messages. Point a flespi stream (HTTP) at the endpoint with `?vendor=teltonika`.
- **wialon**: message JSON `{ uid|imei|unit, unit_name, t, pos:{y,x,s,c,z}, p:{ mileage, engine_hours, fuel_level } }`.
  Use a Wialon retranslator / webhook relay that posts JSON with `?vendor=wialon`.
- **samsara**: vehicle stats feed `{ data:[{ id, name, externalIds['samsara.vin'], gps, obdOdometerMeters,
  obdEngineSeconds, fuelPercent, faultCodes.obdii.diagnosticTroubleCodes }] }` or a single webhook event. Metres become
  km, seconds become hours, mph becomes km/h.
- **generic**: the canonical format above.

Alerts: TPMS under/over/critical (thresholds in Alert settings), critical DTC and dashcam collisions raise an in-app
notification to the organisation's Admins and super admins, once per alert per repeat window (default 6 h).
