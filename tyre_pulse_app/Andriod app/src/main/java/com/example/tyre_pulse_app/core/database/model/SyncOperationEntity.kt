package com.example.tyre_pulse_app.core.database.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sync_queue")
data class SyncOperationEntity(
    @PrimaryKey val id: String,
    val operationType: String, // e.g., "SUBMIT_INSPECTION", "REPORT_ACCIDENT"
    val payload: String, // JSON serialized data
    val tenantId: String,
    val companyId: String,
    val countryId: String,
    val siteId: String?,
    val userId: String,
    val createdAt: Long,
    val attemptCount: Int = 0,
    val status: String = "QUEUED", // "QUEUED", "SYNCING", "FAILED"
    val lastError: String? = null
)
