package com.example.tyre_pulse_app.core.network.api

import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.*

/**
 * Supabase Storage lives at <project>/storage/v1/, NOT under /rest/v1/. This API is
 * therefore built on its own Retrofit with the SUPABASE_URL base - mounted on the
 * PostgREST base it resolved to /rest/v1/storage/v1/object/... and every upload and
 * download 404d.
 *
 * The object path is marked encoded because it contains slashes (folder/file.jpg);
 * Retrofit would otherwise escape them to %2F and address a different object.
 */
interface StorageApi {
    @Multipart
    @POST("storage/v1/object/{bucket}/{path}")
    suspend fun uploadFile(
        @Path("bucket") bucket: String,
        @Path("path", encoded = true) path: String,
        @Part file: MultipartBody.Part
    ): ResponseBody

    @GET("storage/v1/object/public/{bucket}/{path}")
    suspend fun getPublicUrl(
        @Path("bucket") bucket: String,
        @Path("path", encoded = true) path: String
    ): ResponseBody
}
