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

interface InspectionApi {
    @GET("inspections")
    suspend fun getInspections(
        @Query("asset_no") assetNo: String? = null,
        @Query("select") select: String = "*"
    ): List<Inspection>

    @GET("inspections")
    suspend fun getLastInspection(
        @Query("asset_no") assetNo: String,
        @Query("select") select: String = "inspection_date,document_no",
        @Query("order") order: String = "inspection_date.desc",
        @Query("limit") limit: Int = 1
    ): List<InspectionRecurrenceDto>

    @POST("inspections")
    suspend fun submitInspection(@Body inspection: Inspection): Inspection
}
