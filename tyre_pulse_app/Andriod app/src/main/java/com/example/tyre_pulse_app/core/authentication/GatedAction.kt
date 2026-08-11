package com.example.tyre_pulse_app.core.authentication

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Agent R2: UI Gating Wrapper.
 * Only renders the [content] if the user has the required [capability].
 */
@Composable
fun GatedAction(
    capability: Capability,
    userViewModel: UserViewModel = hiltViewModel(),
    permissionManager: PermissionManager = PermissionManager(), // Should be injected in real use
    content: @Composable () -> Unit
) {
    val currentUser by userViewModel.currentUser.collectAsState()
    val currentWorkspace by userViewModel.currentWorkspace.collectAsState()

    if (permissionManager.hasCapability(currentUser, currentWorkspace, capability)) {
        content()
    }
}
