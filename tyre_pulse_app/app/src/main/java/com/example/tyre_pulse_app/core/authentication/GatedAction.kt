package com.example.tyre_pulse_app.core.authentication

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Enterprise Access Gate: Prevents rendering of buttons or screens
 * if the user role doesn't have the required capability.
 */
@Composable
fun GatedAction(
    capability: String,
    content: @Composable () -> Unit
) {
    val userViewModel: UserViewModel = hiltViewModel()
    val user by userViewModel.currentUser.collectAsState()
    val currentRole = UserRole.resolveRole(user?.role)

    if (PermissionManager.hasCapability(currentRole, capability)) {
        content()
    }
}
