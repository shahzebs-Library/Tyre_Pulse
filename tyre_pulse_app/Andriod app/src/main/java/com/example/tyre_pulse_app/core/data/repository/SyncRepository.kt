package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.database.dao.SyncDao
import com.example.tyre_pulse_app.core.database.model.SyncOperationEntity
import com.example.tyre_pulse_app.core.model.Inspection
import com.example.tyre_pulse_app.core.network.api.InspectionApi
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SyncRepository @Inject constructor(
    private val syncDao: SyncDao,
    private val inspectionApi: InspectionApi,
    private val json: Json
) {
    suspend fun processPendingOperations() {
        val pending = syncDao.getPendingOperations().first()
        pending.forEach { operation ->
            try {
                syncDao.updateOperation(operation.copy(status = "SYNCING"))
                
                when (operation.operationType) {
                    "SUBMIT_INSPECTION" -> {
                        val inspection = json.decodeFromString<Inspection>(operation.payload)
                        inspectionApi.submitInspection(inspection)
                    }
                }
                
                syncDao.deleteOperation(operation)
            } catch (e: Exception) {
                syncDao.updateOperation(
                    operation.copy(
                        status = "FAILED",
                        attemptCount = operation.attemptCount + 1,
                        lastError = e.message
                    )
                )
            }
        }
    }

    suspend fun enqueueInspection(inspection: Inspection, tenantId: String, companyId: String, countryId: String, userId: String) {
        val entity = SyncOperationEntity(
            id = inspection.id ?: java.util.UUID.randomUUID().toString(),
            operationType = "SUBMIT_INSPECTION",
            payload = json.encodeToString(Inspection.serializer(), inspection),
            tenantId = tenantId,
            companyId = companyId,
            countryId = countryId,
            siteId = inspection.site,
            userId = userId,
            createdAt = System.currentTimeMillis()
        )
        syncDao.enqueue(entity)
    }
}
