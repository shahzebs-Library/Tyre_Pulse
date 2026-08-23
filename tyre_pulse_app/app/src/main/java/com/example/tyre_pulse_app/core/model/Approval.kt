package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

/**
 * Which record an approval is a state ON.
 *
 * There is no `approvals` table in this database. An approval is a column on the
 * record being approved, so the queue is a union of the records that are waiting
 * and every row must carry where it came from - the detail screen needs it to
 * pick the right decision RPC.
 *
 * [token] is the id prefix (see ApprovalId) and MUST stay stable: it is baked
 * into navigation arguments. [label] is what a person reads, and doubles as the
 * category filter on the list - the source IS the category, which is a real fact
 * about the row rather than an invented taxonomy.
 */
enum class ApprovalSource(val token: String, val label: String) {
    /** public.inspections.approval_status */
    INSPECTION("inspection", "Inspection"),

    /** public.checklist_submissions.approval_status */
    CHECKLIST("checklist", "Checklist"),
}

/**
 * One record waiting on, or already carrying, a sign-off decision.
 *
 * The nullable fields are nullable BECAUSE THE SOURCE MAY NOT CARRY THEM, and a
 * null must render as absent - never as a plausible-looking default. Neither
 * backing table has a priority column, for instance, so this model has no
 * priority field; the detail screen used to print a hard-coded "Medium".
 */
@Serializable
data class Approval(
    /**
     * `<source token>_<row uuid>` - see ApprovalId. Not the bare primary key,
     * because two tables feed this one queue.
     */
    val id: String,
    val title: String,
    /** Empty when the record names nobody. Never a placeholder name. */
    val requester: String,
    /** ISO date/timestamp as stored. Empty when the record carries no date. */
    val date: String,
    val status: ApprovalStatus,
    val description: String = "",
    /** Human label for [source]; kept as a plain string for the list filter. */
    val category: String = "General",
    val source: ApprovalSource = ApprovalSource.INSPECTION,
    /** public.<table>.asset_no. Null when the record is not against an asset. */
    val assetNo: String? = null,
    /** public.<table>.site. Null when the record carries no site. */
    val site: String? = null,
    /**
     * WHICH RUNG a still-waiting record is on, in plain words, or null when the
     * source has a single decision rather than a ladder.
     *
     * A checklist has two rungs - a supervisor signs, then an area manager
     * closes - and both sit under one domain status of PENDING. Saying
     * "Waiting for the area manager" is the difference between a reader knowing
     * who is holding it and reading "pending", which says nothing.
     */
    val stage: String? = null,
)

enum class ApprovalStatus {
    PENDING, APPROVED, REJECTED
}
