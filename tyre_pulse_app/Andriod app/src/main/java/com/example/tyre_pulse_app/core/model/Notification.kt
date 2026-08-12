package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Maps onto the real `notifications` table (id, user_id, type, title, body, entity_type, entity_id, read, created_at). */
@Serializable
data class Notification(
    val id: String,
    @SerialName("user_id") val userId: String? = null,
    val title: String,
    @SerialName("body") val message: String,
    /** Server-defined dot-path key, e.g. "workshop.assigned", "inspection.approval_requested". */
    val type: String,
    @SerialName("entity_type") val relatedEntityType: String? = null,
    @SerialName("entity_id") val relatedEntityId: String? = null,
    @SerialName("read") val isRead: Boolean = false,
    @SerialName("created_at") val createdAt: String
)
