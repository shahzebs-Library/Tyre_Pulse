package com.example.tyre_pulse_app.core.authentication

/**
 * High-level Roles mapped to UI logic.
 * These are derived from backend permissions/capabilities.
 */
enum class UserRole {
    TECHNICIAN,
    SUPERVISOR,
    TYREMAN,
    TYRE_MANAGER,
    INSURANCE_OFFICER,
    APPROVER,
    ADMIN,
    VIEWER
}

/**
 * Domain-specific capabilities that guard specific UI elements.
 */
enum class Capability {
    START_JOB,
    APPROVE_REPLACEMENT,
    VIEW_FINANCIALS,
    ASSIGN_TASKS,
    REPORT_ACCIDENT,
    FILE_CLAIM,
    PERFORM_INSPECTION,
    MANAGE_ASSETS
}
