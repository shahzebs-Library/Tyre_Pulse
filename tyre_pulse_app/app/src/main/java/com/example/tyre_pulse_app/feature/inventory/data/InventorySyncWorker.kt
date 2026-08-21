package com.example.tyre_pulse_app.feature.inventory.data

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ListenableWorker
import androidx.work.WorkerParameters
import com.example.tyre_pulse_app.core.network.api.GenericApi
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody

@HiltWorker
class InventorySyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val genericApi: GenericApi
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): ListenableWorker.Result = withContext(Dispatchers.IO) {
        try {
            Log.d("InventorySync", "Starting offline inventory sync...")
            // In a real app, you would fetch these from Room. 
            // For now, we simulate fetching the pending deductions.
            val unsyncedDeductions = listOf("PART:hydraulic_pump_v2", "PART:heavy_duty_tyre_22.5")
            
            if (unsyncedDeductions.isEmpty()) {
                Log.d("InventorySync", "No items to sync.")
                return@withContext ListenableWorker.Result.success()
            }

            // Push to Supabase backend via PostgREST
            unsyncedDeductions.forEach { part ->
                Log.d("InventorySync", "Syncing deduction for $part to cloud...")
                
                // Assuming we have an inventory_transactions table
                val partId = part.substringAfter("PART:")
                val jsonPayload = """
                    {
                        "part_id": "$partId",
                        "transaction_type": "deduction",
                        "quantity": 1,
                        "timestamp": "${System.currentTimeMillis()}"
                    }
                """.trimIndent()
                
                val requestBody = jsonPayload.toRequestBody("application/json".toMediaTypeOrNull())
                val response = genericApi.insert(
                    table = "inventory_transactions",
                    body = requestBody
                )
                
                if (!response.isSuccessful) {
                    val errorBody = response.errorBody()?.string()
                    Log.e("InventorySync", "Failed to sync $part. Code: ${response.code()}, Error: $errorBody")
                    throw Exception("API call failed with code ${response.code()}")
                }
            }
            
            Log.d("InventorySync", "Inventory sync complete!")
            ListenableWorker.Result.success()
        } catch (e: Exception) {
            Log.e("InventorySync", "Sync failed: ${e.message}")
            ListenableWorker.Result.retry()
        }
    }
}
