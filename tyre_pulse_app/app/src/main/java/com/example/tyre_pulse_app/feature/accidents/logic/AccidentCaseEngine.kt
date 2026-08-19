package com.example.tyre_pulse_app.feature.accidents.logic

import com.example.tyre_pulse_app.core.model.Accident
import kotlin.math.roundToInt

data class Workstream(
    val key: String,
    val name: String,
    val domain: String,
    val team: String,
    val dimension: String,
    val stage: String
)

data class RouteProfile(
    val routeKey: String,
    val requiredWorkstreams: List<String>,
    val naRequiresApproval: Boolean = true
)

data class CaseRoute(
    val key: String,
    val label: String,
    val required: List<String>,
    val conditional: List<Pair<String, (AccidentRecord) -> Boolean>>,
    val profile: RouteProfile? = null
)

data class WorkstreamRow(
    val key: String,
    val workstream: String,
    val status: String,
    val naReason: String? = null,
    val naApprovedBy: String? = null,
    val naAt: String? = null,
    val naBy: String? = null
)

data class CompletenessResult(
    val incident: Int?,
    val insurance: Int?,
    val repair: Int?,
    val financial: Int?,
    val overall: Int?
)

data class ClosureBlocker(
    val workstream: String? = null,
    val check: String? = null,
    val reason: String
)

data class TransitionSpec(
    val to: String,
    val action: String,
    val cap: String,
    val guard: String
)

class AccidentRecord(
    val fields: Map<String, Any?>
) {
    constructor(accident: Accident) : this(
        mapOf(
            "repair_type" to accident.repairType,
            "repair_cost" to accident.repairCost,
            "insurer" to accident.insurer,
            "policy_no" to accident.policyNo,
            "claim_amount" to accident.claimAmount,
            "injuries" to accident.injuries,
            "injury_count" to accident.injuryCount,
            "third_party_involved" to accident.thirdPartyInvolved,
            "accident_type" to accident.accidentType,
            "severity" to accident.severity,
            "case_status" to (accident.currentStatus ?: accident.status.name.lowercase()),
            "submitted" to (accident.status.name.lowercase() != "reported"),
            "photos" to accident.photos
        )
    )

    fun getString(key: String): String {
        return fields[key]?.toString()?.trim() ?: ""
    }

    fun getDouble(key: String): Double? {
        val value = fields[key] ?: return null
        return value.toString().toDoubleOrNull()
    }

    fun getBoolean(key: String): Boolean {
        val value = fields[key] ?: return false
        if (value is Boolean) return value
        val s = value.toString().lowercase()
        return s == "true" || s == "yes" || s == "y" || s == "1"
    }

    fun isExplicitlyFalse(key: String): Boolean {
        val value = fields[key] ?: return false
        if (value is Boolean) return !value
        val s = value.toString().lowercase()
        return s == "false" || s == "no" || s == "n" || s == "0"
    }
}

object AccidentCaseEngine {

    val WORKSTREAMS = listOf(
        Workstream("incident_evidence", "Incident & Evidence", "A", "Fleet Incident Officer", "incident", "reported"),
        Workstream("fleet_validation", "Fleet Validation", "A", "Fleet Supervisor", "incident", "initial_review"),
        Workstream("liability", "Safety & Liability", "B", "HSE Officer / Fleet Mgr", "incident", "hse_investigation"),
        Workstream("insurance", "Insurance & Claim", "C", "Insurance Claims Officer", "insurance", "insurance_claim"),
        Workstream("assessment", "Technical Assessment", "D", "Workshop Planner", "repair", "workshop_assessment"),
        Workstream("repair", "Repair", "D", "Workshop", "repair", "repair_in_progress"),
        Workstream("workshop_qc", "Workshop Quality Control", "D", "Workshop QC", "repair", "final_inspection"),
        Workstream("handover", "Fleet Handover", "E", "Fleet Inspector / Ops", "repair", "vehicle_release"),
        Workstream("finance", "Finance & Settlement", "F", "Finance / Cost Controller", "financial", "cost_recovery"),
        Workstream("corrective", "Corrective Actions", "B", "HSE Officer", "incident", "hse_investigation")
    )

