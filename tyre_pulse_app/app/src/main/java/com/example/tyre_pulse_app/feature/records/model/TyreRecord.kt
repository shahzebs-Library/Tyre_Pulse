package com.example.tyre_pulse_app.feature.records.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class TyreRecord(
    val id: String,
    @SerialName("asset_no") val assetNo: String? = null,
    @SerialName("serial_no") val serialNo: String? = null,
    val brand: String? = null,
    val site: String? = null,
    @SerialName("issue_date") val issueDate: String? = null,
    @SerialName("risk_level") val riskLevel: String? = null,
    val category: String? = null,
    @SerialName("cost_per_tyre") val costPerTyre: Double? = null,
    @SerialName("km_at_fitment") val kmAtFitment: Double? = null,
    @SerialName("km_at_removal") val kmAtRemoval: Double? = null,
    val description: String? = null,
    val remarks: String? = null,
    val country: String? = null
)
