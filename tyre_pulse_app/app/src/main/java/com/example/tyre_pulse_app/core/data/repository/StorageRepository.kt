package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.network.api.StorageApi
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class StorageRepository @Inject constructor(
    private val storageApi: StorageApi
) {
    /**
     * Upload one photo and return the storage path to record against the row.
     *
     * A FAILED UPLOAD THROWS rather than returning a path to nothing: [StorageApi]
     * declares a plain `ResponseBody`, not a `Response<T>`, so Retrofit raises
     * HttpException on any non-2xx. Every caller must therefore catch, and must not
     * write the returned path unless this call actually returned - a path recorded
     * for bytes that never landed is a photo the office can never open.
     *
     * KNOWN GAP, deliberately not changed here because it would alter the shape of
     * paths already stored: the value returned is a bare `<uuid>.jpg` with no bucket
     * and no per-module folder, so every module's photos land in one flat bucket
     * root and a stored path does not say which bucket to read it back from. The
     * Expo app scopes each upload by module and stores a `tp-storage://` reference
     * that carries the bucket with it. Aligning this needs the readers changed in
     * the same pass.
     */
    suspend fun uploadPhoto(byteArray: ByteArray, bucket: String = "tyre-photos"): String {
        val fileName = "${UUID.randomUUID()}.jpg"
        val requestBody = byteArray.toRequestBody("image/jpeg".toMediaTypeOrNull())
        val part = MultipartBody.Part.createFormData("file", fileName, requestBody)
        
        storageApi.uploadFile(bucket, fileName, part)
        
        // Return the path for DB storage
        return fileName
    }
}
