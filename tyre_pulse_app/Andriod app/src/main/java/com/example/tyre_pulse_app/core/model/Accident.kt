package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Maps onto the real `accidents` table. Kotlin property names are kept
 * stable for existing UI call sites (accident.location, accident.date,
 * accident.assetNumber...) even where they differ from the DB column name -
 * only the @SerialName (the wire format) needs to be correct.
 *
 * Claim fields live directly on this row (there is no child `claims`
 * table), and `location` is the site name, not free-text geolocation.
 */
@Serializable
data class Accident(
    val id: String? = null,
    @SerialName("reference_no") val accidentNumber: String? = null,
    @SerialName("asset_no") val assetNumber: String,
    @SerialName("driver_name") val driverName: String? = null,
    @SerialName("incident_date") val date: String,
    @SerialName("site") val location: String? = null,
    val status: AccidentStatus = AccidentStatus.REPORTED,
    val description: String,
    // DB CHECK allows minor/moderate/severe/fatal (lowercase).
    val severity: String,
    @SerialName("accident_type") val accidentType: String? = null,
    @SerialName("plate_number") val plateNumber: String? = null,
    @SerialName("vehicle_type") val vehicleType: String? = null,
    @SerialName("claim_amount") val claimAmount: Double? = null,
    @SerialName("claim_approved_amount") val claimApprovedAmount: Double? = null,
    val deductible: Double? = null,
    @SerialName("recovered_amount") val recoveredAmount: Double? = null,
    val insurer: String? = null,
    @SerialName("policy_no") val policyNo: String? = null,
    @SerialName("claim_status") val claimStatus: String? = null,
    @SerialName("repair_cost") val repairCost: Double? = null,
    @SerialName("release_date") val releaseDate: String? = null,
    @SerialName("organisation_id") val tenantId: String? = null,
    val country: String? = null
)

@Serializable
enum class AccidentStatus {
    @SerialName("reported") REPORTED,
    @SerialName("under_review") UNDER_REVIEW,
    @SerialName("repair_in_progress") REPAIR_IN_PROGRESS,
    @SerialName("awaiting_parts") AWAITING_PARTS,
    @SerialName("awaiting_approval") AWAITING_APPROVAL,
    @SerialName("insurance_claim") INSURANCE_CLAIM,
    @SerialName("closed") CLOSED
}

/** A claim filed against an accident is a PATCH of these fields onto the accidents row. */
data class ClaimUpdate(
    val claimAmount: Double? = null,
    val claimApprovedAmount: Double? = null,
    val deductible: Double? = null,
    val recoveredAmount: Double? = null,
    val insurer: String? = null,
    val policyNo: String? = null,
    val claimStatus: String? = null
)
