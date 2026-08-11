package com.example.tyre_pulse_app.core.network.api

import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.*

interface StorageApi {
    @Multipart
    @POST("storage/v1/object/{bucket}/{path}")
    suspend fun uploadFile(
        @Path("bucket") bucket: String,
        @Path("path") path: String,
        @Part file: MultipartBody.Part
    ): ResponseBody

    @GET("storage/v1/object/public/{bucket}/{path}")
    suspend fun getPublicUrl(
        @Path("bucket") bucket: String,
        @Path("path") path: String
    ): ResponseBody
}
