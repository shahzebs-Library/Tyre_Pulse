package com.example.tyre_pulse_app.core.network.dto

import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.model.ApprovalSource
import com.example.tyre_pulse_app.core.model.ApprovalStatus
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * THERE IS NO `approvals` TABLE. An approval is a STATE ON THE RECORD.
 *
 * `ApprovalApi` used to declare `@GET("approvals")`, which 404s on every call
 * against this database, and `ApprovalRepository` hid that by emitting two
 * invented rows. Verified against the live schema on 2026-08-23, approval state
 * lives in two places this module can serve today:
 *
 *   public.inspections            .approval_status
 *   public.checklist_submissions  .approval_status
 *
 * (`accident_case_approvals` and `workflow_instances` are two further sources.
 * They are deliberately NOT wired here - they carry their own multi-workstream
 * lifecycles rather than a single approve/reject, and folding them onto this
 * three-state model would misrepresent them.)
 *
 * THE TWO VOCABULARIES ARE DIFFERENT AND MUST NOT BE MIXED. Both are enforced by
 * a live CHECK constraint:
 *
 *   inspections            done | pending_approval | approved | rejected
 *   checklist_submissions  not_required | pending | pending_area_manager | approved | rejected
 *
 * mobile/lib/inspectionApprovals.ts says this in as many words - "this is a
 * DIFFERENT vocabulary from the checklist one - do not carry tokens across".
 * Hence one DTO, one status folder and one filter per source.
 */

// ---------------------------------------------------------------------------
// Composite id
// ---------------------------------------------------------------------------

/**
 * WHY THE ID IS PREFIXED. Two tables back one queue, both keyed by uuid, and the
 * navigation route carries nothing but `{approvalId}`. A bare uuid would leave
 * the detail screen unable to tell which table - and therefore which RPC - the
 * row belongs to, so it would have to query both and guess.
 *
 * `_` is the separator on purpose: it is unreserved in a URI path segment, so
 * Navigation never has to encode it, and neither a uuid nor a source token
 * contains one.
 */
object ApprovalId {
    fun of(source: ApprovalSource, rowId: String): String = source.token + "_" + rowId

    /** The source half, or null when the id is not one this module minted. */
    fun sourceOf(compositeId: String): ApprovalSource? =
        ApprovalSource.entries.firstOrNull { compositeId.startsWith(it.token + "_") }

    /** The uuid half. Empty when the id is not one this module minted. */
    fun rowIdOf(compositeId: String): String {
        val source = sourceOf(compositeId) ?: return ""
        return compositeId.removePrefix(source.token + "_")
    }
}

// ---------------------------------------------------------------------------
// PostgREST filters
// ---------------------------------------------------------------------------

/**
 * The `approval_status` filter that selects one domain state, per source.
 *
 * PENDING on a checklist is TWO tokens. A sheet a supervisor has already signed
 * sits at `pending_area_manager`, and reading only `pending` would make it vanish
 * from every queue with nobody able to close it - the exact hazard called out in
 * mobile/lib/checklists.ts listPendingApprovals.
 */
fun approvalStatusFilter(source: ApprovalSource, status: ApprovalStatus): String =
    when (source) {
        ApprovalSource.INSPECTION -> when (status) {
            ApprovalStatus.PENDING -> "eq.pending_approval"
            ApprovalStatus.APPROVED -> "eq.approved"
            ApprovalStatus.REJECTED -> "eq.rejected"
        }
        ApprovalSource.CHECKLIST -> when (status) {
            ApprovalStatus.PENDING -> "in.(pending,pending_area_manager)"
            ApprovalStatus.APPROVED -> "eq.approved"
            ApprovalStatus.REJECTED -> "eq.rejected"
        }
    }

/*
 * `inspections.approval_status = 'done'` (5 live rows) and
 * `checklist_submissions.approval_status = 'not_required'` (5 live rows) match
 * NONE of the filters above, and that is deliberate. Neither is a decision this
 * module made: "done" is a legacy value and "not_required" means the template
 * never asked for a sign-off. Folding either onto APPROVED would assert an
 * approval that nobody gave.
 */

/**
 * Strip the characters that would break the PostgREST `or=(...)` grammar once
 * the server percent-decodes the value. A user typing "(" must not be able to
 * change which rows come back.
 */
fun sanitizeApprovalSearch(raw: String): String {
    val stripped = raw.trim().map { ch ->
        if (ch.isLetterOrDigit() || ch == ' ' || ch == '-' || ch == '/') ch else ' '
    }.joinToString("")
    return stripped.split(' ').filter { it.isNotEmpty() }.joinToString(" ")
}

// ---------------------------------------------------------------------------
// inspections
// ---------------------------------------------------------------------------

