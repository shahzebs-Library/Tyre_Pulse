package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Accident
import com.example.tyre_pulse_app.core.model.AccidentStatus
import com.example.tyre_pulse_app.core.network.api.AccidentApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Accidents, read from and written to public.accidents.
 *
 * WHAT THIS REPLACED. `getAccident` and `fileClaim` called `accidents/{id}` and
 * `accidents/{id}/claims` - path segments that PostgREST does not serve; it
 * filters with `?id=eq.X`. `getAccidents` looked like a table read but sent
 * `page` / `pageSize` / `assetId`, none of which PostgREST understands, and sent
 * the status filter as `AccidentStatus.name` - UPPER_SNAKE against a column whose
 * every stored value is lowercase, so any filtered query matched nothing.
 *
 * THE VOCABULARY IS ENFORCED BY THE DATABASE, verified 2026-08-23:
 *   chk_status         reported | under_review | repair_in_progress |
 *                      awaiting_parts | awaiting_approval | insurance_claim |
 *                      released | closed
 *   chk_severity       minor | moderate | severe | fatal
 *   chk_accident_type  collision | rollover | rear_end | side_swipe | reversing |
 *                      fire | vandalism | weather | tyre_failure | mechanical |
 *                      near_miss | property_damage | other
 * Writing anything else is not a soft failure - the row is REJECTED. The folds
 * below exist so the app cannot send a value the table will refuse.
 */
