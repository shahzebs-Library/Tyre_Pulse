package com.example.tyre_pulse_app.core.network.api

import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface GenericApi {
    @POST("{table}")
    suspend fun insert(
        @Path("table") table: String,
        @Body body: RequestBody,
        @Header("Prefer") prefer: String = "return=representation"
    ): Response<ResponseBody>

    @PATCH("{table}")
    suspend fun update(
        @Path("table") table: String,
        @QueryMap queries: Map<String, String>,
        @Body body: RequestBody,
        @Header("Prefer") prefer: String = "return=representation"
    ): Response<ResponseBody>
}
