package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.database.dao.TyreDao
import com.example.tyre_pulse_app.core.database.model.TyreEntity
import com.example.tyre_pulse_app.core.model.RemovalReason
import com.example.tyre_pulse_app.core.model.Tyre
import com.example.tyre_pulse_app.core.model.TyreHistoryEvent
import com.example.tyre_pulse_app.core.model.TyreReplacementRequest
import com.example.tyre_pulse_app.core.network.api.TyreApi
import com.example.tyre_pulse_app.core.network.api.TyreReplacementApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TyreRepository @Inject constructor(
    private val tyreApi: TyreApi,
    private val tyreReplacementApi: TyreReplacementApi,
    private val tyreDao: TyreDao,
    private val json: Json
) {
    fun searchTyres(tenantId: String, query: String): Flow<List<Tyre>> {
        return tyreDao.searchTyres(tenantId, query).map { entities ->
            entities.map { json.decodeFromString<Tyre>(it.rawData) }
        }
    }

    suspend fun refreshTyres(tenantId: String, query: String) {
        val remoteTyres = tyreApi.getTyres(query = query)
        val entities = remoteTyres.map { it.toEntity() }
        tyreDao.insertTyres(entities)
    }

    suspend fun getTyre(id: String): Tyre {
        val local = tyreDao.getTyreById(id)
        if (local != null) {
            return json.decodeFromString<Tyre>(local.rawData)
        }
        val remote = tyreApi.getTyre(id).first()
        tyreDao.insertTyres(listOf(remote.toEntity()))
        return remote
    }

    suspend fun getTyreHistory(id: String): List<TyreHistoryEvent> {
        return tyreApi.getTyreHistory(id)
    }

    suspend fun getRemovalReasons(): List<RemovalReason> {
        // Mocking removal reasons if API not ready, or use the one from web
        return listOf(
            RemovalReason("1", "Worn Out"),
            RemovalReason("2", "Puncture"),
            RemovalReason("3", "Sidewall Damage"),
            RemovalReason("4", "Tread Separation")
        )
    }

    suspend fun submitReplacementRequest(request: TyreReplacementRequest): TyreReplacementRequest {
        return tyreReplacementApi.submitReplacementRequest(request)
    }

    private fun Tyre.toEntity() = TyreEntity(
        id = id,
        serialNumber = serialNumber,
        brand = brand,
        pattern = pattern ?: "",
        size = size ?: "",
        status = status.name,
        tenantId = tenantId ?: "00000000-0000-0000-0000-000000000001",
        companyId = "",
        countryId = "",
        siteId = site,
        rawData = json.encodeToString(this)
    )
}