/**
 * A row of public.inspections as PostgREST returns it.
 *
 * Every field is nullable - even `title` and `site`, which the table declares
 * NOT NULL - because PostgREST omits any column absent from `select`, and a
 * narrowed select would otherwise fail deserialisation rather than simply
 * arriving empty.
 */
@Serializable
data class InspectionApprovalDto(
    val id: String? = null,
    val title: String? = null,
    val site: String? = null,
    @SerialName("asset_no") val assetNo: String? = null,
    @SerialName("vehicle_type") val vehicleType: String? = null,
    val inspector: String? = null,
    @SerialName("inspection_date") val inspectionDate: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("approval_status") val approvalStatus: String? = null,
    val findings: String? = null,
    val notes: String? = null,
    val country: String? = null,
) {
    /**
     * PostgREST returns only what is asked for, so this constant and the fields
     * above are a PAIR - a field with no column here silently arrives null.
     */
    companion object {
        const val SELECT = "id,title,site,asset_no,vehicle_type,inspector," +
            "inspection_date,created_at,approval_status,findings,notes,country"

        /** Newest first. `id` breaks ties so paging cannot repeat or drop a row. */
        const val ORDER = "inspection_date.desc.nullslast,created_at.desc.nullslast,id.desc"

        /** Columns a free-text search looks in, as a PostgREST `or` filter. */
        fun searchFilter(term: String): String =
            "(title.ilike.*" + term + "*,inspector.ilike.*" + term +
                "*,asset_no.ilike.*" + term + "*,site.ilike.*" + term + "*)"
    }
}

/**
 * Fold the stored token onto the domain enum.
 *
 * Unknown folds to PENDING, which keeps a row VISIBLE in the queue. Folding an
 * unrecognised value to APPROVED would hide work that nobody has signed.
 */
fun inspectionApprovalStatusOf(raw: String?): ApprovalStatus =
    when (raw?.trim()?.lowercase()) {
        "approved" -> ApprovalStatus.APPROVED
        "rejected" -> ApprovalStatus.REJECTED
        else -> ApprovalStatus.PENDING
    }

fun InspectionApprovalDto.toDomain(): Approval = Approval(
    id = ApprovalId.of(ApprovalSource.INSPECTION, id.orEmpty()),
    // Where the table has no value the field becomes an empty string, never an
    // invented one: a placeholder like "Unknown inspection" would read as data.
    title = title.orEmpty(),
    requester = inspector.orEmpty(),
    date = (inspectionDate ?: createdAt).orEmpty(),
    status = inspectionApprovalStatusOf(approvalStatus),
    // The inspector's own free text, verbatim. Nothing is composed or worded here.
    description = listOfNotNull(
        findings?.takeIf { it.isNotBlank() },
        notes?.takeIf { it.isNotBlank() },
    ).joinToString("\n\n"),
    category = ApprovalSource.INSPECTION.label,
    source = ApprovalSource.INSPECTION,
    assetNo = assetNo?.takeIf { it.isNotBlank() },
    site = site?.takeIf { it.isNotBlank() },
    // A checklist has a sign-off ladder; an inspection has one decision. Reported
    // as null rather than as a one-rung ladder that does not exist.
    stage = null,
)

// ---------------------------------------------------------------------------
// checklist_submissions
// ---------------------------------------------------------------------------

/**
 * A row of public.checklist_submissions as PostgREST returns it.
 *
 * NOTE what is NOT selected: `answers`, `photos`, `notes` and `signatures` are
 * jsonb, and `notes` in particular is a per-line object rather than a string.
 * Selecting them into a String field would fail deserialisation on the first
 * row, so the queue shows the record's identity and the fill screen keeps the
 * detail.
 */
@Serializable
data class ChecklistApprovalDto(
    val id: String? = null,
    val title: String? = null,
    @SerialName("template_name") val templateName: String? = null,
    @SerialName("document_no") val documentNo: String? = null,
    val site: String? = null,
    @SerialName("asset_no") val assetNo: String? = null,
    @SerialName("printed_name") val printedName: String? = null,
    @SerialName("submitted_at") val submittedAt: String? = null,
    @SerialName("approval_status") val approvalStatus: String? = null,
    @SerialName("score_pct") val scorePct: Int? = null,
    @SerialName("supervisor_name") val supervisorName: String? = null,
    @SerialName("supervisor_at") val supervisorAt: String? = null,
    @SerialName("review_note") val reviewNote: String? = null,
    val country: String? = null,
) {
    companion object {
        const val SELECT = "id,title,template_name,document_no,site,asset_no,printed_name," +
            "submitted_at,approval_status,score_pct,supervisor_name,supervisor_at," +
            "review_note,country"

        const val ORDER = "submitted_at.desc.nullslast,id.desc"

        fun searchFilter(term: String): String =
            "(title.ilike.*" + term + "*,template_name.ilike.*" + term +
                "*,document_no.ilike.*" + term + "*,printed_name.ilike.*" + term +
                "*,asset_no.ilike.*" + term + "*,site.ilike.*" + term + "*)"
    }
}

