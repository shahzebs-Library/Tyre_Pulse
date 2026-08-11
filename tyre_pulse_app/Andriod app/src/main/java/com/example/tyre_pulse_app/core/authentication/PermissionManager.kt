package com.example.tyre_pulse_app.core.authentication

import com.example.tyre_pulse_app.core.model.User
import com.example.tyre_pulse_app.core.model.WorkspaceContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PermissionManager @Inject constructor() {

    fun resolveRole(user: User?, workspace: WorkspaceContext?): UserRole {
        if (user == null || workspace == null) return UserRole.VIEWER
        
        // Logic to derive role from user.permissions for the current workspace scope
        // This is a placeholder for real backend mapping
        val perms = user.permissions[workspace.country.id] ?: emptyList()
        
        return when {
            perms.contains("admin") -> UserRole.ADMIN
            perms.contains("approve_tyre") -> UserRole.APPROVER
            perms.contains("insurance_write") -> UserRole.INSURANCE_OFFICER
            perms.contains("workshop_write") -> UserRole.TECHNICIAN
            perms.contains("inspection_write") -> UserRole.TYREMAN
            else -> UserRole.VIEWER
        }
    }

    fun hasCapability(user: User?, workspace: WorkspaceContext?, capability: Capability): Boolean {
        val role = resolveRole(user, workspace)
        return when (capability) {
            Capability.START_JOB -> role == UserRole.TECHNICIAN || role == UserRole.SUPERVISOR
            Capability.APPROVE_REPLACEMENT -> role == UserRole.APPROVER || role == UserRole.ADMIN
            Capability.VIEW_FINANCIALS -> role == UserRole.ADMIN || role == UserRole.TYRE_MANAGER
            Capability.ASSIGN_TASKS -> role == UserRole.SUPERVISOR || role == UserRole.ADMIN
            Capability.REPORT_ACCIDENT -> true // Generally everyone can report
            Capability.FILE_CLAIM -> role == UserRole.INSURANCE_OFFICER || role == UserRole.ADMIN
            Capability.PERFORM_INSPECTION -> role == UserRole.TYREMAN || role == UserRole.TECHNICIAN || role == UserRole.SUPERVISOR
            Capability.MANAGE_ASSETS -> role == UserRole.ADMIN || role == UserRole.SUPERVISOR
        }
    }
}
