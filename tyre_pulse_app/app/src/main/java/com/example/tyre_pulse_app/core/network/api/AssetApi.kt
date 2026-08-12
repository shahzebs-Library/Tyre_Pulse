package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Asset
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Query

interface AssetApi {
    @GET("vehicle_fleet")
    suspend fun getAssets(
        @Header("Range") range: String? = null,
        @Query("asset_no") assetNumber: String? = null,
        @Query("status") status: String? = null,
        @Query("site") site: String? = null,
        @Query("select") select: String = "*"
    ): List<Asset>

    @GET("vehicle_fleet")
    suspend fun getAsset(
        @Query("id") id: String,
        @Query("select") select: String = "*"
    ): List<Asset>
}
