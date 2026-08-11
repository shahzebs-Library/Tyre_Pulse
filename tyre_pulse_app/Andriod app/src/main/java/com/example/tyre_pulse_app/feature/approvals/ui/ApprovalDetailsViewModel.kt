package com.example.tyre_pulse_app.feature.approvals.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.data.repository.ApprovalRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ApprovalDetailsUiState(
    val approval: Approval? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class ApprovalDetailsViewModel @Inject constructor(
    private val repository: ApprovalRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val approvalId: String = checkNotNull(savedStateHandle["approvalId"])

    private val _uiState = MutableStateFlow(ApprovalDetailsUiState())
    val uiState: StateFlow<ApprovalDetailsUiState> = _uiState.asStateFlow()

    init {
        loadApproval()
    }

    private fun loadApproval() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            repository.getApprovalById(approvalId).collect { approval ->
                _uiState.value = _uiState.value.copy(approval = approval, isLoading = false)
            }
        }
    }
}
