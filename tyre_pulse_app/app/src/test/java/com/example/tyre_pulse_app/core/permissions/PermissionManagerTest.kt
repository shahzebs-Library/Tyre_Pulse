package com.example.tyre_pulse_app.core.permissions

import com.example.tyre_pulse_app.core.authentication.UserRole
import com.example.tyre_pulse_app.core.model.User
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PermissionManagerTest {

    @Test
    fun testDefaultRolePermissionsDriver() {
        val driver = User(
            id = "user-1",
            name = "Driver A",
            email = "driver@example.com",
            role = "driver"
        )
        
        // Drivers should have permission to inspect assets
        assertTrue(PermissionManager.hasPermission(driver, "assets", "inspect"))
        // Drivers should NOT have permission to manage team
        assertFalse(PermissionManager.hasPermission(driver, "team", "manage"))
    }

    @Test
    fun testDefaultRolePermissionsAdmin() {
        val admin = User(
            id = "user-2",
            name = "Admin B",
            email = "admin@example.com",
            role = "admin"
        )
        
        // Admins should have access to manage team, configuration, and views
        assertTrue(PermissionManager.hasPermission(admin, "team", "manage"))
        assertTrue(PermissionManager.hasPermission(admin, "configurations", "edit"))
    }

    @Test
    fun testCustomPermissionOverrides() {
        val user = User(
            id = "user-3",
            name = "Manager C",
            email = "manager@example.com",
            role = "manager",
            permissions = mapOf(
                "global" to listOf("team.manage", "-assets.delete") // grant team, revoke assets delete
            )
        )
        
        // Manager C should have permission to manage team (granted via override)
        assertTrue(PermissionManager.hasPermission(user, "team", "manage", "global"))
        
        // Manager C should NOT be allowed to delete assets (explicitly revoked override)
        assertFalse(PermissionManager.hasPermission(user, "assets", "delete", "global"))
    }
}
