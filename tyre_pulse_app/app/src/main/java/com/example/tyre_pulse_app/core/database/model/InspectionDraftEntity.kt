package com.example.tyre_pulse_app.core.database.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "inspection_drafts")
data class InspectionDraftEntity(
    @PrimaryKey val id: String,
    val assetId: String,
    val assetNumber: String,
    val plateNumber: String?,
    val data: String, // JSON serialized Inspection object
    val lastModified: Long,
    val tenantId: String,
    val companyId: String,
    val countryId: String
)
