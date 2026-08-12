package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class Accident(
    val id: String,
    val accidentNumber: String? = null,
    val assetId: String? = null,
    val assetNumber: String,
    val site: String? = null,
    val country: String? = null,
    val tenantId: String? = null,
    val companyId: String? = null,
    
    // Incident Details
    val date: String,
    val time: String? = null,
    val location: String? = null,
    val driverName: String? = null,
    val description: String,
    val reportedBy: String? = null,
    val reporterName: String? = null,
    
    // Classification
    val status: AccidentStatus = AccidentStatus.REPORTED,
    val accidentType: String? = "other",
    val severity: String = "minor",
    val currentStatus: String? = null,
    val damageCondition: String? = null,
    
    // People & Damage
    val injuries: Boolean = false,
    val injuryCount: Int = 0,
    val thirdPartyInvolved: Boolean = false,
    val policeReportNo: String? = null,
    val damageDescription: String? = null,
    val estimatedDamageCost: Double? = null,
    
    // Liability & GCC Case
    val faultStatus: String? = null,
    val gccLiabilityRatio: Double? = null,
    val najmStatus: String? = null,
    val najmFault: String? = null,
    val taqdeerStatus: String? = null,
    val taqdeerNo: String? = null,
    val liableParty: String? = null,
    val payer: String? = null,
    val responsibleParty: String? = null,
    
    // Insurance & Claim
    val insurer: String? = null,
    val policyNo: String? = null,
    val insuranceClaimNo: String? = null,
    val claimStatus: String? = "none",
    val claimAmount: Double? = null,
    val claimApprovedAmount: Double? = null,
    val deductible: Double? = null,
    val recoveredAmount: Double? = null,
    
    // Cost Recovery
    val recoveryStatus: String? = "N/A",
    val recoverySource: String? = "none",
    val recoveryDate: String? = null,
    val recoveryReference: String? = null,
    val amountTransfer: Double? = null,
    
    // Repair & Release
    val repairType: String? = null,
    val workshopName: String? = null,
    val workshopLocation: String? = null,
    val repairCost: Double? = null,
    val expectedReleaseDate: String? = null,
    val releaseDate: String? = null,
    
    // Attachments
    val photos: List<String> = emptyList(),
    val notes: String? = null,
    val clientUuid: String? = null
)

@Serializable
enum class AccidentStatus {
    REPORTED, 
    UNDER_INVESTIGATION, 
    UNDER_REVIEW, // Ported from toDbStatus
    REPAIR_IN_PROGRESS, 
    AWAITING_PARTS, 
    AWAITING_APPROVAL, 
    INSURANCE_CLAIM, 
    CLOSED, 
    REJECTED
}
