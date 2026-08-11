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
    suspend fun uploadPhoto(byteArray: ByteArray, bucket: String = "tyre-photos"): String {
        val fileName = "${UUID.randomUUID()}.jpg"
        val requestBody = byteArray.toRequestBody("image/jpeg".toMediaTypeOrNull())
        val part = MultipartBody.Part.createFormData("file", fileName, requestBody)
        
        storageApi.uploadFile(bucket, fileName, part)
        
        // Return the path for DB storage
        return fileName
    }
}
