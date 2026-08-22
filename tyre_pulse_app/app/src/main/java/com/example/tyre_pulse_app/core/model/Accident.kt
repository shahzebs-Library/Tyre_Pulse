package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class Accident(
    val id: String? = null,
    @SerialName("reference_no") val accidentNumber: String? = null,
    @SerialName("vehicle_id") val assetId: String? = null,
    @SerialName("asset_no") val assetNumber: String,
    val site: String? = null,
    val country: String? = null,
    
    // Incident Details
    @SerialName("incident_date") val date: String,
    @SerialName("incident_time") val time: String? = null,
    val location: String? = null,
    @SerialName("driver_name") val driverName: String? = null,
    val description: String? = null,
    @SerialName("reported_by") val reportedBy: String? = null,
    @SerialName("reporter_name") val reporterName: String? = null,
    
    // Classification
    val status: AccidentStatus = AccidentStatus.REPORTED,
    @SerialName("accident_type") val accidentType: String? = "other",
    val severity: String = "minor",
    @SerialName("current_status") val currentStatus: String? = null,
    @SerialName("damage_condition") val damageCondition: String? = null,
    
    // People & Damage
    val injuries: Boolean = false,
    @SerialName("injury_count") val injuryCount: Int = 0,
    @SerialName("third_party_involved") val thirdPartyInvolved: Boolean = false,
    @SerialName("police_report_no") val policeReportNo: String? = null,
    @SerialName("damage_description") val damageDescription: String? = null,
    @SerialName("estimated_damage_cost") val estimatedDamageCost: Double? = null,
    
    // Liability & GCC Case
    @SerialName("fault_status") val faultStatus: String? = null,
    @SerialName("gcc_liability_ratio") val gccLiabilityRatio: Double? = null,
    @SerialName("najm_status") val najmStatus: String? = null,
    @SerialName("najm_fault") val najmFault: String? = null,
    @SerialName("taqdeer_status") val taqdeerStatus: String? = null,
    @SerialName("taqdeer_no") val taqdeerNo: String? = null,
    @SerialName("liable_party") val liableParty: String? = null,
    val payer: String? = null,
    @SerialName("responsible_party") val responsibleParty: String? = null,
    
    // Insurance & Claim
    val insurer: String? = null,
    @SerialName("policy_no") val policyNo: String? = null,
    @SerialName("insurance_claim_no") val insuranceClaimNo: String? = null,
    @SerialName("claim_status") val claimStatus: String? = "none",
    @SerialName("claim_amount") val claimAmount: Double? = null,
    @SerialName("claim_approved_amount") val claimApprovedAmount: Double? = null,
    val deductible: Double? = null,
    @SerialName("recovered_amount") val recoveredAmount: Double? = null,
    
    // Cost Recovery
    @SerialName("recovery_status") val recoveryStatus: String? = "N/A",
    @SerialName("recovery_source") val recoverySource: String? = "none",
    @SerialName("recovery_date") val recoveryDate: String? = null,
    @SerialName("recovery_reference") val recoveryReference: String? = null,
    @SerialName("amount_transfer") val amountTransfer: Double? = null,
    
    // Repair & Release
    @SerialName("repair_type") val repairType: String? = null,
    @SerialName("workshop_name") val workshopName: String? = null,
    @SerialName("workshop_location") val workshopLocation: String? = null,
    @SerialName("repair_cost") val repairCost: Double? = null,
    @SerialName("expected_release_date") val expectedReleaseDate: String? = null,
    @SerialName("release_date") val releaseDate: String? = null,
    
    // Attachments
    val photos: List<String> = emptyList(),
    val notes: String? = null,
    @SerialName("created_at") val createdAt: String? = null
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
