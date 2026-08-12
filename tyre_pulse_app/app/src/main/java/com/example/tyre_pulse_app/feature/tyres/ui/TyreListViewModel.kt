package com.example.tyre_pulse_app.feature.tyres.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.TyreRepository
import com.example.tyre_pulse_app.core.model.Tyre
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import javax.inject.Inject

data class TyreListUiState(
    val tyres: List<Tyre> = emptyList(),
    val isLoading: Boolean = false,
    val searchQuery: String = "",
    val error: String? = null
)

@HiltViewModel
class TyreListViewModel @Inject constructor(
    private val tyreRepository: TyreRepository,
    private val workspaceManager: WorkspaceManager,
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val _query = savedStateHandle.getStateFlow("query", "")
    
    private val _uiState = MutableStateFlow(TyreListUiState())
    val uiState: StateFlow<TyreListUiState> = _uiState.asStateFlow()

    @OptIn(ExperimentalCoroutinesApi::class)
    fun initSearch() {
        combine(_query, workspaceManager.currentWorkspace) { query, workspace ->
            query to workspace?.tenant?.id
        }.flatMapLatest { (query, tenantId) ->
            _uiState.update { it.copy(searchQuery = query, isLoading = true) }
            if (tenantId != null) {
                tyreRepository.searchTyres(tenantId, query)
            } else {
                flowOf(emptyList())
            }
        }.onEach { tyres ->
            _uiState.update { it.copy(tyres = tyres, isLoading = false) }
        }.catch { e ->
            _uiState.update { it.copy(error = e.message, isLoading = false) }
        }.launchIn(viewModelScope)
    }

    init {
        initSearch()
    }

    fun onSearchQueryChanged(query: String) {
        savedStateHandle["query"] = query
    }
}
