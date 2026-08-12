package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.WorkshopRepository
import com.example.tyre_pulse_app.core.model.WorkOrder
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WorkOrderDetailsUiState(
    val workOrder: WorkOrder? = null,
    val isLoading: Boolean = false,
    val isStarting: Boolean = false,
    val isCompleting: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class WorkOrderDetailsViewModel @Inject constructor(
    private val workshopRepository: WorkshopRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val workOrderId: String = checkNotNull(savedStateHandle["workOrderId"])

    private val _uiState = MutableStateFlow(WorkOrderDetailsUiState())
    val uiState: StateFlow<WorkOrderDetailsUiState> = _uiState.asStateFlow()

    init {
        loadWorkOrder()
    }

    private fun loadWorkOrder() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                val order = workshopRepository.getWorkOrder(workOrderId)
                _uiState.value = _uiState.value.copy(workOrder = order, isLoading = false)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.message, isLoading = false)
            }
        }
    }

    fun startJob() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isStarting = true)
            try {
                val updated = workshopRepository.startJob(workOrderId)
                _uiState.value = _uiState.value.copy(workOrder = updated, isStarting = false)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.message, isStarting = false)
            }
        }
    }
}
