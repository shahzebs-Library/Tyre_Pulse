package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class Approval(
    val id: String,
    val title: String,
    val requester: String,
    val date: String,
    val status: ApprovalStatus,
    val description: String = "",
    val category: String = "General"
)

enum class ApprovalStatus {
    PENDING, APPROVED, REJECTED
}
