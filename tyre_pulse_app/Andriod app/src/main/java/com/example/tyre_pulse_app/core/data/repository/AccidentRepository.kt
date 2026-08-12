package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Accident
import com.example.tyre_pulse_app.core.model.AccidentStatus
import com.example.tyre_pulse_app.core.model.ClaimUpdate
import com.example.tyre_pulse_app.core.network.Pg
import com.example.tyre_pulse_app.core.network.api.AccidentApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AccidentRepository @Inject constructor(
    private val accidentApi: AccidentApi
) {
    fun getAccidents(
        status: AccidentStatus? = null,
        assetNo: String? = null,
        page: Int = 0,
        pageSize: Int = 20
    ): Flow<List<Accident>> = flow {
        val accidents = accidentApi.getAccidents(
            status = Pg.eq(status?.dbToken()),
            assetNo = Pg.eq(assetNo),
            limit = pageSize,
            offset = page * pageSize
        )
        emit(accidents)
    }

    suspend fun getAccident(id: String): Accident? {
        return accidentApi.getAccident(Pg.eq(id) ?: "eq.$id").firstOrNull()
    }

    suspend fun reportAccident(accident: Accident): Accident {
        return accidentApi.reportAccident(accident).first()
    }

    suspend fun fileClaim(accidentId: String, claim: ClaimUpdate): Accident {
        val patch = buildJsonObject {
            put("claim_amount", claim.claimAmount?.let { JsonPrimitive(it) } ?: JsonNull)
            put("claim_approved_amount", claim.claimApprovedAmount?.let { JsonPrimitive(it) } ?: JsonNull)
            put("deductible", claim.deductible?.let { JsonPrimitive(it) } ?: JsonNull)
            put("recovered_amount", claim.recoveredAmount?.let { JsonPrimitive(it) } ?: JsonNull)
            claim.insurer?.let { put("insurer", JsonPrimitive(it)) }
            claim.policyNo?.let { put("policy_no", JsonPrimitive(it)) }
            claim.claimStatus?.let { put("claim_status", JsonPrimitive(it)) }
        }
        return accidentApi.updateAccident(id = Pg.eq(accidentId) ?: "eq.$accidentId", patch = patch).first()
    }

    /** The DB CHECK constraint's own lowercase token, e.g. `under_review`. */
    private fun AccidentStatus.dbToken(): String = when (this) {
        AccidentStatus.REPORTED -> "reported"
        AccidentStatus.UNDER_REVIEW -> "under_review"
        AccidentStatus.REPAIR_IN_PROGRESS -> "repair_in_progress"
        AccidentStatus.AWAITING_PARTS -> "awaiting_parts"
        AccidentStatus.AWAITING_APPROVAL -> "awaiting_approval"
        AccidentStatus.INSURANCE_CLAIM -> "insurance_claim"
        AccidentStatus.CLOSED -> "closed"
    }
}
