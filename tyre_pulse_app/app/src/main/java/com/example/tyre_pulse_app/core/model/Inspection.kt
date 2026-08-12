package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Inspection(
    val id: String? = null,
    @SerialName("asset_no") val assetNumber: String,
    @SerialName("inspection_type") val type: String = "Routine",
    val status: String = "Done",
    val inspector: String? = null,
    @SerialName("scheduled_date") val scheduledDate: String,
    @SerialName("completed_date") val completedDate: String? = null,
    @SerialName("tyre_conditions") val tyreReadings: List<TyreInspectionReading> = emptyList(),
    val notes: String? = null,
    @SerialName("organisation_id") val tenantId: String? = null,
    val site: String? = null,
    val country: String? = null,
    @SerialName("odometer_km") val odometerKm: Double? = null,
    @SerialName("hour_meter") val hourMeter: Double? = null
)

@Serializable
data class TyreInspectionReading(
    val position: String,
    val pressure: String? = null,
    val condition: String? = "Good",
    val treadDepth: String? = null // Map to tread_depth if needed
)

@Serializable
data class InspectionDraft(
    val id: String,
    val assetId: String,
    val assetNumber: String,
    val plateNumber: String?,
    val data: Inspection,
    val lastModified: Long
)
