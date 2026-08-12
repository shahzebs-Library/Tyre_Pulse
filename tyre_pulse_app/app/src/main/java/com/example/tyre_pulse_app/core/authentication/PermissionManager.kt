package com.example.tyre_pulse_app.core.authentication

import com.example.tyre_pulse_app.core.model.User

object PermissionManager {

    /**
     * Exact Port of Expo's MODULES registry and resolveModuleAccess logic.
     */
    fun canAccessModule(role: UserRole?, module: String): Boolean {
        if (role == UserRole.ADMIN) return true
        
        return when (module) {
            "inspect", "checklists" -> role in listOf(UserRole.MANAGER, UserRole.DIRECTOR, UserRole.INSPECTOR, UserRole.TYRE_MAN, UserRole.SUPERVISOR, UserRole.TYRE_MANAGER)
            "vehicles" -> role in listOf(UserRole.MANAGER, UserRole.DIRECTOR, UserRole.INSPECTOR, UserRole.TYRE_MAN, UserRole.REPORTER, UserRole.DRIVER, UserRole.SUPERVISOR, UserRole.TYRE_MANAGER)
            "ai" -> role in listOf(UserRole.MANAGER, UserRole.DIRECTOR, UserRole.ADMIN)
            "approvals", "admin" -> role in listOf(UserRole.MANAGER, UserRole.DIRECTOR, UserRole.ADMIN)
            else -> false
        }
    }

    fun hasCapability(role: UserRole?, capability: String): Boolean {
        return canAccessModule(role, capability)
    }
}
