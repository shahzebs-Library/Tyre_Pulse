package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.WashRecord
import retrofit2.http.*

interface WashApi {
    @GET("wash_records")
    suspend fun getWashRecords(
        @Query("site") site: String? = null,
        @Query("asset_no") assetNo: String? = null,
        @Query("order") order: String = "wash_date.desc,created_at.desc"
    ): List<WashRecord>

    @POST("wash_records")
    suspend fun logWash(@Body record: WashRecord): WashRecord
}
