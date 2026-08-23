package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.WorkOrder
import com.example.tyre_pulse_app.core.model.WorkOrderStatus
import com.example.tyre_pulse_app.core.model.WorkshopEvent
import com.example.tyre_pulse_app.core.network.api.WorkshopApi
import com.example.tyre_pulse_app.core.network.dto.WorkOrderDto
import com.example.tyre_pulse_app.core.network.dto.WorkshopEventDto
import com.example.tyre_pulse_app.core.network.dto.toDomain
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Workshop reads and writes, all against real PostgREST tables.
 *
 * WHAT THIS REPLACED. Every method here except the event poll called an endpoint
 * that does not exist on this backend: `workshop/jobs`, `workshop/jobs/{id}`,
 * `workshop/jobs/{id}/start`, `workshop/jobs/{id}/complete` and
 * `workshop/jobs/{id}/status` are nested resource routes, and PostgREST has none -
 * it serves tables at /rest/v1/<table> and takes filters as query parameters. The
 * event poll pointed at `workshop_events`, which is not a table; the real one is
 * `public.tech_activity_events`.
 *
 * So "start job" and "complete job" are not bespoke operations - they are a PATCH
 * of the columns that record them: `status`, `started_at`, `completed_at`.
 *
 * STATUS VOCABULARY. `work_orders.status` has NO CHECK constraint and holds free
 * text. Measured across the live table on 2026-08-23: Closed 57,228 /
 * Completed 33,138 / In Progress 94 / Open 73 / Cancelled 1. The writes below use
 * that stored vocabulary rather than the domain enum's UPPER_SNAKE names, because
 * writing "IN_PROGRESS" would introduce a sixth spelling that no other reader -
 * web, mobile or this app's own status folding - recognises.
 */
