package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.UserRole
import com.example.tyre_pulse_app.core.authentication.UserViewModel
import com.example.tyre_pulse_app.core.data.repository.WorkOrderRepository
import com.example.tyre_pulse_app.core.model.WorkOrder
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WorkOrderUiState(
    val orders: List<WorkOrder> = emptyList(),
    val isLoading: Boolean = false,
    val userRole: UserRole = UserRole.VIEWER,
    val error: String? = null,
    val canStart: Boolean = false,
    val canComplete: Boolean = false
)

@HiltViewModel
class WorkOrderViewModel @Inject constructor(
    private val repository: WorkOrderRepository,
    private val userRepository: com.example.tyre_pulse_app.core.authentication.data.UserRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(WorkOrderUiState())
    val uiState: StateFlow<WorkOrderUiState> = _uiState.asStateFlow()

    init {
        loadWorkshop()
    }

    private fun loadWorkshop() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            
            // Sync user role state
            val user = userRepository.getCurrentUser().filterNotNull().first()
            val currentRole = UserRole.resolveRole(user?.role)
            
            repository.getWorkOrders().onEach { orders ->
                _uiState.update { it.copy(
                    orders = orders, 
                    isLoading = false,
                    userRole = currentRole,
                    canStart = currentRole != UserRole.VIEWER,
                    canComplete = currentRole in listOf(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN)
                ) }
            }.catch { e ->
                _uiState.update { it.copy(error = e.message, isLoading = false) }
            }.collect()
        }
    }
}
