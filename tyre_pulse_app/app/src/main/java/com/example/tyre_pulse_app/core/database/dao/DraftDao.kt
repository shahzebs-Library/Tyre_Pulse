package com.example.tyre_pulse_app.core.database.dao

import androidx.room.*
import com.example.tyre_pulse_app.core.database.model.DraftEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DraftDao {
    @Query("SELECT * FROM drafts WHERE id = :id")
    suspend fun getDraft(id: String): DraftEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveDraft(draft: DraftEntity)

    @Query("DELETE FROM drafts WHERE id = :id")
    suspend fun deleteDraft(id: String)

    @Query("SELECT * FROM drafts WHERE type = :type")
    fun getAllDraftsByType(type: String): Flow<List<DraftEntity>>
}
