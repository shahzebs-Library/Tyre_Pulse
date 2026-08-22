package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.RemovalReason
import com.example.tyre_pulse_app.core.model.Tyre
import com.example.tyre_pulse_app.core.model.TyreHistoryEvent
import retrofit2.http.GET
import retrofit2.http.Path
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

    @GET("tyre_history") // Verify table name from schema
    suspend fun getTyreHistory(
        @Query("tyre_id") id: String,
        @Query("select") select: String = "*"
    ): List<TyreHistoryEvent>

    @GET("lookup_reasons")
    suspend fun getRemovalReasons(
        @Query("type") type: String = "eq.removal",
        @Query("select") select: String = "*"
    ): List<RemovalReason>
}
