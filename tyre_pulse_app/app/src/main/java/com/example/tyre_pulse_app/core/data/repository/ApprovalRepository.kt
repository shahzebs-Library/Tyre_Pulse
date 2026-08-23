package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.model.ApprovalSource
import com.example.tyre_pulse_app.core.model.ApprovalStatus
import com.example.tyre_pulse_app.core.network.api.ApprovalApi
import com.example.tyre_pulse_app.core.network.dto.ApprovalId
import com.example.tyre_pulse_app.core.network.dto.ChecklistApprovalDto
import com.example.tyre_pulse_app.core.network.dto.DECISION_APPROVED
import com.example.tyre_pulse_app.core.network.dto.DECISION_REJECTED
import com.example.tyre_pulse_app.core.network.dto.DecideChecklistRequest
import com.example.tyre_pulse_app.core.network.dto.DecideInspectionRequest
import com.example.tyre_pulse_app.core.network.dto.InspectionApprovalDto
import com.example.tyre_pulse_app.core.network.dto.approvalStatusFilter
import com.example.tyre_pulse_app.core.network.dto.sanitizeApprovalSearch
import com.example.tyre_pulse_app.core.network.dto.toDomain
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import org.json.JSONObject
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The approvals queue, read from the records that carry an approval state.
 *
 * WHAT WAS HERE. This called `GET /rest/v1/approvals`, and there is no such
 * table - so every call 404'd. On any failure, and on any empty result, it
 * emitted two invented approvals ("Replace 4 Tyres on TRK-09" from "Ahmed S.").
 * Users saw pending work that did not exist and could act on it.
 *
 * The fabrication is gone and the read now points at the real tables. Failures
 * still PROPAGATE - the collecting ViewModel distinguishes an error from an
 * empty result, because "nothing to approve" and "we could not check" are
 * opposite statements and must never render the same.
 *
 * TWO SOURCES, ONE QUEUE. PostgREST cannot union two tables in one request, so
 * this issues one read per source and merges. That is not an implementation
 * detail to hide: an approval genuinely IS a state on a record, and there are
 * two kinds of record.
 */
