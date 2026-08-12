package com.example.tyre_pulse_app.core.database.dao

import androidx.room.*
import com.example.tyre_pulse_app.core.database.model.AssetEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface AssetDao {
    @Query("SELECT * FROM assets WHERE tenantId = :tenantId AND (assetNumber LIKE '%' || :query || '%' OR plateNumber LIKE '%' || :query || '%')")
    fun searchAssets(tenantId: String, query: String): Flow<List<AssetEntity>>

    @Query("SELECT * FROM assets WHERE id = :id AND tenantId = :tenantId")
    suspend fun getAssetById(id: String, tenantId: String): AssetEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAssets(assets: List<AssetEntity>)

    @Query("DELETE FROM assets WHERE tenantId = :tenantId")
    suspend fun clearAssets(tenantId: String)
}
