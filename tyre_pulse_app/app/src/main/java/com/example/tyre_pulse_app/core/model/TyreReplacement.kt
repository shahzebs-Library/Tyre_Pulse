package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class TyreReplacementRequest(
    val id: String? = null,
    val assetId: String,
    val position: String,
    val removedTyreId: String,
    val removalReason: String,
    val removalKm: Long,
    val removalHourMeter: Long? = null,
    val removalCondition: String,
    val removalTreadDepth: Double? = null,
    val removalPressure: Double? = null,
    val installedTyreId: String? = null,
    val installationKm: Long? = null,
    val status: ReplacementStatus = ReplacementStatus.DRAFT,
    val tenantId: String,
    val companyId: String,
    val countryId: String,
    val siteId: String? = null,
    val requestedBy: String? = null,
    val requestedDate: String? = null,
    val approvedBy: String? = null,
    val approvedDate: String? = null,
    val remarks: String? = null
)

@Serializable
enum class ReplacementStatus {
    DRAFT, SUBMITTED, PENDING_APPROVAL, APPROVED, REJECTED, READY_FOR_INSTALLATION, INSTALLED, CANCELLED, FAILED
}

@Serializable
data class RemovalReason(
    val id: String,
    val name: String,
    val requiresDescription: Boolean = false
)
