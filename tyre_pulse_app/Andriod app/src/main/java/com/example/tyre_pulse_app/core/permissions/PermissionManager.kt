package com.example.tyre_pulse_app.core.permissions

import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.model.User
import com.example.tyre_pulse_app.core.model.WorkspaceContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PermissionManager @Inject constructor(
    private val userRepository: UserRepository,
    private val workspaceManager: WorkspaceManager
) {
    /**
     * Checks if the user has a specific permission in the current selected workspace scope.
     */
    fun hasPermission(permission: String): Flow<Boolean> {
        return combine(
            userRepository.getCurrentUser(),
            workspaceManager.currentWorkspace
        ) { user, workspace ->
            checkPermission(user, workspace, permission)
        }
    }

    private fun checkPermission(user: User?, workspace: WorkspaceContext?, permission: String): Boolean {
        if (user == null || workspace == null) return false
        
        val countryPermissions = user.permissions[workspace.country.id] ?: emptyList()
        val globalPermissions = user.permissions["global"] ?: emptyList()
        
        return permission in countryPermissions || permission in globalPermissions
    }
}
