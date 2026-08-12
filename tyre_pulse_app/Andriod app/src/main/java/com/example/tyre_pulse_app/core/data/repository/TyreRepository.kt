package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.database.dao.TyreDao
import com.example.tyre_pulse_app.core.database.model.TyreEntity
import com.example.tyre_pulse_app.core.model.RemovalReason
import com.example.tyre_pulse_app.core.model.ReplacementStatus
import com.example.tyre_pulse_app.core.model.Tyre
import com.example.tyre_pulse_app.core.model.TyreHistoryEvent
import com.example.tyre_pulse_app.core.model.TyreReplacementRequest
import com.example.tyre_pulse_app.core.model.TyreStatus
import com.example.tyre_pulse_app.core.network.Pg
import com.example.tyre_pulse_app.core.network.api.TyreApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TyreRepository @Inject constructor(
    private val tyreApi: TyreApi,
    private val tyreDao: TyreDao,
    private val json: Json
) {
    fun searchTyres(tenantId: String, query: String): Flow<List<Tyre>> {
        return tyreDao.searchTyres(tenantId, query).map { entities ->
            entities.map { json.decodeFromString<Tyre>(it.rawData) }
        }
    }

    suspend fun refreshTyres(tenantId: String, query: String) {
        val remoteTyres = tyreApi.getTyres(query = Pg.ilike(query))
        val entities = remoteTyres.map { it.toEntity() }
        tyreDao.insertTyres(entities)
    }

    suspend fun getTyre(id: String): Tyre {
        val local = tyreDao.getTyreById(id)
        if (local != null) {
            return json.decodeFromString<Tyre>(local.rawData)
        }
        val remote = tyreApi.getTyre(eqFilter(id)).first()
        tyreDao.insertTyres(listOf(remote.toEntity()))
        return remote
    }

    /**
     * The real schema has no tyre_history table - a tyre's lifecycle is the
     * set of tyre_records rows sharing its serial_no (fitted/removed/
     * refitted across assets over time). This reconstructs fit/removal
     * events from those rows instead of a nonexistent endpoint.
     */
    suspend fun getTyreHistory(id: String): List<TyreHistoryEvent> {
        val tyre = getTyre(id)
        val siblings = tyreApi.getTyresBySerial(serialNo = eqFilter(tyre.serialNumber))
        val events = mutableListOf<TyreHistoryEvent>()
        siblings.forEach { row ->
            row.issueDate?.let { date ->
                events += TyreHistoryEvent(
                    id = "${row.id}-fitted",
                    tyreId = id,
                    type = "FITTED",
                    date = date,
                    assetNumber = row.currentAssetNumber,
                    position = row.position,
                    kmReading = row.installationKm,
                    reason = null,
                    notes = row.jobCard?.let { "Job card: $it" }
                )
            }
            row.removalDate?.let { date ->
                events += TyreHistoryEvent(
                    id = "${row.id}-removed",
                    tyreId = id,
                    type = "REMOVED",
                    date = date,
                    assetNumber = row.currentAssetNumber,
                    position = row.position,
                    kmReading = row.removalKm,
                    reason = row.removalReason,
                    notes = row.totalKm?.let { "Distance run: $it km" }
                )
            }
        }
        return events.sortedByDescending { it.date }
    }

    suspend fun getRemovalReasons(): List<RemovalReason> {
        // tyre_records.removal_reason is free text, not a lookup table, so
        // there is no server catalog to fetch - this curated list matches
        // the removal-reason vocabulary used across the fleet's records.
        return listOf(
            RemovalReason("1", "Worn Out"),
            RemovalReason("2", "Puncture"),
            RemovalReason("3", "Sidewall Damage"),
            RemovalReason("4", "Tread Separation"),
            RemovalReason("5", "Blast/Burst"),
            RemovalReason("6", "Alignment"),
            RemovalReason("7", "Replaced")
        )
    }

    /**
     * A replacement is two real writes against tyre_records - there is no
     * dedicated "replacements" table. The removed tyre's exit is recorded,
     * and if a new tyre was fitted in the same position, its entry is too.
     */
    suspend fun submitReplacementRequest(request: TyreReplacementRequest): TyreReplacementRequest {
        val removalPatch = buildJsonObject {
            put("status", JsonPrimitive(TyreStatus.REMOVED.name))
            put("km_at_removal", JsonPrimitive(request.removalKm))
            request.removalReason.takeIf { it.isNotBlank() }?.let {
                put("removal_reason", JsonPrimitive(it))
            }
            // removal_date is deliberately omitted when not supplied by the
            // caller - never invent a date the user did not confirm.
            request.requestedDate?.takeIf { it.isNotBlank() }?.let {
                put("removal_date", JsonPrimitive(it))
            }
        }
        tyreApi.patchTyre(id = eqFilter(request.removedTyreId), patch = removalPatch)

        request.installedTyreId?.let { newTyreId ->
            val fitmentPatch = buildJsonObject {
                put("status", JsonPrimitive(TyreStatus.FITTED.name))
                put("asset_no", JsonPrimitive(request.assetId))
                put("position", JsonPrimitive(request.position))
                request.installationKm?.let { put("km_at_fitment", JsonPrimitive(it)) }
            }
            tyreApi.patchTyre(id = eqFilter(newTyreId), patch = fitmentPatch)
        }

        return request.copy(status = ReplacementStatus.INSTALLED)
    }

    /** `Pg.eq` returns null only for a blank input; ids passed here are never blank. */
    private fun eqFilter(id: String): String = Pg.eq(id) ?: "eq.$id"

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
