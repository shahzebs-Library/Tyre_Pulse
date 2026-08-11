package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class WorkOrder(
    val id: String,
    val jobNumber: String,
    val assetId: String,
    val assetNumber: String,
    val type: WorkOrderType,
    val priority: TaskPriority,
    val status: WorkOrderStatus,
    val reportedIssue: String,
    val diagnosis: String? = null,
    val actionTaken: String? = null,
    val assignedTechnicianId: String? = null,
    val assignedTechnicianName: String? = null,
    val siteId: String? = null,
    val createdAt: String,
    val dueAt: String? = null,
    val startedAt: String? = null,
    val completedAt: String? = null,
    val tenantId: String,
    val companyId: String,
    val countryId: String,
    val parts: List<WorkOrderPart> = emptyList(),
    val photos: List<String> = emptyList()
)

@Serializable
enum class WorkOrderType {
    BREAKDOWN, PM, PMD, INSPECTION_REPAIR, OTHER
}

@Serializable
enum class WorkOrderStatus {
    NEW, ASSIGNED, IN_PROGRESS, WAITING_PARTS, WAITING_APPROVAL, READY_FOR_REVIEW, CLOSED, CANCELLED
}

@Serializable
data class WorkOrderPart(
    val id: String,
    val name: String,
    val partNumber: String,
    val requestedQuantity: Double,
    val issuedQuantity: Double = 0.0,
    val status: String // e.g., "PENDING", "ISSUED", "REJECTED"
)
