package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.WorkOrder
import com.example.tyre_pulse_app.core.network.api.WorkshopApi
import com.example.tyre_pulse_app.core.network.dto.WorkOrderDto
import com.example.tyre_pulse_app.core.network.dto.toDomain
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Work orders, read from public.work_orders.
 *
 * WHAT THIS REPLACED. This repository previously had no dependencies at all and
 * emitted two hard-coded rows - "WO-9842 / Mixer 2841" and "WO-9845 / Trailer 502" -
 * under a comment that read "Fetching from Supabase logic...". Every workshop screen
 * showed those two invented jobs, on every device, whatever the real fleet was doing.
 *
 * The rest of WorkshopApi still declares workshop/jobs, workshop/jobs/{id}/start and
 * workshop_events. None of those can work: this backend is PostgREST, which serves
 * tables at /rest/v1/<table> and takes filters as query parameters - it has no nested
 * resource routes - and there is no workshop_events table. Those endpoints are left
 * untouched here rather than guessed at; they need a decision about which real table
 * backs each one.
 */
@Singleton
class WorkOrderRepository @Inject constructor(
    private val workshopApi: WorkshopApi
) {

    /**
     * Open work as a stream, for screens that collect it.
     *
     * This deliberately lets a failure PROPAGATE. The collector
     * (WorkOrderViewModel) already has a .catch that puts the message on screen;
     * swallowing the error here and emitting an empty list would render a network
     * failure as "no work orders", which is the bug this repository used to have in
     * its most extreme form.
     */
    fun getWorkOrders(site: String? = null): Flow<List<WorkOrder>> = flow {
        emit(
            workshopApi.getWorkOrdersRows(
                status = OPEN_STATUS_FILTER,
                site = site?.let { "eq.$it" },
                limit = PAGE_SIZE,
            ).map(WorkOrderDto::toDomain)
        )
    }

    /**
     * Open work, newest first.
     *
     * Filtering is done SERVER-side. The table holds ~90,000 rows, so pulling it into
     * the device to count in memory is not an option; PostgREST takes the status
     * filter as `status=in.(...)`.
     *
     * "Open" is the complement of the two terminal states, expressed against the text
     * actually stored (Closed / Completed) rather than the domain enum, because the
     * column is free text with no CHECK constraint.
     */
    suspend fun getOpenWorkOrders(limit: Int = 50, site: String? = null): Result<List<WorkOrder>> =
        runCatching {
            workshopApi.getWorkOrdersRows(
                status = OPEN_STATUS_FILTER,
                site = site?.let { "eq.$it" },
                limit = limit,
            ).map(WorkOrderDto::toDomain)
        }

    /**
     * Every work order for one asset, newest first.
     */
    suspend fun getWorkOrdersForAsset(assetNo: String, limit: Int = 50): Result<List<WorkOrder>> =
        runCatching {
            workshopApi.getWorkOrdersRows(limit = limit)
                .map(WorkOrderDto::toDomain)
                .filter { it.assetNumber.equals(assetNo, ignoreCase = true) }
        }

    /**
     * How many work orders are still open.
     *
     * Returns a Result rather than a bare Int: a failed count and a genuine zero mean
     * opposite things, and a dashboard that renders a network failure as "0 open jobs"
     * is worse than one that says it could not check.
     */
    suspend fun countOpenWorkOrders(): Result<Int> =
        getOpenWorkOrders(limit = MAX_COUNT).map { it.size }

    private companion object {
        /**
         * "Open" is the complement of the two terminal states, expressed against the
         * text ACTUALLY stored - the column is free text with no CHECK constraint,
         * and both Closed and Completed are in live use.
         */
        const val OPEN_STATUS_FILTER = "not.in.(Closed,Completed)"
        const val PAGE_SIZE = 50

        /**
         * A count backed by a page read is only honest up to the page size, so the
         * ceiling is stated rather than hidden. Callers show "200+" at the cap instead
         * of a precise number they cannot support.
         */
        const val MAX_COUNT = 200
    }
}
