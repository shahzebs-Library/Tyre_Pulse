package com.example.tyre_pulse_app.core.network.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Query

/**
 * The last recorded meter reading for an asset, from public.odometer_logs.
 *
 * WHY THIS EXISTS. The odometer screen validates that a new reading is higher than
 * the previous one - a meter does not run backwards. It had no way to fetch that
 * previous reading, so the screen simply defaulted to a hard-coded 124,500 km and
 * validated every entry against a number nobody had recorded.
 */
@Serializable
data class OdometerReadingDto(
    @SerialName("asset_no") val assetNo: String? = null,
    @SerialName("odometer_km") val odometerKm: Double? = null,
    @SerialName("reading_date") val readingDate: String? = null,
) {
    companion object {
        const val SELECT = "asset_no,odometer_km,reading_date"
    }
}

interface OdometerApi {
    /**
     * Newest reading first. Callers take the first row; an empty list means this asset
     * has no recorded reading yet, which is a real answer and not an error.
     */
    @GET("odometer_logs")
    suspend fun getLatestReading(
        @Query("asset_no") assetNoEq: String,
        @Query("select") select: String = OdometerReadingDto.SELECT,
        @Query("order") order: String = "reading_date.desc.nullslast",
        @Query("limit") limit: Int = 1,
    ): List<OdometerReadingDto>
}
