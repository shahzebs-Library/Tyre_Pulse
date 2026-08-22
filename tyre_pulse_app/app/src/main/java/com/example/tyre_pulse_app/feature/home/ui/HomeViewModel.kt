package com.example.tyre_pulse_app.feature.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.UserRole
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import javax.inject.Inject

data class JobSummary(
    val id: String,
    val assetName: String,
    val type: String,
    val time: String,
    val status: String
)

data class HomeUiState(
    val role: UserRole = UserRole.TECHNICIAN,
    val inspectionsDue: Int = 0,
    val openJobs: Int = 0,
    val pendingApprovals: Int = 0,
    val criticalTyres: Int = 0,
    val todaysJobs: List<JobSummary> = emptyList(),
    val isLoading: Boolean = false
)

@HiltViewModel
class HomeViewModel @Inject constructor() : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        loadDashboardData()
    }

    fun loadDashboardData() {
        _uiState.update { 
            it.copy(
                inspectionsDue = 4,
                openJobs = 2,
                todaysJobs = listOf(
                    JobSummary("1", "Mixer 2841", "Full Inspection", "09:00 AM", "Pending"),
                    JobSummary("2", "Trailer 502", "Tyre Replacement", "02:30 PM", "Pending")
                )
            )
        }
    }
}
