package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.database.dao.SyncDao
import com.example.tyre_pulse_app.core.database.model.SyncEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SyncRepository @Inject constructor(
    private val syncDao: SyncDao
) {
    /**
     * Agent 1: Typed Offline Command Queue.
     * Mirrors Expo recordQueue.ts exactly.
     */
    suspend fun <T> enqueueCommand(type: String, payload: T): Result<Boolean> {
        return try {
            val jsonPayload = when(payload) {
                is String -> payload
                else -> Json.encodeToString(payload as Any)
            }
            
            val entity = SyncEntity(
                id = UUID.randomUUID().toString(),
                type = type,
                payload = jsonPayload,
                status = "pending",
                createdAt = System.currentTimeMillis()
            )
            syncDao.insert(entity)
            Result.success(true)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun getPendingCount(): Flow<Int> = syncDao.getPendingCount()
}
