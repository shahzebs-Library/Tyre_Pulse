package com.example.tyre_pulse_app.core.network.dto

import kotlinx.serialization.Serializable

/**
 * What actually gets written to the two meter tables.
 *
 * A BUG THIS REPLACES, and it broke odometer logging outright. The old payload was
 * `OdometerLogPayload(asset_no, odometer_km, photo_url)`. There is no `photo_url`
 * column on `odometer_logs` - the real column is `photos`, a text array. The
 * serializer is configured with `encodeDefaults = true` and default `explicitNulls`,
 * so `"photo_url": null` was written on EVERY submission, not just ones carrying a
 * photo, and PostgREST rejects an unknown column outright. So every queued odometer
 * reading failed on sync, silently, after the driver had already walked away.
 *
 * Both payloads below carry only real columns of their table. `ODOMETER_LOG` and
 * `ENGINE_HOURS_LOG` also have allow-lists in SyncRepository now, so a future field
 * added here cannot reach the wire without being a column.
 *
 * UNSET FIELDS ARE SENT AS EXPLICIT NULL, and that is safe HERE specifically. The
 * serializer runs with `encodeDefaults = true` and default `explicitNulls`, so a null
 * property is written as `"site": null` rather than dropped. Every nullable column
 * below is nullable with no DEFAULT, so an explicit null stores exactly what a missing
 * key would have. `reading_date` is the one that would bite - it is nullable with no
 * default, so a null there stores a dateless reading - which is why it is non-null and
 * always supplied by the caller.
 *
 * If a nullable column with a real DEFAULT is ever added here, it must be omitted
 * rather than nulled, because an explicit null SUPPRESSES a column default.
 */
@Serializable
data class OdometerLogPayload(
    val asset_no: String,
    val odometer_km: Long,
    /** ISO yyyy-MM-dd. The column is a DATE with no default, so this is supplied. */
    val reading_date: String,
    val site: String? = null,
    val notes: String? = null,
    /** text[] on the table. An empty list is omitted rather than written as `{}`. */
    val photos: List<String>? = null,
    /** Idempotency key, so a retried queue item cannot double-write. */
    val client_uuid: String? = null,
    /** Names the capture path, matching how the Expo app tags its own rows. */
    val source: String? = "mobile",
)

@Serializable
data class EngineHoursLogPayload(
    val asset_no: String,
    val engine_hours: Long,
    val reading_date: String,
    val site: String? = null,
    val notes: String? = null,
    val photos: List<String>? = null,
    val client_uuid: String? = null,
    val source: String? = "mobile",
)
