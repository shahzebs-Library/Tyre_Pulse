package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.database.dao.AssetDao
import com.example.tyre_pulse_app.core.model.Inspection
import com.example.tyre_pulse_app.core.network.api.InspectionApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

import com.example.tyre_pulse_app.core.database.dao.DraftDao
import com.example.tyre_pulse_app.core.database.model.DraftEntity
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString

@Singleton
class InspectionRepository @Inject constructor(
    private val inspectionApi: InspectionApi,
    private val draftDao: DraftDao,
    private val json: Json
) {
    suspend fun getDraft(assetId: String): Inspection? {
        return draftDao.getDraft(assetId)?.let {
            json.decodeFromString<Inspection>(it.data)
        }
    }

    suspend fun saveDraft(assetId: String, inspection: Inspection) {
        val entity = DraftEntity(
            id = assetId,
            type = "INSPECTION",
            data = json.encodeToString(inspection)
        )
        draftDao.saveDraft(entity)
    }

    suspend fun submitInspection(inspection: Inspection): Result<Unit> {
        return try {
            inspectionApi.submitInspection(inspection)
            draftDao.deleteDraft(inspection.assetId)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
