package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Accident
import com.example.tyre_pulse_app.core.model.Claim
import retrofit2.http.*

interface AccidentApi {
    @GET("accidents")
    suspend fun getAccidents(
        @Query("status") status: String? = null,
        @Query("assetId") assetId: String? = null,
        @Query("page") page: Int = 0,
        @Query("pageSize") pageSize: Int = 20
    ): List<Accident>

    @GET("accidents/{id}")
    suspend fun getAccident(@Path("id") id: String): Accident

    @POST("accidents")
    suspend fun reportAccident(@Body accident: Accident): Accident

    @POST("accidents/{id}/claims")
    suspend fun fileClaim(@Path("id") id: String, @Body claim: Claim): Claim
}