@Singleton
class ApprovalRepository @Inject constructor(
    private val approvalApi: ApprovalApi
) {

    /**
     * One page of the queue.
     *
     * PAGING ACROSS TWO SOURCES. Each source is paged independently at the same
     * offset, so no row is ever duplicated or skipped, but a "page" can contain
     * up to 2x [pageSize] rows. The caller's end-of-list rule (a short page)
     * therefore costs at most one extra empty request before it terminates -
     * which is the honest trade against silently dropping rows from whichever
     * source happened to be shorter.
     *
     * @param category null for every source, otherwise [ApprovalSource.label].
     */
    fun getApprovals(
        status: ApprovalStatus,
        query: String = "",
        category: String? = null,
        page: Int = 0,
        pageSize: Int = 20
    ): Flow<List<Approval>> = flow {
        val offset = page * pageSize
        val term = sanitizeApprovalSearch(query)
        // A search box holding only punctuation sanitises to nothing. Sending an
        // empty `ilike.**` would match every row, so the filter is dropped
        // instead - the user gets the unfiltered queue, not a silently wrong one.
        val searching = term.isNotEmpty()

        val wanted = ApprovalSource.entries.filter { category == null || category == it.label }

        val rows = mutableListOf<Approval>()

        for (source in wanted) {
            val filter = approvalStatusFilter(source, status)
            when (source) {
                ApprovalSource.INSPECTION -> approvalApi.getInspectionApprovals(
                    approvalStatus = filter,
                    or = if (searching) InspectionApprovalDto.searchFilter(term) else null,
                    limit = pageSize,
                    offset = offset,
                ).mapTo(rows) { it.toDomain() }

                ApprovalSource.CHECKLIST -> approvalApi.getChecklistApprovals(
                    approvalStatus = filter,
                    or = if (searching) ChecklistApprovalDto.searchFilter(term) else null,
                    limit = pageSize,
                    offset = offset,
                ).mapTo(rows) { it.toDomain() }
            }
        }

        // Newest first across the merged set. The two sources carry different
        // precision - an inspection date is a DAY, a submission is a TIMESTAMP -
        // so ordering is on the day first, then the full value. Comparing the raw
        // strings alone would sort every inspection below every same-day
        // checklist purely because one is longer.
        emit(rows.sortedWith(compareByDescending<Approval> { it.date.take(10) }.thenByDescending { it.date }))
    }

    /**
     * How many items are waiting for a decision, for the Home tile.
     *
     * Throws on failure rather than returning 0 - the caller turns a failure into a
     * dash. A failed read reported as "0 approvals waiting" is exactly the class of
     * quiet wrongness this module was full of.
     *
     * Bounded: this is a headline figure, not a list, and the cap is stated rather
     * than a capped number being presented as exact.
     */
    suspend fun pendingCount(): Int =
        getApprovals(status = ApprovalStatus.PENDING, pageSize = COUNT_CAP).first().size

    /**
     * One record, by the composite id the queue minted.
     *
     * Emits null when the id names no row - the caller renders that as "not
     * found" rather than sitting on a spinner. An id this module did not mint
     * has no source, so there is nothing to query; that is an empty result, not
     * a guess at which table to try.
     */
    fun getApprovalById(id: String): Flow<Approval?> = flow {
        val rowId = ApprovalId.rowIdOf(id)
        if (rowId.isEmpty()) {
            emit(null)
            return@flow
        }
        val approval = when (ApprovalId.sourceOf(id)) {
            ApprovalSource.INSPECTION ->
                approvalApi.getInspectionApproval(id = "eq.$rowId").firstOrNull()?.toDomain()

            ApprovalSource.CHECKLIST ->
                approvalApi.getChecklistApproval(id = "eq.$rowId").firstOrNull()?.toDomain()

            null -> null
        }
        emit(approval)
    }

    /**
     * Record a decision.
     *
     * Routes to the RPC that owns this record's rules. NOT a table PATCH: the
     * RPC is where the approver check, the already-decided guard and the
     * checklist rung ladder actually live, and it derives the approver from the
     * session rather than trusting anything sent from here.
     *
     * THIS REPLACES A WRITE THAT WENT NOWHERE. The detail screen used to enqueue
     * a sync command of type "UPDATE_APPROVAL"; nothing anywhere consumes that
     * type, so SyncRepository fell through to its default and POSTed the payload
     * to `/rest/v1/update_approval` - a table that does not exist. The request
     * 404'd in the background queue while the screen navigated back as though
     * the decision had been recorded. A silent failure that looks like success is
     * worse than an error, so this call is awaited and its refusal is surfaced.
     *
     * @param signature the approver's mark as an SVG document. Required by the
     *        checklist RPC to approve; it refuses rather than storing an unsigned
     *        sign-off. Never send a placeholder here.
     * @throws IllegalArgumentException if the id names no known source.
     * @throws Exception carrying the server's own sentence on refusal.
     */
    suspend fun decide(
        approvalId: String,
        approved: Boolean,
        note: String? = null,
        signature: String? = null,
    ) {
        val rowId = ApprovalId.rowIdOf(approvalId)
        // Checked with an explicit branch rather than a compound `require`, so the
        // non-null narrowing of `source` does not depend on contract inference.
        val source = ApprovalId.sourceOf(approvalId)
            ?: throw IllegalArgumentException("That approval cannot be decided from here.")
        if (rowId.isEmpty()) {
            throw IllegalArgumentException("That approval cannot be decided from here.")
        }

        val decision = if (approved) DECISION_APPROVED else DECISION_REJECTED
        val cleanNote = note?.trim()?.takeIf { it.isNotEmpty() }

        try {
            when (source) {
                ApprovalSource.INSPECTION -> approvalApi.decideInspection(
                    DecideInspectionRequest(
                        inspectionId = rowId,
                        decision = decision,
                        note = cleanNote,
                        signature = signature,
                    )
                )

                ApprovalSource.CHECKLIST -> approvalApi.decideChecklist(
                    DecideChecklistRequest(
                        submissionId = rowId,
                        decision = decision,
                        note = cleanNote,
                        signature = signature,
                    )
                )
            }
        } catch (e: HttpException) {
            // A raised guard arrives as HTTP 400 with the sentence in the body.
            // Those sentences are written to be read by an operator - "This
            // inspection was already approved by X." - so surfacing the raw
            // "HTTP 400" instead would throw away the only useful part.
            throw Exception(rpcMessage(e) ?: "That decision could not be recorded.", e)
        }
    }

    /**
     * Pull PostgREST's `message` out of an error body, or null when the body is
     * not the shape we expect. Never returns the raw body: it can carry schema
     * detail that means nothing to an operator.
     */
    private fun rpcMessage(e: HttpException): String? = try {
        val body = e.response()?.errorBody()?.string()
        if (body.isNullOrBlank()) null
        else JSONObject(body).optString("message").takeIf { it.isNotBlank() }
    } catch (_: Exception) {
        null
    }

    private companion object {
        /** A tile shows "200+" at this point rather than a number it cannot support. */
        const val COUNT_CAP = 200
    }
}
