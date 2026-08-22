package com.example.tyre_pulse_app.core.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.example.tyre_pulse_app.core.network.api.StorageApi
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.File

@HiltWorker
class UploadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val storageApi: StorageApi
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val filePath = inputData.getString("file_path") ?: return Result.failure()
        val bucket = inputData.getString("bucket") ?: "evidence"
        
        return try {
            val file = File(filePath)
            if (!file.exists()) return Result.failure()
            
            val requestFile = okhttp3.RequestBody.create(okhttp3.MediaType.parse("image/jpeg"), file)
            val body = okhttp3.MultipartBody.Part.createFormData("file", file.name, requestFile)
            
            storageApi.uploadFile(bucket, file.name, body)
            
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
}
