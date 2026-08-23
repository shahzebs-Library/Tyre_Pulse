package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Inspection
import retrofit2.http.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

@Serializable
data class InspectionRecurrenceDto(
    @SerialName("inspection_date") val inspectionDate: String? = null,
    @SerialName("document_no") val documentNo: String? = null
)

/** Just the key, for counting rows without pulling them. */
@Serializable
data class InspectionIdDto(val id: String? = null)

interface InspectionApi {
    @GET("inspections")
    suspend fun getInspections(
        @Query("asset_no") assetNo: String? = null,
        @Query("select") select: String = "*"
    ): List<Inspection>

    @GET("inspections")
    suspend fun getLastInspection(
        @Query("asset_no") assetNo: String,
        @Query("select") select: String,
        @Query("order") order: String,
        @Query("limit") limit: Int
    ): List<InspectionRecurrenceDto>

    /**
     * Ids only, for a headline count.
     *
     * Bounded on purpose: this feeds a dashboard tile, and an unbounded read of a
     * growing table to show one number is not worth the round trip. The caller states
     * the cap rather than presenting a capped number as exact.
     */
    @GET("inspections")
    suspend fun countByStatus(
        @Query("status") statusEq: String,
        @Query("select") select: String = "id",
        @Query("limit") limit: Int = 200,
    ): List<InspectionIdDto>

    @POST("inspections")
    suspend fun submitInspection(@Body inspection: Inspection): Inspection
}