@Singleton
class AccidentRepository @Inject constructor(
    private val accidentApi: AccidentApi
) {

    /**
     * A failure PROPAGATES: the ViewModel already catches it and puts the message on
     * screen, and an empty list here would render a network failure as "no
     * accidents on record".
     */
    fun getAccidents(
        status: AccidentStatus? = null,
        assetNo: String? = null,
        limit: Int = PAGE_SIZE,
    ): Flow<List<Accident>> = flow {
        emit(
            accidentApi.getAccidents(
                status = status?.let { "eq.${storedStatusFor(it)}" },
                assetNo = assetNo?.let { "eq.$it" },
                limit = limit,
            )
        )
    }

    /**
     * One accident by id. An absent row is reported, not returned as a blank record
     * that would render as a real incident with every field empty.
     */
    suspend fun getAccident(id: String): Accident =
        accidentApi.getAccidentRow(id = "eq.$id")
            .firstOrNull()
            ?: throw NoSuchElementException("Accident $id was not found, or you do not have access to it.")

    /**
     * File a new accident.
     *
     * Two things happen here that the model cannot do on its own.
     *
     * NULLS ARE STRIPPED. The shared Json emits explicit nulls, and the model
     * carries nullable fields for NOT NULL columns that have defaults - `created_at`
     * most obviously. An explicit null does NOT fall back to a column default, it
     * violates the constraint, so a straight serialisation of this model could
     * never insert. Omitted keys take their defaults.
     *
     * THE CONSTRAINED COLUMNS ARE FOLDED onto the vocabulary the table accepts. The
     * enum serialises as `REPORTED`; the column accepts `reported`. That one
     * mismatch alone rejected every accident this app tried to file.
     */
    suspend fun reportAccident(accident: Accident): Accident {
        val encoded = INSERT_JSON.encodeToJsonElement(Accident.serializer(), accident).jsonObject
        val body = buildMap<String, JsonElement> {
            putAll(encoded)
            put(STATUS, JsonPrimitive(storedStatusFor(accident.status)))
            put(SEVERITY, JsonPrimitive(storedSeverityFor(accident.severity)))
            put(ACCIDENT_TYPE, JsonPrimitive(storedAccidentTypeFor(accident.accidentType)))
        }
        return accidentApi.reportAccident(JsonObject(body))
            .firstOrNull()
            ?: throw IllegalStateException("The accident was not saved. Nothing was returned by the server.")
    }

    /**
     * Record an insurance claim against an accident.
     *
     * WHERE A CLAIM ACTUALLY LIVES. There is no claims table this maps to. The
     * operational claim IS the accident row: `claim_amount`, `claim_status`,
     * `insurer`, `policy_no`, `insurance_claim_no` are columns on `accidents`, and
     * that is what the web app reports from. The separate
     * `accident_insurance_claims` table is a different, richer record - the
     * insurer's own decision, with no claim-amount column at all - and is not what
     * this call means.
     *
     * WHY THE SIGNATURE CHANGED. This took the `Claim` domain model, whose
     * `description` and `timestamp` fields have no column anywhere on this backend.
     * Accepting them would have meant silently discarding them on every call. The
     * parameters below are exactly the fields that have somewhere to go.
     *
     * Returns the updated accident, because the claim has no identity of its own to
     * return.
     */
    suspend fun fileClaim(
        accidentId: String,
        claimAmount: Double? = null,
        claimStatus: String? = null,
        insurer: String? = null,
        policyNo: String? = null,
        insuranceClaimNo: String? = null,
    ): Accident {
        val patch = buildMap<String, JsonElement> {
            claimAmount?.let { put("claim_amount", JsonPrimitive(it)) }
            claimStatus?.let { put("claim_status", JsonPrimitive(it)) }
            insurer?.let { put("insurer", JsonPrimitive(it)) }
            policyNo?.let { put("policy_no", JsonPrimitive(it)) }
            insuranceClaimNo?.let { put("insurance_claim_no", JsonPrimitive(it)) }
        }
        require(patch.isNotEmpty()) { "A claim needs at least one value to record." }
        return patchAccident(accidentId, JsonObject(patch))
    }

    /**
     * Move an accident to a new status, folded onto the vocabulary the CHECK
     * constraint accepts.
     */
    suspend fun setStatus(accidentId: String, status: AccidentStatus): Accident =
        patchAccident(
            accidentId,
            JsonObject(mapOf(STATUS to JsonPrimitive(storedStatusFor(status)))),
        )

    private suspend fun patchAccident(accidentId: String, patch: JsonObject): Accident =
        accidentApi.patchAccident(id = "eq.$accidentId", patch = patch)
            .firstOrNull()
            ?: throw NoSuchElementException(
                "Accident $accidentId was not updated - it no longer exists, or you do not have permission to change it."
            )

    private companion object {
        const val PAGE_SIZE = 50
        const val STATUS = "status"
        const val SEVERITY = "severity"
        const val ACCIDENT_TYPE = "accident_type"

        /**
         * Encoding only. `explicitNulls = false` is the whole point: a key that is
         * absent takes the column default, whereas a key that is present and null
         * overrides it.
         */
        val INSERT_JSON = Json {
            encodeDefaults = true
            explicitNulls = false
        }

        /**
         * Domain enum -> the token `chk_status` accepts.
         *
         * UNDER_INVESTIGATION folds onto `under_review`: the database has no
         * separate investigation state, and the two names describe the same stage.
         *
         * REJECTED has NO legal token and is not silently folded. Mapping it to
         * `closed` would record a case as concluded when it was refused, so it
         * fails loudly instead. The column also allows `released`, which the enum
         * cannot express at all - a value this app can read but never write.
         */
        fun storedStatusFor(status: AccidentStatus): String = when (status) {
            AccidentStatus.REPORTED -> "reported"
            AccidentStatus.UNDER_INVESTIGATION -> "under_review"
            AccidentStatus.UNDER_REVIEW -> "under_review"
            AccidentStatus.REPAIR_IN_PROGRESS -> "repair_in_progress"
            AccidentStatus.AWAITING_PARTS -> "awaiting_parts"
            AccidentStatus.AWAITING_APPROVAL -> "awaiting_approval"
            AccidentStatus.INSURANCE_CLAIM -> "insurance_claim"
            AccidentStatus.CLOSED -> "closed"
            AccidentStatus.REJECTED -> throw IllegalArgumentException(
                "This backend has no 'rejected' accident status. Allowed: reported, under_review, " +
                    "repair_in_progress, awaiting_parts, awaiting_approval, insurance_claim, released, closed."
            )
        }

        private val SEVERITIES = setOf("minor", "moderate", "severe", "fatal")

        /**
         * Severity has no catch-all bucket, so an unrecognised word is refused
         * rather than quietly downgraded - recording a fatality as "minor" because
         * the spelling was unexpected is worse than failing to record it.
         * "major" and "total loss" are the web app's own labels for `severe`.
         */
        fun storedSeverityFor(raw: String?): String {
            val token = raw?.trim()?.lowercase().orEmpty()
            if (token in SEVERITIES) return token
            return when (token) {
                "", "none" -> "minor"
                "major", "total loss", "total_loss" -> "severe"
                else -> throw IllegalArgumentException(
                    "'$raw' is not a severity this backend accepts. Allowed: minor, moderate, severe, fatal."
                )
            }
        }

        private val ACCIDENT_TYPES = setOf(
            "collision", "rollover", "rear_end", "side_swipe", "reversing", "fire",
            "vandalism", "weather", "tyre_failure", "mechanical", "near_miss",
            "property_damage", "other",
        )

        /**
         * Unlike severity, `accident_type` HAS a designated catch-all, so an
         * unrecognised word folds onto `other` rather than failing the save. That
         * mirrors the web app, which posts `toDbAccidentType(v) || 'other'`.
         *
         * Spaces and hyphens are normalised first, so "Rear End" and "rear-end"
         * both reach `rear_end` instead of falling into `other`.
         */
        fun storedAccidentTypeFor(raw: String?): String {
            val token = raw?.trim()?.lowercase()?.replace(Regex("[\\s-]+"), "_").orEmpty()
            return if (token in ACCIDENT_TYPES) token else "other"
        }
    }
}
