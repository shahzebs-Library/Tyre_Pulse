package com.example.tyre_pulse_app.core.workflow

import com.example.tyre_pulse_app.core.authentication.UserRole
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.jsonPrimitive

@Serializable
data class WorkflowStep(
    val name: String,
    val approver_role: String,
    val sla_hours: Int? = null,
    val condition: WorkflowCondition? = null,
    val require_signature: Boolean = false
)

@Serializable
data class WorkflowCondition(
    val field: String,
    val op: String, // ">=", "==", "<="
    val value: Float
)

/**
 * Agent 45: Universal Workflow Engine.
 * Replicates backend logic to gate UI actions based on current step and role.
 */
class WorkflowEngine {

    fun canUserApprove(
        currentStep: WorkflowStep,
        userRole: UserRole,
        entityData: Map<String, JsonElement>
    ): Boolean {
        // 1. Check Role Match
        val mappedRole = mapBackendRole(currentStep.approver_role)
        if (userRole != mappedRole && userRole != UserRole.ADMIN) return false

        // 2. Check Condition
        currentStep.condition?.let { cond ->
            val fieldValue = entityData[cond.field]?.jsonPrimitive?.floatOrNull ?: 0f
            return when (cond.op) {
                ">=" -> fieldValue >= cond.value
                "<=" -> fieldValue <= cond.value
                "==" -> fieldValue == cond.value
                else -> true
            }
        }

        return true
    }

    private fun mapBackendRole(backendRole: String): UserRole {
        return when (backendRole) {
            "manager" -> UserRole.APPROVER
            "fleet_supervisor" -> UserRole.SUPERVISOR
            "workshop_manager" -> UserRole.TYRE_MANAGER
            "store_keeper" -> UserRole.ADMIN // Or separate role
            else -> UserRole.VIEWER
        }
    }
}
