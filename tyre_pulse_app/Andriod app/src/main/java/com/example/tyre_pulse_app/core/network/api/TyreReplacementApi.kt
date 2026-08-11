package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.RemovalReason
import com.example.tyre_pulse_app.core.model.TyreReplacementRequest
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface TyreReplacementApi {
    @GET("replacements/reasons")
    suspend fun getRemovalReasons(): List<RemovalReason>

    @POST("replacements")
    suspend fun submitReplacementRequest(@Body request: TyreReplacementRequest): TyreReplacementRequest

    @GET("replacements/{id}")
    suspend fun getReplacementRequest(@Path("id") id: String): TyreReplacementRequest
}
