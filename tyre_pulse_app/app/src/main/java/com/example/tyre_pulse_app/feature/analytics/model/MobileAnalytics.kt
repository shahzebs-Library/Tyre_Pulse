package com.example.tyre_pulse_app.feature.analytics.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RiskSlice(
    val risk: String,
    val count: Int
)

@Serializable
data class SiteSlice(
    val site: String,
    val count: Int,
    val cost: Double? = null
)

@Serializable
data class BrandSlice(
    val brand: String,
    val count: Int,
    val cost: Double? = null
)

@Serializable
data class MobileAnalytics(
    val country: String? = null,
    val site: String? = null,
    @SerialName("tyres_total") val tyresTotal: Int = 0,
    @SerialName("tyres_critical") val tyresCritical: Int = 0,
    @SerialName("tyres_high") val tyresHigh: Int = 0,
    @SerialName("tyre_spend") val tyreSpend: Double? = null,
    @SerialName("vehicles_total") val vehiclesTotal: Int = 0,
    @SerialName("inspections_30d") val inspections30d: Int = 0,
    @SerialName("open_actions") val openActions: Int = 0,
    @SerialName("by_risk") val byRisk: List<RiskSlice> = emptyList(),
    @SerialName("by_site") val bySite: List<SiteSlice> = emptyList(),
    @SerialName("by_brand") val byBrand: List<BrandSlice> = emptyList(),
    val sites: List<String> = emptyList(),
    @SerialName("generated_at") val generatedAt: String? = null
)
