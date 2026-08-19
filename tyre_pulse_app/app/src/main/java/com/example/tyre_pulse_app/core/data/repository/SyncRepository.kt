package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.database.dao.SyncDao
import com.example.tyre_pulse_app.core.database.model.SyncOperationEntity
import com.example.tyre_pulse_app.core.network.api.GenericApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SyncRepository @Inject constructor(
    private val syncDao: SyncDao,
    private val genericApi: GenericApi,
    private val json: Json
) {
    /**
     * Agent 1: Typed Offline Command Queue.
     * Mirrors Expo recordQueue.ts exactly. Exposes clean enqueue.
     */
    suspend fun <T> enqueueCommand(
        type: String,
        payload: T,
        tenantId: String = "00000000-0000-0000-0000-000000000001",
        companyId: String = "",
        countryId: String = "",
        siteId: String? = null,
        userId: String = ""
    ): Result<Boolean> {
        return try {
            val jsonPayload = when (payload) {
                is String -> payload
                else -> json.encodeToString(payload as Any)
            }

            // Strip any forbidden fields based on command type (optional schema sanitization)
            val sanitizedPayload = sanitizePayloadFields(type, jsonPayload)

            val entity = SyncOperationEntity(
                id = UUID.randomUUID().toString(),
                operationType = type,
                payload = sanitizedPayload,
                tenantId = tenantId,
                companyId = companyId,
                countryId = countryId,
                siteId = siteId,
                userId = userId,
                createdAt = System.currentTimeMillis(),
                attemptCount = 0,
                status = "QUEUED",
                lastError = null
            )
            syncDao.enqueue(entity)
            Result.success(true)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Periodically processes all pending operations in the sync queue.
     * Marks syncing status, calls Supabase dynamically, and updates Room database state.
     */
    suspend fun processPendingOperations() {
        val operations = syncDao.getPendingOperations().firstOrNull() ?: return
        if (operations.isEmpty()) return

        for (op in operations) {
            // 1. Mark status as SYNCING
            syncDao.updateOperation(op.copy(status = "SYNCING"))

            try {
                val tableName = getTableName(op.operationType)
                val mediaType = "application/json; charset=utf-8".toMediaType()
                val requestBody = op.payload.toRequestBody(mediaType)

                val response = if (isUpdateOperation(op.operationType)) {
                    val recordId = extractIdFromPayload(op.payload)
                    if (recordId != null) {
                        val queries = mapOf("id" to "eq.$recordId")
                        genericApi.update(tableName, queries, requestBody)
                    } else {
                        genericApi.insert(tableName, requestBody)
                    }
                } else {
                    genericApi.insert(tableName, requestBody)
                }

                if (response.isSuccessful) {
                    // 2. Successful sync -> delete from queue
                    syncDao.deleteOperation(op)
                } else {
                    // 3. Request failed -> update status to FAILED
                    val errorMsg = response.errorBody()?.string() ?: response.message()
                    syncDao.updateOperation(
                        op.copy(
                            status = "FAILED",
                            attemptCount = op.attemptCount + 1,
                            lastError = errorMsg
                        )
                    )
                }
            } catch (e: Exception) {
                // 4. Network or parsing failure
                syncDao.updateOperation(
                    op.copy(
                        status = "FAILED",
                        attemptCount = op.attemptCount + 1,
                        lastError = e.message ?: "Unknown local error"
                    )
                )
            }
        }
    }

    private fun getTableName(operationType: String): String {
        return when (operationType.uppercase()) {
            "TYRE_CHANGE" -> "tyre_records"
            "WORK_ORDER" -> "work_orders"
            "RCA" -> "rca_records"
            "REPORT_ISSUE" -> "corrective_actions"
            "CHECKLIST_SUBMISSION" -> "checklist_submissions"
            "ODOMETER_LOG" -> "odometer_logs"
            "REPORT_ACCIDENT" -> "accidents"
            "WASH_RECORD" -> "wash_records"
            "WORKSHOP_EVENT" -> "workshop_events"
            else -> operationType.lowercase()
        }
    }

    private fun isUpdateOperation(operationType: String): Boolean {
        return when (operationType.uppercase()) {
            "STOCK_ADJUST", "WORK_ORDER_STATUS", "CORRECTIVE_ACTION_STATUS" -> true
            else -> false
        }
    }

    private fun extractIdFromPayload(payload: String): String? {
        return try {
            val jsonObject = JSONObject(payload)
            jsonObject.optString("id")
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Sanitizes payloads by removing unknown fields, matching Expo's fields lists.
     */
    private fun sanitizePayloadFields(type: String, rawJson: String): String {
        return try {
            val originalObj = JSONObject(rawJson)
            val allowedFields = when (type.uppercase()) {
                "TYRE_CHANGE" -> listOf(
                    "asset_no", "serial_no", "serial_number", "tyre_serial", "brand", "size",
                    "site", "country", "cost_per_tyre", "qty", "position", "tyre_position",
                    "km_at_fitment", "km_at_removal", "hrs_at_fitment", "hrs_at_removal",
                    "tread_depth", "removal_reason", "removal_date", "fitment_date", "issue_date",
                    "status", "risk_level", "category", "photos"
                )
                "WORK_ORDER" -> listOf(
                    "work_order_no", "asset_no", "tyre_serial", "status", "priority",
                    "work_type", "description", "technician_name", "site", "country",
                    "opened_at", "labour_cost", "parts_cost", "total_cost", "notes", "created_by"
                )
                "RCA" -> listOf(
                    "asset_no", "tyre_serial", "brand", "site", "region",
                    "failure_date", "km_at_failure", "root_cause", "contributing_factors",
                    "photos", "corrective_action_id", "created_by", "country"
                )
                "REPORT_ISSUE" -> listOf(
                    "title", "priority", "site", "region", "description", "assigned_to",
                    "status", "root_cause", "asset_no", "tyre_serial", "created_by",
                    "country", "due_date", "photos"
                )
                "WASH_RECORD" -> listOf("asset_no", "driver_name", "date", "status", "site")
                "WORKSHOP_EVENT" -> listOf("id", "job_id", "technician_name", "event_type", "timestamp")
                else -> null
            } ?: return rawJson

            val sanitizedObj = JSONObject()
            for (key in allowedFields) {
                if (originalObj.has(key)) {
                    sanitizedObj.put(key, originalObj.get(key))
                }
            }
            sanitizedObj.toString()
        } catch (e: Exception) {
            rawJson
        }
    }

    fun getPendingCount(): Flow<Int> {
        return syncDao.getPendingOperations().map { list ->
            list.filter { it.status == "QUEUED" || it.status == "FAILED" }.size
        }
    }
}
