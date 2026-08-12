package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class WorkshopEvent(
    val id: String,
    val userId: String,
    val jobId: String? = null,
    val taskId: String? = null,
    val assetNo: String? = null,
    val eventType: String, // start_job, pause_job, resume_job, complete_task, etc.
    val reasonCode: String? = null,
    val note: String? = null,
    val photos: List<String>? = null,
    val at: String,
    val site: String? = null,
    val country: String? = null,
    val device: String? = null,
    val gpsLat: Double? = null,
    val gpsLng: Double? = null
)

@Serializable
data class WorkshopTask(
    val id: String,
    val jobId: String,
    val title: String,
    val seq: Int? = null,
    val status: String,
    val estMinutes: Int? = null
)
