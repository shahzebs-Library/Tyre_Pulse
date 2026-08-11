package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class Accident(
    val id: String,
    val accidentNumber: String,
    val assetId: String,
    val assetNumber: String,
    val driverId: String? = null,
    val driverName: String? = null,
    val date: String,
    val location: String,
    val status: AccidentStatus,
    val description: String,
    val severity: String, // e.g., "Low", "Medium", "High", "Fatal"
    val photos: List<String> = emptyList(),
    val insuranceDetails: InsuranceDetails? = null,
    val claims: List<Claim> = emptyList(),
    val tenantId: String,
    val companyId: String,
    val countryId: String,
    val siteId: String? = null
)

@Serializable
enum class AccidentStatus {
    REPORTED, UNDER_INVESTIGATION, INSURANCE_REVIEW, CLAIM_PENDING, REPAIR_PENDING, CLOSED, REJECTED
}

@Serializable
data class InsuranceDetails(
    val companyName: String,
    val policyNumber: String,
    val expiryDate: String,
    val contactPerson: String? = null,
    val contactPhone: String? = null
)

@Serializable
data class Claim(
    val id: String,
    val claimNumber: String,
    val amount: Double,
    val currency: String,
    val status: String, // e.g., "PENDING", "APPROVED", "PAID", "REJECTED"
    val filedDate: String,
    val settlementDate: String? = null
)