@Singleton
class WorkshopRepository @Inject constructor(
    private val workshopApi: WorkshopApi
) {

    /**
     * Work orders as a stream.
     *
     * The status filter is applied SERVER-side against the text actually stored.
     * `technicianId` is gone from the signature: the old endpoint took it, but
     * `work_orders` has no technician-id column that can be filtered on - it has a
     * free-text `technician_name` and an `assigned_owner_id` uuid, and silently
     * filtering on the wrong one would return an empty list that reads as "this
     * technician has no work".
     *
     * A failure PROPAGATES. The collector puts the message on screen; emitting an
     * empty list here would render a network failure as "no work orders".
     */
    fun getWorkOrders(
        status: WorkOrderStatus? = null,
        site: String? = null,
        limit: Int = PAGE_SIZE,
    ): Flow<List<WorkOrder>> = flow {
        emit(
            workshopApi.getWorkOrdersRows(
                status = status?.let { "eq.${storedStatusFor(it)}" } ?: OPEN_STATUS_FILTER,
                site = site?.let { "eq.$it" },
                limit = limit,
            ).map(WorkOrderDto::toDomain)
        )
    }

    /**
     * Technician activity events, polled.
     *
     * THE FIRST READ PROPAGATES ITS ERROR; later polls do not. That split is
     * deliberate. If the first read failed silently this flow would never emit, and
     * the screen combines it with the job list - so a broken feed would leave the
     * user on a spinner forever with nothing to explain it. Once the feed has
     * produced at least one result, a transient blip should not tear down a live
     * screen, so subsequent failures keep the last good data and retry.
     */
    fun getLiveEvents(userId: String? = null): Flow<List<WorkshopEvent>> = flow {
        var everEmitted = false
        while (true) {
            if (everEmitted) {
                runCatching { readEvents(userId) }
                    .onSuccess { emit(it) }
            } else {
                emit(readEvents(userId))
                everEmitted = true
            }
            delay(POLL_INTERVAL_MS)
        }
    }

    /**
     * Record one technician activity event against public.tech_activity_events.
     *
     * WHY THIS IS A DIRECT WRITE AND NOT A QUEUED ONE. The screen used to enqueue a
     * `WORKSHOP_EVENT` through SyncRepository, which resolves that command to the
     * table `workshop_events` - a table that does not exist - and then strips the
     * payload down to `id, job_id, technician_name, event_type, timestamp`, three of
     * which are not columns here. Nothing that queue drained could ever have landed,
     * while the screen showed the tap as recorded. A write that reaches the database
     * is worth more than an offline queue that cannot.
     *
     * The event type is checked against the live CHECK vocabulary first, so an
     * unknown token fails with a sentence rather than a raw 400.
     *
     * `organisation_id` is deliberately NOT sent: the column defaults to
     * `app_current_org()`, so the tenant is stamped server-side and a client cannot
     * post into another organisation.
     */
    suspend fun recordEvent(
        userId: String,
        eventType: String,
        jobId: String? = null,
        taskId: String? = null,
        assetNo: String? = null,
        reasonCode: String? = null,
        note: String? = null,
        site: String? = null,
        country: String? = null,
    ): WorkshopEvent {
        require(eventType in WorkshopEventDto.EVENT_TYPES) {
            "'$eventType' is not an activity this backend records. Allowed: " +
                WorkshopEventDto.EVENT_TYPES.sorted().joinToString(", ") + "."
        }
        val body = buildMap<String, JsonElement> {
            put("user_id", JsonPrimitive(userId))
            put("event_type", JsonPrimitive(eventType))
            jobId?.let { put("job_id", JsonPrimitive(it)) }
            taskId?.let { put("task_id", JsonPrimitive(it)) }
            assetNo?.let { put("asset_no", JsonPrimitive(it)) }
            reasonCode?.let { put("reason_code", JsonPrimitive(it)) }
            note?.let { put("note", JsonPrimitive(it)) }
            site?.let { put("site", JsonPrimitive(it)) }
            country?.let { put("country", JsonPrimitive(it)) }
        }
        return workshopApi.postWorkshopEvent(JsonObject(body))
            .firstOrNull()
            ?.toDomain()
            ?: throw IllegalStateException("The activity was not recorded. Nothing was returned by the server.")
    }

    private suspend fun readEvents(userId: String?): List<WorkshopEvent> =
        workshopApi.getWorkshopEvents(
            userId = userId?.let { "eq.$it" },
        ).map(WorkshopEventDto::toDomain)

    /**
     * One work order by id.
     *
     * PostgREST answers a filtered read with an array even for a unique key. An
     * empty array means the row is not there, or RLS hides it - either way the
     * caller must be told, not handed a blank record that looks like a real job
     * with every field empty.
     */
    suspend fun getWorkOrder(id: String): WorkOrder =
        workshopApi.getWorkOrderRow(id = "eq.$id")
            .firstOrNull()
            ?.toDomain()
            ?: throw NoSuchElementException("Work order $id was not found, or you do not have access to it.")

    /**
     * Mark a job started: status plus the timestamp that records when.
     *
     * `started_at` is stamped by the CLIENT because no database trigger sets it -
     * verified against the column defaults. It is an ISO-8601 instant in UTC, which
     * is what Postgres expects for timestamptz.
     */
    suspend fun startJob(id: String): WorkOrder = patch(
        id,
        STATUS to STATUS_IN_PROGRESS,
        "started_at" to nowIso(),
    )

    /**
     * Mark a job complete.
     *
     * `details` is written to `notes`, the only free-text column on the table and
     * the one this app already surfaces as the job's diagnosis. It REPLACES whatever
     * that column held, so a blank `details` writes nothing rather than erasing an
     * existing note.
     */
    suspend fun completeJob(id: String, details: String): WorkOrder {
        val fields = mutableListOf(
            STATUS to STATUS_COMPLETED,
            "completed_at" to nowIso(),
        )
        if (details.isNotBlank()) fields += "notes" to details
        return patch(id, *fields.toTypedArray())
    }

    /**
     * Set a job's status without touching anything else.
     *
     * The caller passes the text to store. It is not derived from
     * [WorkOrderStatus.name] here because that would write UPPER_SNAKE tokens into
     * a column whose live vocabulary is Title Case.
     */
    suspend fun updateWorkOrderStatus(id: String, status: String): WorkOrder =
        patch(id, STATUS to status)

    /**
     * Set a job's status from the domain enum, folded back onto the stored text.
     */
    suspend fun updateWorkOrderStatus(id: String, status: WorkOrderStatus): WorkOrder =
        patch(id, STATUS to storedStatusFor(status))

    private suspend fun patch(id: String, vararg fields: Pair<String, String>): WorkOrder {
        val body = JsonObject(fields.associate { (key, value) -> key to JsonPrimitive(value) })
        return workshopApi.patchWorkOrder(id = "eq.$id", patch = body)
            .firstOrNull()
            ?.toDomain()
            ?: throw NoSuchElementException(
                "Work order $id was not updated - it no longer exists, or you do not have permission to change it."
            )
    }

    private fun nowIso(): String = Instant.now().toString()

    private companion object {
        const val STATUS = "status"

        /**
         * The two write targets, spelled as the table already spells them.
         * Introducing a new spelling would split every report that groups on this
         * column.
         */
        const val STATUS_IN_PROGRESS = "In Progress"
        const val STATUS_COMPLETED = "Completed"

        /**
         * "Open" is the complement of the two terminal states, expressed against the
         * text ACTUALLY stored - the column is free text with no CHECK constraint,
         * and both Closed and Completed are in live use.
         */
        const val OPEN_STATUS_FILTER = "not.in.(Closed,Completed)"
        const val PAGE_SIZE = 50
        const val POLL_INTERVAL_MS = 5_000L

        /**
         * Domain enum -> the text this column stores.
         *
         * WAITING_PARTS, WAITING_APPROVAL, ASSIGNED and READY_FOR_REVIEW have no
         * observed spelling in the live table, so they are written in the Title Case
         * style the column already uses. They are the app's own vocabulary and this
         * is where it enters the data; anything else would be a guess at a spelling
         * nobody has used yet.
         */
        fun storedStatusFor(status: WorkOrderStatus): String = when (status) {
            WorkOrderStatus.NEW -> "Open"
            WorkOrderStatus.ASSIGNED -> "Assigned"
            WorkOrderStatus.IN_PROGRESS -> STATUS_IN_PROGRESS
            WorkOrderStatus.WAITING_PARTS -> "Waiting for Parts"
            WorkOrderStatus.WAITING_APPROVAL -> "Waiting for Approval"
            WorkOrderStatus.READY_FOR_REVIEW -> "Quality Inspection"
            WorkOrderStatus.CLOSED -> STATUS_COMPLETED
            WorkOrderStatus.CANCELLED -> "Cancelled"
        }
    }
}
