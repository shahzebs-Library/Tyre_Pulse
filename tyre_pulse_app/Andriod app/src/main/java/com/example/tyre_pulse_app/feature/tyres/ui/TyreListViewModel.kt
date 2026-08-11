package com.example.tyre_pulse_app.feature.tyres.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.TyreRepository
import com.example.tyre_pulse_app.core.model.Tyre
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
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

    init {
        combine(
            workspaceManager.currentWorkspace.filterNotNull(),
            _query
        ) { workspace, query ->
            Pair(workspace, query)
        }.onEach { (workspace, query) ->
            _uiState.update { it.copy(searchQuery = query, isLoading = true) }
            tyreRepository.refreshTyres(workspace.tenant.id, query)
        }.flatMapLatest { (workspace, query) ->
            tyreRepository.searchTyres(workspace.tenant.id, query)
        }.onEach { tyres ->
            _uiState.update { it.copy(tyres = tyres, isLoading = false) }
        }.catch { e ->
            _uiState.update { it.copy(error = e.message, isLoading = false) }
        }.launchIn(viewModelScope)
    }

    fun onSearchQueryChanged(query: String) {
        savedStateHandle["query"] = query
    }
}
