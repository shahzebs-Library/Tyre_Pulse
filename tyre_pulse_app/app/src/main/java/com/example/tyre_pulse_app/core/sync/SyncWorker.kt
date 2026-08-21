package com.example.tyre_pulse_app.core.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.delay

class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        return try {
            // Simulate reading from local Room DB and pushing to Supabase
            // e.g. val pendingAccidents = roomDb.accidentDao().getPending()
            //      supabaseClient.post(pendingAccidents)
            delay(1500) // Simulate network delay
            Result.success()
        } catch (e: Exception) {
            // If it fails (e.g. no connection), WorkManager automatically retries later
            Result.retry()
        }
    }
}
