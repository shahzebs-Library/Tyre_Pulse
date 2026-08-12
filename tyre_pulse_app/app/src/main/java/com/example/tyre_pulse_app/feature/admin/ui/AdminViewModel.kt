package com.example.tyre_pulse_app.feature.admin.ui

import androidx.lifecycle.ViewModel
import com.example.tyre_pulse_app.core.authentication.UserRole
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

data class AdminUiState(
    val activeUsers: Int = 45,
    val totalTeams: Int = 8,
    val pendingPermissions: Int = 3,
    val systemStatus: String = "Healthy"
)

@HiltViewModel
class AdminViewModel @Inject constructor() : ViewModel() {
    private val _uiState = MutableStateFlow(AdminUiState())
    val uiState = _uiState.asStateFlow()
}
