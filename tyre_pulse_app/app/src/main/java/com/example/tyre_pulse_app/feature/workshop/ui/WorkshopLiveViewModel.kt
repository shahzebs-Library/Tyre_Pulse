package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.data.repository.SyncRepository
import com.example.tyre_pulse_app.core.data.repository.WorkshopRepository
import com.example.tyre_pulse_app.core.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID
import javax.inject.Inject

data class Productivity(
    val productiveMin: Int = 0,
    val blockedMin: Int = 0,
    val jobsCompleted: Int = 0
)

data class WorkshopLiveUiState(
    val jobs: List<WorkOrder> = emptyList(),
    val events: List<WorkshopEvent> = emptyList(),
    val isCheckedIn: Boolean = false,
    val selectedJobId: String? = null,
    val productivity: Productivity = Productivity(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class WorkshopLiveViewModel @Inject constructor(
    private val repository: WorkshopRepository,
    private val userRepository: UserRepository,
    private val syncRepository: SyncRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(WorkshopLiveUiState())
    val uiState = _uiState.asStateFlow()

    init {
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val user = userRepository.getCurrentUser().first() ?: return@launch
            
            combine(
                repository.getWorkOrders(),
                repository.getLiveEvents(user.id)
            ) { jobs, events ->
                val checkedIn = events.any { it.eventType == "check_in" } && 
                               events.none { it.eventType == "check_out" && it.at > (events.find { it.eventType == "check_in" }?.at ?: "") }
                
                WorkshopLiveUiState(
                    jobs = jobs,
                    events = events,
                    isCheckedIn = checkedIn,
                    selectedJobId = jobs.firstOrNull()?.id,
                    productivity = calculateProductivity(events)
                )
            }.collect { state ->
                _uiState.value = state.copy(isLoading = false)
            }
        }
    }

    fun recordEvent(type: String, jobId: String? = null, reason: String? = null, note: String? = null) {
        viewModelScope.launch {
            val user = userRepository.getCurrentUser().first() ?: return@launch
            val event = WorkshopEvent(
                id = UUID.randomUUID().toString(),
                userId = user.id,
                jobId = jobId,
                eventType = type,
                reasonCode = reason,
                note = note,
                at = LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME)
            )
            
            syncRepository.enqueueCommand("WORKSHOP_EVENT", event)
            // Optimistic update
            _uiState.update { it.copy(events = it.events + event) }
        }
    }

    private fun calculateProductivity(events: List<WorkshopEvent>): Productivity {
        // Port of myProductivityToday logic
        return Productivity(45, 10, 2) // Stub for now
    }

    fun selectJob(id: String) {
        _uiState.update { it.copy(selectedJobId = id) }
    }
}
