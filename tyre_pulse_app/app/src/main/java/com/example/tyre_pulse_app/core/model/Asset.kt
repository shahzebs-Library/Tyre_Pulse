package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Asset(
    val id: String,
    @SerialName("asset_no") val assetNumber: String,
    @SerialName("plate_no") val plateNumber: String? = null,
    val category: String? = null,
    @SerialName("vehicle_type") val type: String? = "Pickup",
    val make: String? = null,
    val model: String? = null,
    val status: AssetStatus = AssetStatus.ACTIVE,
    @SerialName("odometer_km") val currentKm: Long? = null,
    @SerialName("hour_meter") val hourMeter: Long? = null,
    @SerialName("organisation_id") val tenantId: String? = null,
    val site: String? = null,
    @SerialName("last_inspection_id") val latestInspectionId: String? = null,
    @SerialName("last_inspection_date") val latestInspectionDate: String? = null,
    @SerialName("last_inspection_status") val latestInspectionStatus: String? = null,
    val fittedTyres: List<FittedTyre> = emptyList(),
    @SerialName("image_url") val imageUrl: String? = null
) {
    // Helper for code consistency
    val tyres: List<FittedTyre> get() = fittedTyres
}

@Serializable
enum class AssetStatus {
    ACTIVE, MAINTENANCE, OUT_OF_SERVICE, ACCIDENT
}

@Serializable
data class FittedTyre(
    val id: String,
    val position: String,
    @SerialName("serial_no") val serialNumber: String,
    val brand: String,
    val pattern: String,
    val size: String,
    val condition: String? = null,
    val pressure: Double? = null,
    @SerialName("tread_depth") val treadDepth: Double? = null
)
