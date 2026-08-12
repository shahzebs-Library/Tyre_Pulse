package com.example.tyre_pulse_app.core.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.WorkerParameters
import com.example.tyre_pulse_app.core.data.repository.StorageRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.File

@HiltWorker
class UploadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val storageRepository: StorageRepository
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val filePath = inputData.getString("file_path") ?: return Result.failure()
        val bucket = inputData.getString("bucket") ?: "evidence"

        return try {
            val file = File(filePath)
            if (!file.exists()) return Result.failure()

            val storedPath = storageRepository.uploadPhoto(file.readBytes(), bucket)
            Result.success(Data.Builder().putString("stored_path", storedPath).build())
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
}
