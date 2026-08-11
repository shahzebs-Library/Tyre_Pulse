package com.example.tyre_pulse_app.feature.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

import com.example.tyre_pulse_app.core.authentication.PermissionManager
import com.example.tyre_pulse_app.core.authentication.UserRole
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.authentication.data.UserRepository

data class HomeUiState(
    val isLoading: Boolean = false,
    val role: UserRole = UserRole.VIEWER,
    val inspectionsDue: Int = 0,
    val criticalTyres: Int = 0,
    val breakdowns: Int = 0,
    val openJobs: Int = 0,
    val todaysJobs: List<JobSummary> = emptyList(),
    val pendingApprovals: Int = 0
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val userRepository: UserRepository,
    private val workspaceManager: WorkspaceManager,
    private val permissionManager: PermissionManager
) : ViewModel() {
    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            combine(
                userRepository.getCurrentUser(),
                workspaceManager.currentWorkspace
            ) { user, workspace ->
                val role = permissionManager.resolveRole(user, workspace)
                _uiState.update { it.copy(role = role) }
                loadDashboardForRole(role)
            }.collect()
        }
    }

    private fun loadDashboardForRole(role: UserRole) {
        // Here we populate the UI state based on role
        when (role) {
            UserRole.TECHNICIAN -> {
                _uiState.update { it.copy(
                    inspectionsDue = 5,
                    openJobs = 3,
                    todaysJobs = listOf(JobSummary("1", "Mixer 2841", "Inspection", "9:00 AM", "High"))
                )}
            }
            UserRole.APPROVER -> {
                _uiState.update { it.copy(
                    pendingApprovals = 12,
                    criticalTyres = 4
                )}
            }
            else -> { /* Default stats */ }
        }
    }
}
