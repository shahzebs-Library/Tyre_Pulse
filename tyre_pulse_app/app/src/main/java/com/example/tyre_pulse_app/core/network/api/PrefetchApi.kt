package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Asset
import retrofit2.http.GET
import retrofit2.http.Query

/**
 * Agent 40: Proactive Sync API.
 * Downloads large site datasets for offline usage.
 */
interface PrefetchApi {
    @GET("vehicle_fleet")
    suspend fun prefetchSiteAssets(
        @Query("site") siteId: String,
        @Query("limit") limit: Int = 1000
    ): List<Asset>
}
