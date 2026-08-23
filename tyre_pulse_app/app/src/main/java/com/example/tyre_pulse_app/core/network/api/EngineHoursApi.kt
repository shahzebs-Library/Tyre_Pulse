package com.example.tyre_pulse_app.core.network.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Query

/**
 * The last recorded engine-hour reading for an asset, from public.engine_hours_logs.
 *
 * WHY THIS EXISTS. The app had no engine-hours path at all - no API, no sync command,
 * no working screen - while the Expo app it replaces has recorded 4,379 of these
 * readings. That is not a cosmetic gap: hour-measured plant (pumps, generators,
 * loaders, and a large share of the transit-mixer fleet) carries no usable odometer,
 * so engine hours is the ONLY meter those machines have. Without this, a fitter
 * standing at a generator could not record a reading at all.
 *
 * Deliberately a byte-for-byte mirror of OdometerApi. The two tables are structurally
 * identical apart from the reading column (`engine_hours` vs `odometer_km`), so any
 * divergence here would be accidental rather than meaningful.
 */
@Serializable
data class EngineHoursReadingDto(
    @SerialName("asset_no") val assetNo: String? = null,
    @SerialName("engine_hours") val engineHours: Double? = null,
    @SerialName("reading_date") val readingDate: String? = null,
) {
    companion object {
        const val SELECT = "asset_no,engine_hours,reading_date"
    }
}

interface EngineHoursApi {
    /**
     * Newest reading first. Callers take the first row; an empty list means this asset
     * has no recorded reading yet, which is a real answer and not an error.
     */
    @GET("engine_hours_logs")
    suspend fun getLatestReading(
        @Query("asset_no") assetNoEq: String,
        @Query("select") select: String = EngineHoursReadingDto.SELECT,
        @Query("order") order: String = "reading_date.desc.nullslast",
        @Query("limit") limit: Int = 1,
    ): List<EngineHoursReadingDto>
}
