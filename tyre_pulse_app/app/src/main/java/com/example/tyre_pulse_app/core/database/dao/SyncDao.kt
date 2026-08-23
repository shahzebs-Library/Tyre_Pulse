package com.example.tyre_pulse_app.core.database.dao

import androidx.room.*
import com.example.tyre_pulse_app.core.database.model.SyncOperationEntity
import kotlinx.coroutines.flow.Flow

/**
 * The offline write queue.
 *
 * STATUS VOCABULARY, and it is load-bearing:
 *  - QUEUED  waiting for a drain. An item that failed a previous attempt sits
 *            here too, so a lost signal heals itself on the next pass.
 *  - SYNCING in flight RIGHT NOW, for the duration of one request only.
 *  - FAILED  parked for a human: the retry budget is spent, or the server refused
 *            it in a way that retrying cannot change.
 *
 * There is no SYNCED state - a row is DELETED the moment the server accepts it.
 * [clearSynced] therefore matches nothing and is kept only because removing a DAO
 * method is not this file's job.
 */
@Dao
interface SyncDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueue(item: SyncOperationEntity)

    @Query("SELECT * FROM sync_queue WHERE status = 'QUEUED' ORDER BY createdAt ASC")
    fun getPendingOperations(): Flow<List<SyncOperationEntity>>

    /**
     * One-shot snapshot for a drain pass.
     *
     * A Flow is the wrong shape for draining: the drain mutates the very rows the
     * query watches, so collecting it re-emits mid-pass. Oldest first, so a record
     * cannot be overtaken by a later one.
     */
    @Query("SELECT * FROM sync_queue WHERE status = 'QUEUED' ORDER BY createdAt ASC")
    suspend fun getQueuedOnce(): List<SyncOperationEntity>

    @Query("SELECT COUNT(*) FROM sync_queue WHERE status = 'FAILED'")
    fun getFailedCount(): Flow<Int>

    /** Everything the server has not accepted yet, whatever stage it is at. */
    @Query("SELECT COUNT(*) FROM sync_queue WHERE status IN ('QUEUED', 'SYNCING', 'FAILED')")
    fun getUnsyncedCount(): Flow<Int>

    /**
     * Hand back anything left mid-flight by a drain that died.
     *
     * SYNCING is only ever set for the length of one request, so a row still in
     * that state when a pass starts can only be a leftover from a process that was
     * killed - doze, a crash, the user swiping the app away. Without this it stayed
     * SYNCING for ever: invisible to the drain AND to the pending count, so the
     * technician's record silently ceased to exist. Safe because the caller
     * serialises drains, so no live pass can own such a row.
     */
    @Query("UPDATE sync_queue SET status = 'QUEUED' WHERE status = 'SYNCING'")
    suspend fun reclaimStuckSyncing(): Int

    /**
     * Put every parked item back in the queue with a fresh budget.
     *
     * The error is cleared with it: leaving the old message on a row that is about
     * to be tried again would report a failure that has not happened yet.
     */
    @Query("UPDATE sync_queue SET status = 'QUEUED', attemptCount = 0, lastError = NULL WHERE status = 'FAILED'")
    suspend fun requeueFailed(): Int

    @Update
    suspend fun updateOperation(item: SyncOperationEntity)

    @Delete
    suspend fun deleteOperation(item: SyncOperationEntity)

    @Query("DELETE FROM sync_queue WHERE status = 'SYNCED'")
    suspend fun clearSynced()

    @Query("DELETE FROM sync_queue WHERE id = :id")
    suspend fun deleteById(id: String)
}
