package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Tyre(
    val id: String,
    @SerialName("serial_no") val serialNumber: String,
    val barcode: String? = null,
    val brand: String,
    val pattern: String? = null,
    val size: String? = null,
    val status: TyreStatus = TyreStatus.AVAILABLE,
    val condition: String? = null,
    @SerialName("asset_no") val currentAssetNumber: String? = null,
    val position: String? = null,
    @SerialName("km_at_fitment") val installationKm: Long? = null,
    @SerialName("km_at_removal") val removalKm: Long? = null,
    @SerialName("organisation_id") val tenantId: String? = null,
    val site: String? = null
)

@Serializable
enum class TyreStatus {
    AVAILABLE, FITTED, REMOVED, SCRAPPED, UNDER_REPAIR, WARRANTY_CLAIM, UNDER_INSPECTION
}

@Serializable
data class TyreHistoryEvent(
    val id: String,
    @SerialName("tyre_id") val tyreId: String,
    @SerialName("event_type") val type: String,
    val date: String,
    @SerialName("asset_no") val assetNumber: String? = null,
    val position: String? = null,
    @SerialName("km_reading") val kmReading: Long? = null,
    @SerialName("user_name") val userName: String? = "System",
    val reason: String? = null,
    val notes: String? = null
)
