package com.example.tyre_pulse_app.core.workflow

import com.example.tyre_pulse_app.core.authentication.UserRole

data class WorkflowState(
    val status: String,
    val allowedActions: List<String>,
    val requiresApproval: Boolean = false
)

object WorkflowEngine {

    /**
     * Logic for Enterprise Workflow Port: Handles state transitions
     * based on role permissions (Supervisor, Manager, etc.)
     */
    fun getNextState(currentStatus: String, role: UserRole): WorkflowState {
        return when (currentStatus) {
            "Draft" -> WorkflowState("Submitted", listOf("Edit", "Submit"), true)
            "Submitted" -> {
                if (role in listOf(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPERVISOR)) {
                    WorkflowState("Approved", listOf("Approve", "Reject"), false)
                } else {
                    WorkflowState("Submitted", emptyList(), true)
                }
            }
            "Approved" -> WorkflowState("Closed", listOf("Archive"), false)
            else -> WorkflowState(currentStatus, emptyList())
        }
    }
}