    val WORKSTREAM_BY_KEY = WORKSTREAMS.associateBy { it.key }
    val PIPELINE_ORDER = listOf(
        "incident_evidence", "fleet_validation", "liability", "insurance",
        "assessment", "repair", "workshop_qc", "handover", "finance", "corrective"
    )

    val NON_WAIVABLE = setOf("incident_evidence", "liability", "finance")
    val TERMINAL_STATUSES = setOf("closed", "cancelled_duplicate")

    fun repairOccurred(rec: AccidentRecord): Boolean {
        val rt = rec.getString("repair_type").lowercase()
        if (rec.getBoolean("no_repair") || rt == "none" || rt == "no repair" || rt == "temporary") return false
        if (rt == "internal" || rt == "external") return true
        if ((rec.getDouble("repair_cost") ?: 0.0) > 0.0) return true
        if ((rec.getDouble("approved_repair_amount") ?: 0.0) > 0.0) return true
        return rec.getBoolean("repair_started")
    }

    fun correctiveRequired(rec: AccidentRecord): Boolean {
        return rec.getBoolean("corrective_action_required") ||
                rec.getBoolean("injuries") ||
                (rec.getDouble("injury_count") ?: 0.0) > 0.0
    }

    fun insuranceInvolved(rec: AccidentRecord): Boolean {
        val raw = rec.fields["insurance_involved"]
        if (raw != null && raw.toString().isNotBlank()) {
            if (rec.getBoolean("insurance_involved")) return true
            if (rec.isExplicitlyFalse("insurance_involved")) return false
        }
        return rec.getString("insurer").isNotBlank() ||
                rec.getString("policy_no").isNotBlank() ||
                (rec.getDouble("claim_amount") ?: 0.0) > 0.0
    }

    val CASE_ROUTES = mapOf(
        "standard" to CaseRoute(
            "standard", "Standard",
            listOf("incident_evidence", "fleet_validation", "liability", "assessment", "repair", "handover", "finance"),
            listOf("workshop_qc" to ::repairOccurred, "corrective" to ::correctiveRequired)
        ),
        "minor_no_insurance" to CaseRoute(
            "minor_no_insurance", "Minor accident without insurance",
            listOf("incident_evidence", "fleet_validation", "liability", "assessment", "repair", "handover", "finance"),
            listOf("corrective" to ::correctiveRequired)
        ),
        "internal_repair_insurance" to CaseRoute(
            "internal_repair_insurance", "Internal repair with insurance",
            listOf("incident_evidence", "fleet_validation", "liability", "insurance", "assessment", "repair", "workshop_qc", "handover", "finance"),
            listOf("corrective" to ::correctiveRequired)
        ),
        "external_repair_insurance" to CaseRoute(
            "external_repair_insurance", "External repair with insurance",
            listOf("incident_evidence", "fleet_validation", "liability", "insurance", "assessment", "repair", "workshop_qc", "handover", "finance"),
            listOf("corrective" to ::correctiveRequired)
        ),
        "total_loss" to CaseRoute(
            "total_loss", "Total loss",
            listOf("incident_evidence", "fleet_validation", "liability", "insurance", "assessment", "finance"),
            listOf("corrective" to ::correctiveRequired)
        ),
        "injury" to CaseRoute(
            "injury", "Injury accident",
            listOf("incident_evidence", "fleet_validation", "liability", "insurance", "corrective", "finance"),
            listOf(
                "assessment" to ::repairOccurred,
                "repair" to ::repairOccurred,
                "workshop_qc" to ::repairOccurred,
                "handover" to ::repairOccurred
            )
        )
    )

