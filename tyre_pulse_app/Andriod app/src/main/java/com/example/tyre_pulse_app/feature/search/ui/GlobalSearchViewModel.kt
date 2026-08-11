package com.example.tyre_pulse_app.feature.search.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
import com.example.tyre_pulse_app.core.data.repository.TyreRepository
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.Tyre
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import javax.inject.Inject

data class SearchResult(
    val assets: List<Asset> = emptyList(),
    val tyres: List<Tyre> = emptyList()
)

data class GlobalSearchUiState(
    val query: String = "",
    val result: SearchResult = SearchResult(),
    val isLoading: Boolean = false
)

@HiltViewModel
class GlobalSearchViewModel @Inject constructor(
    private val assetRepository: AssetRepository,
    private val tyreRepository: TyreRepository,
    private val workspaceManager: WorkspaceManager
) : ViewModel() {

    private val _query = MutableStateFlow("")
    val uiState: StateFlow<GlobalSearchUiState> = _query
        .debounce(500)
        .filter { it.length >= 2 }
        .flatMapLatest { query ->
            flow {
                emit(GlobalSearchUiState(query = query, isLoading = true))
                val workspace = workspaceManager.currentWorkspace.filterNotNull().first()
                val assets = assetRepository.searchAssets(workspace.tenant.id, query).first()
                val tyres = tyreRepository.searchTyres(workspace.tenant.id, query).first()
                emit(GlobalSearchUiState(query = query, result = SearchResult(assets, tyres), isLoading = false))
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), GlobalSearchUiState())

    fun onQueryChanged(query: String) {
        _query.value = query
    }
}
