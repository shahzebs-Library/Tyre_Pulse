package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Tyre
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.PATCH
import retrofit2.http.Query

interface TyreApi {
    @GET("tyre_records")
    suspend fun getTyres(
        @Query("serial_no") query: String? = null,
        @Query("status") status: String? = null,
        @Query("brand") brand: String? = null,
        @Query("site") site: String? = null,
        @Query("select") select: String = "*"
    ): List<Tyre>

    @GET("tyre_records")
    suspend fun getTyre(
        @Query("id") id: String,
        @Query("select") select: String = "*"
    ): List<Tyre>

    /**
     * There is no separate `tyre_history` table in the real schema. A
     * tyre's lifecycle is reconstructed from every tyre_records row that
     * shares its serial_no (a tyre can be fitted/removed/refitted across
     * assets and positions over time).
     */
    @GET("tyre_records")
    suspend fun getTyresBySerial(
        @Query("serial_no") serialNo: String,
        @Query("select") select: String = "*"
    ): List<Tyre>

    /**
     * Partial update, e.g. marking a tyre removed or fitted. `Prefer:
     * return=representation` is required or PostgREST replies 204 with no
     * body, which the JSON converter cannot decode as List<Tyre>.
     */
    @Headers("Prefer: return=representation")
    @PATCH("tyre_records")
    suspend fun patchTyre(
        @Query("id") id: String,
        @Body patch: JsonObject
    ): List<Tyre>
}
