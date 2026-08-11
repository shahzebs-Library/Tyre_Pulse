package com.example.tyre_pulse_app.feature.approvals.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.model.ApprovalStatus
import com.example.tyre_pulse_app.core.data.repository.ApprovalRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ApprovalsUiState(
    val approvals: List<Approval> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val selectedStatus: ApprovalStatus = ApprovalStatus.PENDING,
    val searchQuery: String = "",
    val selectedCategory: String? = null,
    val isEndReached: Boolean = false
)

@HiltViewModel
class ApprovalsViewModel @Inject constructor(
    private val repository: ApprovalRepository,
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val _status = savedStateHandle.getMutableStateFlow("status", ApprovalStatus.PENDING)
    private val _query = savedStateHandle.getMutableStateFlow("query", "")
    private val _category = savedStateHandle.getMutableStateFlow<String?>("category", null)
    
    private val _uiState = MutableStateFlow(ApprovalsUiState())
    val uiState: StateFlow<ApprovalsUiState> = _uiState.asStateFlow()

    private var currentPage = 0
    private val pageSize = 20

    init {
        // Observe filters and reload
        combine(_status, _query, _category) { status, query, category ->
            Triple(status, query, category)
        }.onEach { (status, query, category) ->
            _uiState.update { it.copy(
                selectedStatus = status,
                searchQuery = query,
                selectedCategory = category,
                approvals = emptyList(),
                isEndReached = false
            ) }
            currentPage = 0
            loadApprovals(reset = true)
        }.launchIn(viewModelScope)
    }

    fun onStatusSelected(status: ApprovalStatus) {
        _status.value = status
    }

    fun onSearchQueryChanged(query: String) {
        _query.value = query
    }

    fun onCategorySelected(category: String?) {
        _category.value = category
    }

    fun onRefresh() {
        _uiState.update { it.copy(isRefreshing = true) }
        loadApprovals(reset = true)
    }

    fun loadNextPage() {
        if (_uiState.value.isLoading || _uiState.value.isEndReached) return
        loadApprovals(reset = false)
    }

    private fun loadApprovals(reset: Boolean) {
        viewModelScope.launch {
            if (reset) currentPage = 0
            
            _uiState.update { if (reset) it.copy(isLoading = true) else it.copy(isLoading = false) }
            
            repository.getApprovals(
                status = _status.value,
                query = _query.value,
                category = _category.value,
                page = currentPage,
                pageSize = pageSize
            ).collect { newApprovals ->
                _uiState.update { state ->
                    state.copy(
                        approvals = if (reset) newApprovals else state.approvals + newApprovals,
                        isLoading = false,
                        isRefreshing = false,
                        isEndReached = newApprovals.size < pageSize
                    )
                }
                if (newApprovals.isNotEmpty()) currentPage++
            }
        }
    }

    private fun <T> SavedStateHandle.getMutableStateFlow(key: String, initialValue: T): MutableStateFlow<T> {
        val flow = getStateFlow(key, initialValue)
        val mutableFlow = MutableStateFlow(flow.value)
        viewModelScope.launch {
            mutableFlow.collect {
                set(key, it)
            }
        }
        return mutableFlow
    }
}
