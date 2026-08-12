package com.example.tyre_pulse_app.core.database.dao

import androidx.room.*
import com.example.tyre_pulse_app.core.database.model.SyncOperationEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SyncDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueue(item: SyncOperationEntity)

    @Query("SELECT * FROM sync_queue WHERE status = 'QUEUED' ORDER BY createdAt ASC")
    fun getPendingOperations(): Flow<List<SyncOperationEntity>>

    @Query("SELECT COUNT(*) FROM sync_queue WHERE status = 'FAILED'")
    fun getFailedCount(): Flow<Int>

    @Update
    suspend fun updateOperation(item: SyncOperationEntity)

    @Delete
    suspend fun deleteOperation(item: SyncOperationEntity)

    @Query("DELETE FROM sync_queue WHERE status = 'SYNCED'")
    suspend fun clearSynced()
    
    @Query("DELETE FROM sync_queue WHERE id = :id")
    suspend fun deleteById(id: String)
}
