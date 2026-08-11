package com.example.tyre_pulse_app.feature.team.ui

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

data class TeamUiState(
    val members: List<TechnicianStatus> = listOf(
        TechnicianStatus("John Doe", "In Progress", "Mixer 2841", 0xFF4CAF50),
        TechnicianStatus("Jane Smith", "Idle", "N/A", 0xFF9E9E9E),
        TechnicianStatus("Ahmed Khan", "Break", "N/A", 0xFFFF9800),
        TechnicianStatus("Mike Ross", "In Progress", "Pump 112", 0xFF4CAF50)
    )
)

data class TechnicianStatus(val name: String, val status: String, val activeJob: String, val color: Long)

class TeamViewModel @Inject constructor() : ViewModel() {
    private val _uiState = MutableStateFlow(TeamUiState())
    val uiState = _uiState.asStateFlow()
}
