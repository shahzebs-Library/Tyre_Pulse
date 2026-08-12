package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class Task(
    val id: String,
    val title: String,
    val description: String? = null,
    val status: TaskStatus,
    val priority: TaskPriority,
    val type: String, // e.g., "INSPECTION", "REPLACEMENT", "REPAIR"
    val relatedEntityType: String? = null,
    val relatedEntityId: String? = null,
    val assignedToId: String? = null,
    val assignedToName: String? = null,
    val createdById: String,
    val createdByName: String,
    val dueDate: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val tenantId: String,
    val companyId: String,
    val countryId: String,
    val siteId: String? = null
)

@Serializable
enum class TaskStatus {
    OPEN, IN_PROGRESS, WAITING, COMPLETED, CANCELLED
}

@Serializable
enum class TaskPriority {
    LOW, MEDIUM, HIGH, URGENT
}
