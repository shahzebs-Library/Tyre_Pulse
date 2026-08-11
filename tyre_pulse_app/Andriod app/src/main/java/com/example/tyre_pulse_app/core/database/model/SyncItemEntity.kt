package com.example.tyre_pulse_app.core.database.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sync_queue")
data class SyncItemEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val endpoint: String,
    val method: String, // "POST", "PATCH", "PUT"
    val payload: String, // JSON body
    val timestamp: Long = System.currentTimeMillis(),
    val status: String = "PENDING" // "PENDING", "FAILED", "SYNCED"
)
