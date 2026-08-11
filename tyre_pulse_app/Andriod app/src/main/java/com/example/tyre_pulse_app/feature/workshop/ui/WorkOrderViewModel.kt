package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.PermissionManager
import com.example.tyre_pulse_app.core.authentication.UserRole
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import javax.inject.Inject

data class WorkOrderUiState(
    val role: UserRole = UserRole.VIEWER,
    val canStart: Boolean = false,
    val canComplete: Boolean = false,
    val canAssign: Boolean = false
)

@HiltViewModel
class WorkOrderViewModel @Inject constructor(
    private val userRepository: UserRepository,
    private val workspaceManager: WorkspaceManager,
    private val permissionManager: PermissionManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(WorkOrderUiState())
    val uiState = _uiState.asStateFlow()

    init {
        combine(
            userRepository.getCurrentUser(),
            workspaceManager.currentWorkspace
        ) { user, workspace ->
            val role = permissionManager.resolveRole(user, workspace)
            _uiState.update { it.copy(
                role = role,
                canStart = role == UserRole.TECHNICIAN,
                canComplete = role == UserRole.TECHNICIAN,
                canAssign = role == UserRole.SUPERVISOR || role == UserRole.ADMIN
            )}
        }.launchIn(viewModelScope)
    }
}
