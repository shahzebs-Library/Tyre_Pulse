package com.example.tyre_pulse_app.core.permissions

import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.model.User
import com.example.tyre_pulse_app.core.model.WorkspaceContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import javax.inject.Inject
import javax.inject.Singleton

enum class ModuleKey {
    INSPECT, SCAN, SERIAL, TYRE_CHANGE, CHECKLISTS, METER, WASHING, REPORT_ISSUE,
    RECORDS, VEHICLES, HISTORY, ALERTS, CALENDAR, ACCIDENTS, REPORT_ACCIDENT,
    WORKORDERS, RCA, TASKS, STOCK, PM, WORKSHOP, OVERVIEW, REPORTS, ANALYTICS,
    STOCK_MANAGE, AI, TEAM, APPROVALS, ADMIN, USERS
}

data class ModuleDef(
    val key: ModuleKey,
    val label: String,
    val group: String,
    val roles: List<String>
)

@Singleton
class PermissionManager @Inject constructor(
    private val userRepository: UserRepository,
    private val workspaceManager: WorkspaceManager
) {
    private val modules = listOf(
        ModuleDef(ModuleKey.INSPECT, "New Inspection", "Field", listOf("manager", "director", "inspector", "tyre_man")),
        ModuleDef(ModuleKey.SCAN, "Scan", "Field", listOf("manager", "director", "inspector", "tyre_man", "mechanic", "electrician")),
        ModuleDef(ModuleKey.SERIAL, "Serial Search", "Field", listOf("manager", "director", "inspector", "tyre_man", "tyre_data_collector", "reporter", "driver", "mechanic", "electrician", "maintenance_supervisor", "workshop_supervisor", "pmv_manager", "workshop_area_manager", "workshop_maintenance_area_manager")),
        ModuleDef(ModuleKey.TYRE_CHANGE, "Tyre Change", "Field", listOf("manager", "director", "inspector")),
        ModuleDef(ModuleKey.CHECKLISTS, "Checklists", "Field", listOf("manager", "director", "inspector", "tyre_man", "mechanic", "electrician", "driver", "maintenance_supervisor", "workshop_supervisor", "pmv_manager", "workshop_area_manager", "workshop_maintenance_area_manager")),
        ModuleDef(ModuleKey.METER, "Meter Log", "Field", listOf("manager", "director", "inspector", "tyre_man", "reporter", "driver", "mechanic", "electrician", "maintenance_supervisor", "workshop_supervisor", "pmv_manager", "workshop_area_manager", "workshop_maintenance_area_manager")),
        ModuleDef(ModuleKey.WASHING, "Vehicle Washing", "Field", listOf("manager", "director", "inspector", "driver", "tyre_man")),
        ModuleDef(ModuleKey.REPORT_ISSUE, "Report Issue", "Field", listOf("manager", "director", "reporter", "driver", "mechanic", "electrician", "maintenance_supervisor", "workshop_supervisor", "pmv_manager", "workshop_area_manager", "workshop_maintenance_area_manager")),
        
        ModuleDef(ModuleKey.RECORDS, "Tyre Records", "Fleet", emptyList()),
        ModuleDef(ModuleKey.VEHICLES, "Vehicles", "Fleet", listOf("manager", "director", "inspector", "tyre_man", "reporter", "driver", "mechanic", "electrician", "maintenance_supervisor", "workshop_supervisor", "pmv_manager", "workshop_area_manager", "workshop_maintenance_area_manager")),
        ModuleDef(ModuleKey.HISTORY, "History", "Fleet", emptyList()),
        ModuleDef(ModuleKey.ALERTS, "Alerts", "Fleet", listOf("manager", "director", "inspector")),
        ModuleDef(ModuleKey.CALENDAR, "Calendar", "Fleet", listOf("manager", "director", "tyre_man", "reporter", "maintenance_supervisor", "workshop_supervisor", "pmv_manager", "workshop_area_manager", "workshop_maintenance_area_manager")),
        
        ModuleDef(ModuleKey.ACCIDENTS, "Accidents", "Maintenance", listOf("manager", "director", "inspector")),
        ModuleDef(ModuleKey.REPORT_ACCIDENT, "File Accident", "Maintenance", listOf("manager", "director", "inspector")),
        ModuleDef(ModuleKey.WORKORDERS, "Work Orders", "Maintenance", emptyList()),
        ModuleDef(ModuleKey.RCA, "Root Cause", "Maintenance", listOf("manager", "director", "inspector")),
        ModuleDef(ModuleKey.TASKS, "Tasks", "Maintenance", listOf("manager", "director", "inspector")),
        ModuleDef(ModuleKey.STOCK, "Stock Count", "Maintenance", listOf("manager", "inspector")),
        ModuleDef(ModuleKey.PM, "Maintenance Due", "Maintenance", listOf("manager", "director")),
        ModuleDef(ModuleKey.WORKSHOP, "My Jobs", "Maintenance", listOf("manager", "director", "inspector", "tyre_man", "mechanic", "electrician")),
        
        ModuleDef(ModuleKey.OVERVIEW, "Overview", "Management", emptyList()),
        ModuleDef(ModuleKey.REPORTS, "Reports", "Management", emptyList()),
        ModuleDef(ModuleKey.ANALYTICS, "Analytics", "Management", emptyList()),
        ModuleDef(ModuleKey.STOCK_MANAGE, "Stock Management", "Management", emptyList()),
        ModuleDef(ModuleKey.AI, "Fleet AI", "Management", emptyList()),
        ModuleDef(ModuleKey.TEAM, "Team", "Management", emptyList()),
        
        ModuleDef(ModuleKey.APPROVALS, "Approvals", "Admin", listOf("director", "maintenance_supervisor", "workshop_supervisor", "pmv_manager", "workshop_area_manager", "workshop_maintenance_area_manager")),
        ModuleDef(ModuleKey.ADMIN, "Admin Console", "Admin", emptyList()),
        ModuleDef(ModuleKey.USERS, "User Management", "Admin", emptyList())
    ).associateBy { it.key }

    /**
     * Checks if the user has access to a specific ModuleKey in the current workspace.
     */
    fun hasAccess(moduleKey: ModuleKey): Flow<Boolean> {
        return combine(
            userRepository.getCurrentUser(),
            workspaceManager.currentWorkspace
        ) { user, workspace ->
            resolveAccess(user, workspace, moduleKey)
        }
    }

    private fun resolveAccess(user: User?, workspace: WorkspaceContext?, moduleKey: ModuleKey): Boolean {
        // MOCK: Grant admin access to all modules for testing
        return true
    }
}
