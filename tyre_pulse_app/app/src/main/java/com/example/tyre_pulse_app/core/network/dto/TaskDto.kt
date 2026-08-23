package com.example.tyre_pulse_app.core.network.dto

import com.example.tyre_pulse_app.core.model.Task
import com.example.tyre_pulse_app.core.model.TaskPriority
import com.example.tyre_pulse_app.core.model.TaskStatus
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A row of public.corrective_actions exactly as PostgREST returns it.
 *
 * WHY THIS TABLE. `TaskApi` used to declare `tasks`, `tasks/{id}` and
 * `tasks/{id}/status`. There is no `tasks` table in this database, and the last of
 * those is not a PostgREST path shape at all, so every call 404'd.
 *
 * Five tables could plausibly have backed "a task". They were measured rather than
 * guessed at (live, 2026-08-23):
 *
 *   corrective_actions      3 rows   <- the one in use
 *   wo_tasks                0 rows
 *   action_items            0 rows
 *   accident_case_tasks     0 rows
 *   accident_repair_tasks   0 rows
 *   onboarding_tasks        0 rows
 *
 * corrective_actions is also what the shipped Expo app treats as a task, which
 * settles it: mobile/app/(app)/tasks.tsx selects
 * id,title,priority,status,site,asset_no,description,assigned_to,due_date,created_at
 * from it, and mobile/lib/recordQueue.ts maps its REPORT_ISSUE command to an INSERT
 * into corrective_actions and CORRECTIVE_ACTION_STATUS to an UPDATE of it. Per
 * AGENTS.md the existing mobile implementation outranks the current native code.
 *
 * Every field is nullable. title and source_type are the only NOT NULL business
 * columns; pretending the rest are non-null only moves the crash.
 */
@Serializable
data class TaskDto(
    val id: String? = null,
    val title: String? = null,
    val description: String? = null,
    val status: String? = null,
    val priority: String? = null,
    val site: String? = null,
    val region: String? = null,
    val country: String? = null,
    @SerialName("asset_no") val assetNo: String? = null,
    @SerialName("tyre_serial") val tyreSerial: String? = null,
    /**
     * A person's NAME, not a user id - live values are "shahzeb Rahman",
     * "Mr. Sarang". It maps to assignedToName, and assignedToId is left null,
     * because there is no id here to report.
     */
    @SerialName("assigned_to") val assignedTo: String? = null,
    @SerialName("due_date") val dueDate: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("closed_at") val closedAt: String? = null,
    @SerialName("resolved_at") val resolvedAt: String? = null,
    @SerialName("created_by") val createdBy: String? = null,
    @SerialName("organisation_id") val organisationId: String? = null,
    @SerialName("source_type") val sourceType: String? = null,
    @SerialName("source_id") val sourceId: String? = null,
    @SerialName("source_detail") val sourceDetail: String? = null,
    @SerialName("root_cause") val rootCause: String? = null,
    @SerialName("work_order_id") val workOrderId: String? = null,
) {
    companion object {
        /**
         * The columns this screen needs. PostgREST returns only what is asked for,
         * so this list and the fields above are a PAIR - a field with no column
         * here silently arrives null.
         *
         * Column names verified against information_schema on 2026-08-23. NOTE that
         * the table has NO updated_at column; see [toDomain].
         */
        const val SELECT = "id,title,description,status,priority,site,region,country," +
            "asset_no,tyre_serial,assigned_to,due_date,created_at,closed_at,resolved_at," +
            "created_by,organisation_id,source_type,source_id,source_detail,root_cause," +
            "work_order_id"

        /**
         * "Open" is the complement of the one terminal state, expressed against the
         * text ACTUALLY stored. The column has no CHECK constraint; measured live it
         * holds only "Open" and "Closed", and the Expo app defines open the same way
         * ((status ?? '').toLowerCase() !== 'closed').
         *
         * Written as a PostgREST filter so the narrowing happens server-side.
         */
        const val OPEN_STATUS_FILTER = "not.in.(Closed,closed)"
    }
}

