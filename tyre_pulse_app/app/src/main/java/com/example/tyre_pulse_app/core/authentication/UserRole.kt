package com.example.tyre_pulse_app.core.authentication

import kotlinx.serialization.Serializable

/**
 * Unified User Roles ported exactly from Expo Types.ts
 */
@Serializable
enum class UserRole {
    ADMIN, 
    MANAGER, 
    DIRECTOR, 
    INSPECTOR, 
    TYRE_MAN, 
    REPORTER, 
    DRIVER, 
    TECHNICIAN, 
    APPROVER, 
    INSURANCE_OFFICER, 
    TYRE_DATA_COLLECTOR,
    SUPERVISOR,
    TYRE_MANAGER,
    VIEWER;

    companion object {
        fun resolveRole(role: String?): UserRole = try {
            valueOf(role?.uppercase()?.replace(" ", "_") ?: "VIEWER")
        } catch (e: Exception) {
            VIEWER
        }
    }
}
