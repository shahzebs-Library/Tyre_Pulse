package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class Notification(
    val id: String,
    val title: String,
    val message: String,
    val type: NotificationType,
    val category: String, // e.g., "APPROVAL", "TASK", "INSPECTION"
    val relatedEntityType: String? = null,
    val relatedEntityId: String? = null,
    val isRead: Boolean = false,
    val createdAt: String,
    val tenantId: String,
    val companyId: String,
    val countryId: String,
    val siteId: String? = null
)

@Serializable
enum class NotificationType {
    INFO, SUCCESS, WARNING, ERROR, ACTION_REQUIRED
}
