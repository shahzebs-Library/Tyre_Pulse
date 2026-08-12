package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

data class LaborUiState(
    val jobId: String = "",
    val isClockedIn: Boolean = false,
    val startTime: Long? = null,
    val elapsedMinutes: Long = 0,
    val events: List<JobEvent> = emptyList()
)

data class JobEvent(val type: String, val timestamp: Long)

@HiltViewModel
class LaborTrackingViewModel @Inject constructor() : ViewModel() {
    private val _uiState = MutableStateFlow(LaborUiState())
    val uiState = _uiState.asStateFlow()

    fun clockIn(jobId: String) {
        val now = System.currentTimeMillis()
        _uiState.update { it.copy(
            jobId = jobId,
            isClockedIn = true,
            startTime = now,
            events = it.events + JobEvent("START", now)
        )}
    }

    fun clockOut() {
        val now = System.currentTimeMillis()
        _uiState.update { it.copy(
            isClockedIn = false,
            events = it.events + JobEvent("STOP", now)
        )}
    }
}
