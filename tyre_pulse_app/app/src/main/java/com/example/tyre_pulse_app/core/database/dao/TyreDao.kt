package com.example.tyre_pulse_app.core.database.dao

import androidx.room.*
import com.example.tyre_pulse_app.core.database.model.TyreEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface TyreDao {
    @Query("SELECT * FROM tyres WHERE tenantId = :tenantId AND (serialNumber LIKE '%' || :query || '%' OR brand LIKE '%' || :query || '%')")
    fun searchTyres(tenantId: String, query: String): Flow<List<TyreEntity>>

    @Query("SELECT * FROM tyres WHERE id = :id")
    suspend fun getTyreById(id: String): TyreEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTyres(tyres: List<TyreEntity>)

    @Query("DELETE FROM tyres WHERE tenantId = :tenantId")
    suspend fun clearTyres(tenantId: String)
}
