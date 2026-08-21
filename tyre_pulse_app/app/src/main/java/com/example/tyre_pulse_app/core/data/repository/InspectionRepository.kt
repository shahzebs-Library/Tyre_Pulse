package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Inspection
import com.example.tyre_pulse_app.core.network.api.InspectionApi
import com.example.tyre_pulse_app.core.network.api.InspectionRecurrenceDto
import com.example.tyre_pulse_app.core.database.dao.DraftDao
import com.example.tyre_pulse_app.core.database.model.DraftEntity
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class InspectionRepository @Inject constructor(
    private val inspectionApi: InspectionApi,
    private val draftDao: DraftDao,
    private val json: Json
) {
    suspend fun getDraft(assetNumber: String): Inspection? {
        return draftDao.getDraft(assetNumber)?.let {
            json.decodeFromString<Inspection>(it.data)
        }
    }

    suspend fun saveDraft(assetNumber: String, inspection: Inspection) {
        val entity = DraftEntity(
            id = assetNumber,
            type = "INSPECTION",
            data = json.encodeToString(inspection)
        )
        draftDao.saveDraft(entity)
    }

    suspend fun submitInspection(inspection: Inspection): Result<Unit> {
        return try {
            inspectionApi.submitInspection(inspection)
            draftDao.deleteDraft(inspection.assetNumber)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun checkRecurrence(assetNumber: String): Result<InspectionRecurrenceDto?> {
        return try {
            val res = inspectionApi.getLastInspection(
                assetNo = "eq.$assetNumber",
                select = "inspection_date,document_no",
                order = "inspection_date.desc",
                limit = 1
            )
            Result.success(res.firstOrNull())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
