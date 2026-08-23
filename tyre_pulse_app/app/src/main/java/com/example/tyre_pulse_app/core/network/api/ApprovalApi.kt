package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.network.dto.ChecklistApprovalDto
import com.example.tyre_pulse_app.core.network.dto.DecideApprovalResponse
import com.example.tyre_pulse_app.core.network.dto.DecideChecklistRequest
import com.example.tyre_pulse_app.core.network.dto.DecideInspectionRequest
import com.example.tyre_pulse_app.core.network.dto.InspectionApprovalDto
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * Approvals over PostgREST.
 *
 * WHAT WAS HERE: `@GET("approvals")` and `@GET("approvals")` filtered by id.
 * There is no `approvals` table in this database, so both 404'd on every call,
 * and the repository hid that by emitting two invented approvals.
 *
 * Approval state is a COLUMN ON THE RECORD, so the queue is a union of the
 * records that carry one. Two sources are served here; each gets its own read,
 * because their `approval_status` vocabularies differ (see ApprovalDto) and
 * PostgREST cannot union two tables in one request.
 *
 * The base URL already ends in `/rest/v1/`, so a path must NOT repeat it - that
 * double-prefix bug is what broke ChecklistApi. Filters are query parameters;
 * there are no nested resource routes, which is why a decision is an `rpc/` POST
 * rather than `approvals/{id}/decide`.
 */
interface ApprovalApi {

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    /**
     * Inspections in one approval state.
     *
     * @param approvalStatus a PostgREST operator string, e.g. `eq.pending_approval`.
     *        Built by `approvalStatusFilter` - never hand-written at a call site,
     *        because the token differs per source.
     * @param or an optional `(col.ilike.*x*,...)` free-text filter. Omitted when
     *        null; an empty string here would be sent as a malformed filter.
     */
    @GET("inspections")
    suspend fun getInspectionApprovals(
        @Query("approval_status") approvalStatus: String,
        @Query("or") or: String? = null,
        @Query("select") select: String = InspectionApprovalDto.SELECT,
        @Query("order") order: String = InspectionApprovalDto.ORDER,
        @Query("limit") limit: Int = 20,
        @Query("offset") offset: Int = 0,
    ): List<InspectionApprovalDto>

    /** One inspection by primary key. PostgREST filters by `?id=eq.X`, not a path segment. */
    @GET("inspections")
    suspend fun getInspectionApproval(
        @Query("id") id: String,
        @Query("select") select: String = InspectionApprovalDto.SELECT,
        @Query("limit") limit: Int = 1,
    ): List<InspectionApprovalDto>

    /**
     * Checklist submissions in one approval state.
     *
     * PENDING here is `in.(pending,pending_area_manager)` - a sheet a supervisor
     * has already signed is still waiting, on the area manager.
     */
    @GET("checklist_submissions")
    suspend fun getChecklistApprovals(
        @Query("approval_status") approvalStatus: String,
        @Query("or") or: String? = null,
        @Query("select") select: String = ChecklistApprovalDto.SELECT,
        @Query("order") order: String = ChecklistApprovalDto.ORDER,
        @Query("limit") limit: Int = 20,
        @Query("offset") offset: Int = 0,
    ): List<ChecklistApprovalDto>

    /** One checklist submission by primary key. */
    @GET("checklist_submissions")
    suspend fun getChecklistApproval(
        @Query("id") id: String,
        @Query("select") select: String = ChecklistApprovalDto.SELECT,
        @Query("limit") limit: Int = 1,
    ): List<ChecklistApprovalDto>

    // -----------------------------------------------------------------------
    // Decisions
    // -----------------------------------------------------------------------

    /**
     * Approve or return an inspection.
     *
     * SECURITY DEFINER; it derives the approver from `auth.uid()`, refuses anyone
     * outside Admin / PMV Manager / Workshop (Maintenance) Area Manager / Tyre
     * Data Collector, and only updates a row still at `pending_approval` - so a
     * second approver gets "This inspection was already approved by X." instead
     * of silently overwriting the first one's signature.
     *
     * A refusal arrives as HTTP 400 with the raised message in the body.
     */
    @POST("rpc/decide_inspection_approval")
    suspend fun decideInspection(@Body body: DecideInspectionRequest): DecideApprovalResponse

    /**
     * Approve or return a checklist submission.
     *
     * Resolves the RUNG server-side: a supervisor signing a two-stage sheet moves
     * it to `pending_area_manager`, and only an area manager can close it. It
     * also REQUIRES a signature to approve - passing none raises "A signature is
     * required to sign off this checklist." rather than storing an unsigned
     * approval.
     */
    @POST("rpc/decide_checklist_approval")
    suspend fun decideChecklist(@Body body: DecideChecklistRequest): DecideApprovalResponse
}