    fun buildCaseRoute(rec: AccidentRecord): CaseRoute {
        val isTotalLoss = rec.getBoolean("total_loss_route") || rec.getBoolean("total_loss") ||
                rec.getString("repair_type").lowercase() == "total loss" ||
                rec.getString("accident_type").lowercase().contains("total loss")
        val isInjury = rec.getBoolean("injuries") || (rec.getDouble("injury_count") ?: 0.0) > 0.0 ||
                rec.getString("accident_type").lowercase().contains("injur")
        val isMinor = rec.getString("severity").lowercase().let { it == "minor" || it == "low" }

        val key = when {
            isTotalLoss -> "total_loss"
            isInjury -> "injury"
            insuranceInvolved(rec) -> {
                if (rec.getString("repair_type").lowercase() == "external") "external_repair_insurance"
                else "internal_repair_insurance"
            }
            isMinor -> "minor_no_insurance"
            else -> "standard"
        }
        return CASE_ROUTES[key] ?: CASE_ROUTES["standard"]!!
    }

    fun requiredWorkstreams(route: CaseRoute, rec: AccidentRecord): Set<String> {
        val out = mutableSetOf<String>()
        out.addAll(route.required)
        for (cond in route.conditional) {
            if (cond.second(rec)) {
                out.add(cond.first)
            }
        }
        return out
    }

    fun workstreamStatus(rec: AccidentRecord, workstream: String, rows: List<WorkstreamRow> = emptyList()): String {
        val explicit = rows.find { it.workstream == workstream }
        if (explicit != null && explicit.status.isNotBlank()) return explicit.status

        if (workstream == "corrective") {
            val filled = listOf("corrective_action", "preventive_action").filter { rec.getString(it).isNotBlank() }
            if (filled.size == 2) return "completed"
            return if (filled.isNotEmpty()) "in_progress" else "not_started"
        }

        val wsDef = WORKSTREAM_BY_KEY[workstream] ?: return "not_required"
        // In mobile, we check for presence of corresponding core columns if status row is absent
        return when (wsDef.key) {
            "incident_evidence" -> if (rec.getString("photos").isNotBlank()) "completed" else "in_progress"
            "fleet_validation" -> if (rec.getBoolean("submitted")) "completed" else "not_started"
            else -> "not_started"
        }
    }

    fun markedNA(rec: AccidentRecord, rows: List<WorkstreamRow>, workstream: String, requireApproval: Boolean): Boolean {
        val explicit = rows.find { it.workstream == workstream }
        if (explicit != null) {
            if (explicit.naReason.isNullOrBlank() || explicit.naBy.isNullOrBlank() || explicit.naAt.isNullOrBlank()) return false
            if (requireApproval && explicit.naApprovedBy.isNullOrBlank()) return false
            return true
        }
        return false
    }

    fun scored(rec: AccidentRecord, rows: List<WorkstreamRow>, ws: String): Boolean {
        val status = workstreamStatus(rec, ws, rows)
        if (status == "completed") return true
        if (status == "not_required" || status == "cancelled") {
            return markedNA(rec, rows, ws, requireApproval = false)
        }
        return false
    }

    fun completeness(rec: AccidentRecord, rows: List<WorkstreamRow>, route: CaseRoute): CompletenessResult {
        val required = requiredWorkstreams(route, rec)
        val per = mutableMapOf(
            "incident" to Pair(0, 0),
            "insurance" to Pair(0, 0),
            "repair" to Pair(0, 0),
            "financial" to Pair(0, 0)
        )

        for (ws in required) {
            val wsDef = WORKSTREAM_BY_KEY[ws] ?: continue
            val dim = wsDef.dimension
            val current = per[dim] ?: Pair(0, 0)
            val satAdd = if (scored(rec, rows, ws)) 1 else 0
            per[dim] = Pair(current.first + 1, current.second + satAdd)
        }

        val pct = { req: Int, sat: Int ->
            if (req == 0) null else ((100.0 * sat) / req).roundToInt()
        }

        val incidentVal = per["incident"]!!
        val insuranceVal = per["insurance"]!!
        val repairVal = per["repair"]!!
        val financialVal = per["financial"]!!

        val reqTotal = incidentVal.first + insuranceVal.first + repairVal.first + financialVal.first
        val satTotal = incidentVal.second + insuranceVal.second + repairVal.second + financialVal.second

        return CompletenessResult(
            incident = pct(incidentVal.first, incidentVal.second),
            insurance = pct(insuranceVal.first, insuranceVal.second),
            repair = pct(repairVal.first, repairVal.second),
            financial = pct(financialVal.first, financialVal.second),
            overall = if (reqTotal == 0) null else ((100.0 * satTotal) / reqTotal).roundToInt()
        )
    }

