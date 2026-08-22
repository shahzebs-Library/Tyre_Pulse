package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class WashRecord(
    val id: String? = null, // null for new records
    @SerialName("asset_no") val assetNumber: String,
    @SerialName("vehicle_type") val vehicleType: String? = null,
    val site: String? = null,
    val area: String? = null,
    @SerialName("wash_date") val washDate: String,
    @SerialName("wash_time") val washTime: String? = null,
    @SerialName("wash_type") val washType: String = "Full",
    val bay: String? = null,
    @SerialName("washed_by") val washedBy: String? = null,
    val status: String = "Completed",
    @SerialName("odometer_km") val odometerKm: Long? = null,
    val notes: String? = null,
    val photos: List<String> = emptyList(),
    val country: String? = null,
    @SerialName("created_at") val createdAt: String? = null
)
