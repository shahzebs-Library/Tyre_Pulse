package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Inspection
import retrofit2.http.*

interface InspectionApi {
    @GET("inspections")
    suspend fun getInspections(
        @Query("asset_no") assetNo: String? = null,
        @Query("select") select: String = "*"
    ): List<Inspection>

    @POST("inspections")
    suspend fun submitInspection(@Body inspection: Inspection): Inspection
}
