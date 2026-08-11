package com.example.tyre_pulse_app.core.database.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "drafts")
data class DraftEntity(
    @PrimaryKey val id: String, // assetId or temp UUID
    val type: String, // "INSPECTION" or "ACCIDENT"
    val data: String, // JSON serialized draft
    val updatedAt: Long = System.currentTimeMillis()
)
