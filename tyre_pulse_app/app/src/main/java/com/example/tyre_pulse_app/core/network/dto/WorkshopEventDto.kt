package com.example.tyre_pulse_app.core.network.dto

import com.example.tyre_pulse_app.core.model.WorkshopEvent
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A row of public.tech_activity_events exactly as PostgREST returns it.
 *
 * WHY THIS EXISTS. `WorkshopApi.getWorkshopEvents` was declared as
 * `@GET("workshop_events")` returning the domain [WorkshopEvent] directly. Two
 * separate faults:
 *
 *  1. There is no `workshop_events` table. The real one is
 *     `public.tech_activity_events` - verified against information_schema on
 *     2026-08-23.
 *  2. Even pointed at the right table it could not deserialise. The domain model
 *     uses camelCase names (`userId`, `eventType`, `assetNo`) and three non-null
 *     fields with no defaults (`id`, `userId`, `eventType`, `at`); the table uses
 *     snake_case columns, most of them nullable. A missing key on a field with no
 *     default is a MissingFieldException, not a null - so the very first row would
 *     have thrown.
 *
 * Every field here is nullable on purpose, matching the WorkOrderDto precedent:
 * the table has no NOT NULL constraint on most business columns, and pretending
 * otherwise only moves the crash.
 *
 * COLUMNS THIS TABLE DOES NOT HAVE, so nothing here invents them:
 *  - `photos` - the domain model carries a `photos` list; the table has no such
 *    column, so it stays null rather than being filled with an empty list that
 *    would read as "checked, none attached".
 *  - `timestamp` / `technician_name` - the column is `at`, and the person is a
 *    `user_id` uuid, not a name.
 */
@Serializable
data class WorkshopEventDto(
    val id: String? = null,
    @SerialName("organisation_id") val organisationId: String? = null,
    @SerialName("user_id") val userId: String? = null,
    @SerialName("job_id") val jobId: String? = null,
    @SerialName("task_id") val taskId: String? = null,
    @SerialName("asset_no") val assetNo: String? = null,
    @SerialName("event_type") val eventType: String? = null,
    @SerialName("reason_code") val reasonCode: String? = null,
    val note: String? = null,
    val device: String? = null,
    @SerialName("gps_lat") val gpsLat: Double? = null,
    @SerialName("gps_lng") val gpsLng: Double? = null,
    @SerialName("foreman_confirmed") val foremanConfirmed: Boolean? = null,
    @SerialName("confirmed_by") val confirmedBy: String? = null,
    val at: String? = null,
    val site: String? = null,
    val country: String? = null,
    @SerialName("created_by") val createdBy: String? = null,
    @SerialName("client_uuid") val clientUuid: String? = null,
) {
    /**
     * The columns this screen needs. PostgREST returns only what is asked for, so
     * this list and the fields above are a PAIR - a field with no column here
     * silently arrives null.
     */
    companion object {
        const val SELECT = "id,organisation_id,user_id,job_id,task_id,asset_no,event_type," +
            "reason_code,note,device,gps_lat,gps_lng,foreman_confirmed,confirmed_by,at," +
            "site,country,created_by,client_uuid"

        /**
         * The event vocabulary, mirroring the live CHECK constraint
         * `tech_activity_events_event_type_check`. Writing a token outside this set
         * is rejected by the database, so the UI must not offer one.
         */
        const val CHECK_IN = "check_in"
        const val CHECK_OUT = "check_out"
        const val START_JOB = "start_job"
        const val PAUSE_JOB = "pause_job"
        const val RESUME_JOB = "resume_job"
        const val COMPLETE_TASK = "complete_task"
        const val REQUEST_PARTS = "request_parts"
        const val REQUEST_ASSISTANCE = "request_assistance"
        const val WAITING_APPROVAL = "waiting_approval"
        const val WAITING_VEHICLE = "waiting_vehicle"
        const val WAITING_TOOLS = "waiting_tools"
        const val START_BREAK = "start_break"
        const val END_BREAK = "end_break"
        const val TRAINING = "training"
        const val REPORT_PROBLEM = "report_problem"

        /**
         * The whole legal set, so a writer can refuse an out-of-vocabulary token
         * BEFORE the round trip instead of surfacing a raw constraint violation.
         */
        val EVENT_TYPES: Set<String> = setOf(
            CHECK_IN, CHECK_OUT, START_JOB, PAUSE_JOB, RESUME_JOB, COMPLETE_TASK,
            REQUEST_PARTS, REQUEST_ASSISTANCE, WAITING_APPROVAL, WAITING_VEHICLE,
            WAITING_TOOLS, START_BREAK, END_BREAK, TRAINING, REPORT_PROBLEM,
        )
    }
}

/**
 * Map a row to the domain model.
 *
 * Where the table has no value the identifier becomes an empty string rather than
 * an invented one - the domain model demands non-null, and a placeholder such as
 * "unknown" would read as data. An empty identifier is visibly absent.
 */
fun WorkshopEventDto.toDomain(): WorkshopEvent = WorkshopEvent(
    id = id.orEmpty(),
    userId = userId.orEmpty(),
    jobId = jobId,
    taskId = taskId,
    assetNo = assetNo,
    eventType = eventType.orEmpty(),
    reasonCode = reasonCode,
    note = note,
    // No `photos` column on this table - see the class note. Null means "this
    // table cannot say", which is the truth; emptyList() would claim it checked.
    photos = null,
    at = at.orEmpty(),
    site = site,
    country = country,
    device = device,
    gpsLat = gpsLat,
    gpsLng = gpsLng,
)
