package com.example.tyre_pulse_app.core.database.dao

import androidx.room.*
import com.example.tyre_pulse_app.core.database.model.SyncItemEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SyncDao {
    @Insert
    suspend fun enqueue(item: SyncItemEntity)

    @Query("SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY timestamp ASC")
    fun getPendingItems(): Flow<List<SyncItemEntity>>

    @Update
    suspend fun updateSyncStatus(item: SyncItemEntity)

    @Query("DELETE FROM sync_queue WHERE status = 'SYNCED'")
    suspend fun clearSynced()
}
