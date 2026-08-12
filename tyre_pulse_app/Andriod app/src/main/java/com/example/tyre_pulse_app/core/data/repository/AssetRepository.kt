package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.database.dao.AssetDao
import com.example.tyre_pulse_app.core.database.model.AssetEntity
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.network.Pg
import com.example.tyre_pulse_app.core.network.api.AssetApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AssetRepository @Inject constructor(
    private val assetApi: AssetApi,
    private val assetDao: AssetDao,
    private val json: Json
) {
    /**
     * Agent A4: Local-First Scale Logic.
     * Shows 100K local rows instantly via Room, then refreshes from Supabase.
     */
    fun searchAssets(tenantId: String, query: String): Flow<List<Asset>> {
        return assetDao.searchAssets(tenantId, query).map { entities ->
            entities.map { json.decodeFromString<Asset>(it.rawData) }
        }
    }

    suspend fun syncSiteAssets(tenantId: String, siteId: String) {
        try {
            val remoteAssets = assetApi.getAssets(site = Pg.eq(siteId))
            val entities = remoteAssets.map { it.toEntity(tenantId) }
            assetDao.insertAssets(entities)
        } catch (e: Exception) {
            // Silently fail sync, UI uses cached data
        }
    }

    private fun Asset.toEntity(tenantId: String) = AssetEntity(
        id = id,
        assetNumber = assetNumber,
        plateNumber = plateNumber,
        category = category ?: "General",
        type = type ?: "Pickup",
        status = status.name,
        currentKm = currentKm,
        hourMeter = hourMeter,
        tenantId = tenantId,
        companyId = "",
        countryId = "",
        siteId = site,
        latestInspectionDate = latestInspectionDate,
        latestInspectionStatus = latestInspectionStatus,
        rawData = json.encodeToString(this)
    )
}