/**
 * Both waiting tokens fold to PENDING - `pending_area_manager` is still waiting,
 * just on a different person. WHO it is waiting on is carried separately by
 * [Approval.stage] so the screen can say so instead of printing "pending", which
 * tells the reader nothing about who is holding it.
 */
fun checklistApprovalStatusOf(raw: String?): ApprovalStatus =
    when (raw?.trim()?.lowercase()) {
        "approved" -> ApprovalStatus.APPROVED
        "rejected" -> ApprovalStatus.REJECTED
        else -> ApprovalStatus.PENDING
    }

/**
 * The rung a submission is sitting on, in plain words, or null when it is not
 * waiting. Mirrors mobile/lib/checklistApproval.ts statusSummary.
 */
fun checklistStageOf(raw: String?): String? =
    when (raw?.trim()?.lowercase()) {
        "pending" -> "Waiting for a supervisor"
        "pending_area_manager" -> "Waiting for the area manager"
        else -> null
    }

fun ChecklistApprovalDto.toDomain(): Approval = Approval(
    id = ApprovalId.of(ApprovalSource.CHECKLIST, id.orEmpty()),
    // `title` is nullable on this table; the template name is what the sheet is
    // actually called, and the document number identifies it in the register.
    title = listOfNotNull(
        title?.takeIf { it.isNotBlank() },
        templateName?.takeIf { it.isNotBlank() },
        documentNo?.takeIf { it.isNotBlank() },
    ).firstOrNull().orEmpty(),
    // `submitted_by` is a uuid, not a name. `printed_name` is the name the person
    // actually wrote on the sheet. An unresolved uuid is not a requester.
    requester = printedName.orEmpty(),
    date = submittedAt.orEmpty(),
    status = checklistApprovalStatusOf(approvalStatus),
    description = listOfNotNull(
        documentNo?.takeIf { it.isNotBlank() }?.let { "Document " + it },
        supervisorName?.takeIf { it.isNotBlank() }?.let { "Supervisor sign-off by " + it },
        reviewNote?.takeIf { it.isNotBlank() },
    ).joinToString("\n\n"),
    category = ApprovalSource.CHECKLIST.label,
    source = ApprovalSource.CHECKLIST,
    assetNo = assetNo?.takeIf { it.isNotBlank() },
    site = site?.takeIf { it.isNotBlank() },
    stage = checklistStageOf(approvalStatus),
)

// ---------------------------------------------------------------------------
// The decision RPCs
// ---------------------------------------------------------------------------

/*
 * A decision is NOT a table write from this client.
 *
 * Both decisions go through a SECURITY DEFINER RPC, verified present on the live
 * database and executable by `authenticated`:
 *
 *   decide_inspection_approval(p_inspection_id uuid, p_decision text,
 *                              p_note text, p_signature text) -> jsonb
 *   decide_checklist_approval (p_submission_id uuid, p_decision text,
 *                              p_note text, p_signature text) -> jsonb
 *
 * That is where the approver check really lives. A direct PATCH would be wrong
 * in the four ways mobile/lib/inspectionApprovals.ts documents: no already-decided
 * guard, the approver identity trusted from the client, enforcement by a
 * permissive policy that admits an inspector, and Directors refused outright.
 * The RPC derives the approver from `auth.uid()`, updates only a row still in the
 * waiting state, and names who decided it when it was not.
 *
 * The only accepted decision tokens are `approved` and `rejected`; the functions
 * raise on anything else.
 */
const val DECISION_APPROVED = "approved"
const val DECISION_REJECTED = "rejected"

@Serializable
data class DecideInspectionRequest(
    @SerialName("p_inspection_id") val inspectionId: String,
    @SerialName("p_decision") val decision: String,
    @SerialName("p_note") val note: String? = null,
    @SerialName("p_signature") val signature: String? = null,
)

@Serializable
data class DecideChecklistRequest(
    @SerialName("p_submission_id") val submissionId: String,
    @SerialName("p_decision") val decision: String,
    @SerialName("p_note") val note: String? = null,
    @SerialName("p_signature") val signature: String? = null,
)

/**
 * Both functions return `{"ok":true,"decision":...}`; the checklist one adds
 * `status`, which is the rung the sheet moved to (`pending_area_manager` when a
 * supervisor signed a two-stage sheet, `approved` when it actually closed).
 *
 * A refusal is an HTTP 400 carrying the raised message, not a body with
 * `ok:false`, so callers must handle the error path - see ApprovalRepository.
 */
@Serializable
data class DecideApprovalResponse(
    val ok: Boolean = false,
    val decision: String? = null,
    val status: String? = null,
)
