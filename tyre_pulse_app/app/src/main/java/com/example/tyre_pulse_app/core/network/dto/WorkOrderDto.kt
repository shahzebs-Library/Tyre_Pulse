package com.example.tyre_pulse_app.core.network.dto

import com.example.tyre_pulse_app.core.model.TaskPriority
import com.example.tyre_pulse_app.core.model.WorkOrder
import com.example.tyre_pulse_app.core.model.WorkOrderStatus
import com.example.tyre_pulse_app.core.model.WorkOrderType
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A row of public.work_orders exactly as PostgREST returns it.
 *
 * WHY A DTO AND NOT THE DOMAIN MODEL. The domain [WorkOrder] uses camelCase names
 * and non-null enums; the table uses snake_case columns that are almost all
 * nullable and hold free text. Deserialising straight into the domain model would
 * fail on the first row with a null asset_no or an unrecognised status.
 *
 * Every field here is nullable on purpose - the table has no NOT NULL constraint on
 * the business columns, so pretending otherwise only moves the crash.
 */
@Serializable
data class WorkOrderDto(
    val id: String? = null,
    @SerialName("work_order_no") val workOrderNo: String? = null,
    @SerialName("asset_no") val assetNo: String? = null,
    val status: String? = null,
    val priority: String? = null,
    @SerialName("work_type") val workType: String? = null,
    val description: String? = null,
    @SerialName("technician_name") val technicianName: String? = null,
    val site: String? = null,
    val country: String? = null,
    val notes: String? = null,
    @SerialName("opened_at") val openedAt: String? = null,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("target_completion") val targetCompletion: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("organisation_id") val organisationId: String? = null,
    @SerialName("assigned_owner_id") val assignedOwnerId: String? = null,
) {
    /**
     * The columns this screen needs. PostgREST returns only what is asked for, so
     * this list and the fields above are a PAIR - a field with no column here
     * silently arrives null.
     */
    companion object {
        const val SELECT = "id,work_order_no,asset_no,status,priority,work_type,description," +
            "technician_name,site,country,notes,opened_at,started_at,completed_at," +
            "target_completion,created_at,organisation_id,assigned_owner_id"
    }
}

/**
 * Fold the stored status text onto the domain enum.
 *
 * The column has NO CHECK constraint and holds free text. Measured across the live
 * table: Closed 57,228 / Completed 33,138 / In Progress 94 / Open 73 / Cancelled 1.
 * Both "Closed" and "Completed" mean finished - the domain has a single terminal
 * state, so both fold onto CLOSED rather than one of them silently becoming NEW.
 *
 * Anything unrecognised becomes NEW, which keeps it VISIBLE in an open-work list.
 * Folding an unknown status to CLOSED would hide real work.
 */
fun workOrderStatusOf(raw: String?): WorkOrderStatus =
    when (raw?.trim()?.lowercase()) {
        "closed", "completed", "complete", "done" -> WorkOrderStatus.CLOSED
        "in progress", "in_progress", "inprogress", "started" -> WorkOrderStatus.IN_PROGRESS
        "cancelled", "canceled" -> WorkOrderStatus.CANCELLED
        "assigned" -> WorkOrderStatus.ASSIGNED
        "waiting for parts", "waiting_parts", "awaiting parts" -> WorkOrderStatus.WAITING_PARTS
        "waiting for approval", "waiting_approval", "awaiting approval" -> WorkOrderStatus.WAITING_APPROVAL
        "quality inspection", "ready for review", "ready_for_review" -> WorkOrderStatus.READY_FOR_REVIEW
        else -> WorkOrderStatus.NEW
    }

/**
 * Live values: Repair 73,560 / Other 9,756 / Emergency 5,846 /
 * Preventive Maintenance 1,034 / Service 338.
 */
fun workOrderTypeOf(raw: String?): WorkOrderType =
    when (raw?.trim()?.lowercase()) {
        "emergency", "breakdown" -> WorkOrderType.BREAKDOWN
        "preventive maintenance", "pm", "service" -> WorkOrderType.PM
        "pmd" -> WorkOrderType.PMD
        "repair", "inspection repair" -> WorkOrderType.INSPECTION_REPAIR
        else -> WorkOrderType.OTHER
    }

fun workOrderPriorityOf(raw: String?): TaskPriority =
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
 * "Unknown asset" would read as data. An empty identifier is visibly absent.
 */
fun WorkOrderDto.toDomain(): WorkOrder = WorkOrder(
    id = id.orEmpty(),
    jobNumber = workOrderNo.orEmpty(),
    // The table carries no separate asset primary key - the asset number IS the key
    // that every other screen joins on.
    assetId = assetNo.orEmpty(),
    assetNumber = assetNo.orEmpty(),
    type = workOrderTypeOf(workType),
    priority = workOrderPriorityOf(priority),
    status = workOrderStatusOf(status),
    reportedIssue = description.orEmpty(),
    diagnosis = notes,
    assignedTechnicianId = assignedOwnerId,
    assignedTechnicianName = technicianName,
    siteId = site,
    createdAt = openedAt ?: createdAt.orEmpty(),
    dueAt = targetCompletion,
    startedAt = startedAt,
    completedAt = completedAt,
    tenantId = organisationId.orEmpty(),
    // The table has no company column. Leaving this blank is deliberate: the app
    // must not invent a company id that no row actually carries.
    companyId = "",
    countryId = country.orEmpty(),
)