    fun closureGradeSatisfied(rec: AccidentRecord, rows: List<WorkstreamRow>, ws: String, route: CaseRoute): Boolean {
        val status = workstreamStatus(rec, ws, rows)
        if (status == "completed") return true
        if (status == "not_required" || status == "cancelled") {
            if (NON_WAIVABLE.contains(ws)) return false
            val requireApproval = route.profile?.naRequiresApproval ?: true
            return markedNA(rec, rows, ws, requireApproval)
        }
        return false
    }

    fun canFullyClose(rec: AccidentRecord, rows: List<WorkstreamRow>, route: CaseRoute): Pair<Boolean, List<ClosureBlocker>> {
        val required = requiredWorkstreams(route, rec)
        val blockers = mutableListOf<ClosureBlocker>()

        for (ws in PIPELINE_ORDER) {
            if (!required.contains(ws)) continue
            if (closureGradeSatisfied(rec, rows, ws, route)) continue
            val status = workstreamStatus(rec, ws, rows)
            blockers.add(
                ClosureBlocker(
                    workstream = ws,
                    reason = "${WORKSTREAM_BY_KEY[ws]?.name ?: ws} is not complete (${status.replace('_', ' ')})"
                )
            )
        }

        if (repairOccurred(rec) && !required.contains("workshop_qc")) {
            blockers.add(ClosureBlocker(check = "workshop_qc", reason = "Workshop quality control required where repair occurred"))
        }

        val closureApproved = rec.getBoolean("closure_review_approved") || rec.getString("closure_approved_by").isNotBlank()
        if (!closureApproved) {
            blockers.add(ClosureBlocker(check = "closure_review", reason = "Closure review not approved"))
        }

        return Pair(blockers.isEmpty(), blockers)
    }

    fun deriveCaseStatus(rec: AccidentRecord, rows: List<WorkstreamRow>, route: CaseRoute): String {
        if (rec.getBoolean("legal_hold_active") || rec.getBoolean("legal_hold")) return "legal_hold"
        if (rec.getBoolean("cancelled") || rec.getBoolean("cancelled_duplicate")) return "cancelled_duplicate"
        if (rec.getString("case_status") == "closed") return "closed"
        if (rec.getBoolean("reopened_flag") || rec.getBoolean("reopened")) return "reopened"
        if (rec.getBoolean("total_loss_route") || rec.getBoolean("total_loss")) return "total_loss_processing"

        val required = requiredWorkstreams(route, rec)

        if (!rec.getBoolean("submitted")) {
            return if (rec.getBoolean("returned")) "evidence_incomplete" else "draft"
        }

        for (ws in PIPELINE_ORDER) {
            if (ws == "incident_evidence" || !required.contains(ws)) continue
            if (closureGradeSatisfied(rec, rows, ws, route)) continue
            val s = workstreamStatus(rec, ws, rows)
            return when (ws) {
                "fleet_validation" -> "under_fleet_validation"
                "liability" -> "liability_assessment"
                "insurance" -> when (s) {
                    "in_progress" -> "insurance_review"
                    "waiting_approval" -> "claim_registration_pending"
                    "waiting_external" -> "awaiting_insurer_response"
                    else -> "insurance_review"
                }
                "assessment" -> "technical_assessment"
                "repair" -> when (s) {
                    "in_progress" -> "repair_in_progress"
                    "waiting_approval" -> "awaiting_fleet_approval"
                    "waiting_external" -> "awaiting_external_workshop"
                    "waiting_info" -> "awaiting_parts"
                    else -> "repair_decision_pending"
                }
                "workshop_qc" -> "workshop_quality_inspection"
                "handover" -> "fleet_inspection"
                "finance" -> "financial_closure_pending"
                "corrective" -> "corrective_actions_pending"
                else -> "technical_assessment"
            }
        }

        return "closed"
    }
}
