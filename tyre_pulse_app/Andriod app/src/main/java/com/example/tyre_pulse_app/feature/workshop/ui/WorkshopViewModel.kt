package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.WorkshopRepository
import com.example.tyre_pulse_app.core.model.WorkOrder
import com.example.tyre_pulse_app.core.model.WorkOrderStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WorkshopUiState(
    val workOrders: List<WorkOrder> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class WorkshopViewModel @Inject constructor(
    private val workshopRepository: WorkshopRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(WorkshopUiState())
    val uiState: StateFlow<WorkshopUiState> = _uiState.asStateFlow()

    init {
        loadWorkOrders()
    }

    private fun loadWorkOrders() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            workshopRepository.getWorkOrders().collect { orders ->
                _uiState.update { it.copy(workOrders = orders, isLoading = false) }
            }
        }
    }
}
