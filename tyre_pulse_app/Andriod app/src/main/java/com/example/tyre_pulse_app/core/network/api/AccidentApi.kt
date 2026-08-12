package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Accident
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Query

interface AccidentApi {
    @GET("accidents")
    suspend fun getAccidents(
        @Query("status") status: String? = null,
        @Query("asset_no") assetNo: String? = null,
        @Query("limit") limit: Int = 20,
        @Query("offset") offset: Int = 0,
        @Query("order") order: String = "incident_date.desc",
        @Query("select") select: String = "*"
    ): List<Accident>

    @GET("accidents")
    suspend fun getAccident(
        @Query("id") id: String,
        @Query("select") select: String = "*"
    ): List<Accident>

    @Headers("Prefer: return=representation")
    @POST("accidents")
    suspend fun reportAccident(@Body accident: Accident): List<Accident>

    /**
     * Claim data lives ON the accidents row (claim_amount, insurer,
     * claim_status...) - there is no `accidents/{id}/claims` child
     * collection in the real schema, only a flat PATCH.
     */
    @Headers("Prefer: return=representation")
    @PATCH("accidents")
    suspend fun updateAccident(
        @Query("id") id: String,
        @Body patch: JsonObject
    ): List<Accident>
}
