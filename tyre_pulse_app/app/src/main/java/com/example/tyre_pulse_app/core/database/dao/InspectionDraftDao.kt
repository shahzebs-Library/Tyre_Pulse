package com.example.tyre_pulse_app.core.database.dao

import androidx.room.*
import com.example.tyre_pulse_app.core.database.model.InspectionDraftEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface InspectionDraftDao {
    @Query("SELECT * FROM inspection_drafts WHERE tenantId = :tenantId ORDER BY lastModified DESC")
    fun getDrafts(tenantId: String): Flow<List<InspectionDraftEntity>>

    @Query("SELECT * FROM inspection_drafts WHERE id = :id")
    suspend fun getDraftById(id: String): InspectionDraftEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveDraft(draft: InspectionDraftEntity)

    @Query("DELETE FROM inspection_drafts WHERE id = :id")
    suspend fun deleteDraft(id: String)
}