/**
 * Fold the stored status text onto the domain enum.
 *
 * Anything unrecognised becomes OPEN, which keeps it VISIBLE in a work list.
 * Folding an unknown status to COMPLETED would hide real work - the same reasoning
 * as [workOrderStatusOf].
 */
fun taskStatusOf(raw: String?): TaskStatus =
    when (raw?.trim()?.lowercase()) {
        "closed", "completed", "complete", "done", "resolved" -> TaskStatus.COMPLETED
        "in progress", "in_progress", "inprogress", "started" -> TaskStatus.IN_PROGRESS
        "waiting", "on hold", "on_hold", "blocked", "pending" -> TaskStatus.WAITING
        "cancelled", "canceled" -> TaskStatus.CANCELLED
        else -> TaskStatus.OPEN
    }

/**
 * The text the server stores for a domain status.
 *
 * This is the INVERSE of [taskStatusOf] and the two are a pair - change both. It
 * writes the vocabulary already present in the column ("Open" / "Closed") rather
 * than the enum name, so a row this app closes is indistinguishable from one the
 * Expo app or the web closed, and every other reader's "is it closed" test keeps
 * working.
 */
fun taskStatusToColumn(status: TaskStatus): String =
    when (status) {
        TaskStatus.COMPLETED -> "Closed"
        TaskStatus.IN_PROGRESS -> "In Progress"
        TaskStatus.WAITING -> "Waiting"
        TaskStatus.CANCELLED -> "Cancelled"
        TaskStatus.OPEN -> "Open"
    }

/**
 * Live values are Critical / High / Medium / Low - the same four the Expo app
 * colours by. Unrecognised text becomes MEDIUM rather than URGENT, so a typo
 * cannot promote a routine job to the top of the list.
 */
fun taskPriorityOf(raw: String?): TaskPriority =
    when (raw?.trim()?.lowercase()) {
        "low" -> TaskPriority.LOW
        "high" -> TaskPriority.HIGH
        "urgent", "critical" -> TaskPriority.URGENT
        else -> TaskPriority.MEDIUM
    }

/**
 * Map a row to the domain model.
 *
 * Where the table has no value the field becomes an empty string rather than an
 * invented one: the domain model demands non-null, but a placeholder like
 * "Unassigned" would read as data. An empty identifier is visibly absent.
 */
fun TaskDto.toDomain(): Task = Task(
    id = id.orEmpty(),
    title = title.orEmpty(),
    description = description,
    status = taskStatusOf(status),
    priority = taskPriorityOf(priority),
    // How the item was raised - live values include "manual". This is the nearest
    // real column to the domain's `type`; there is no separate task-type column.
    type = sourceType.orEmpty(),
    relatedEntityType = sourceType,
    // What the item was raised FROM, when it came from an inspection or a work
    // order rather than by hand.
    relatedEntityId = sourceId ?: workOrderId,
    // Deliberately null: assigned_to holds a NAME, not an id. Reporting a name as
    // an id would make every id-keyed lookup downstream silently miss.
    assignedToId = null,
    assignedToName = assignedTo,
    createdById = createdBy.orEmpty(),
    // The table carries no creator name and no join to one. Left blank rather than
    // filled with the id, which would render as a uuid where a person's name
    // belongs.
    createdByName = "",
    dueDate = dueDate,
    createdAt = createdAt.orEmpty(),
    // The table has NO updated_at column (verified against information_schema).
    // closed_at / resolved_at are only set when the item is closed, so using one of
    // them here would assert a modification time for rows that have none. Blank is
    // the honest answer.
    updatedAt = "",
    tenantId = organisationId.orEmpty(),
    // The table has no company column. Blank is deliberate: the app must not invent
    // a company id that no row actually carries.
    companyId = "",
    countryId = country.orEmpty(),
    siteId = site,
)
