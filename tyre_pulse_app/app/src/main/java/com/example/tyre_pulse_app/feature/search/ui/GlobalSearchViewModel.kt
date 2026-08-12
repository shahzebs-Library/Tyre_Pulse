package com.example.tyre_pulse_app.feature.search.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.Tyre
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.*
import javax.inject.Inject

data class GlobalSearchUiState(
    val query: String = "",
    val assetResults: List<Asset> = emptyList(),
    val tyreResults: List<Tyre> = emptyList(),
    val isLoading: Boolean = false
)

@HiltViewModel
class GlobalSearchViewModel @Inject constructor() : ViewModel() {

    private val _query = MutableStateFlow("")
    val uiState: StateFlow<GlobalSearchUiState> = _query
        .debounce(300)
        .flatMapLatest { query ->
            if (query.length < 2) flowOf(GlobalSearchUiState(query = query))
            else flow {
                emit(GlobalSearchUiState(query = query, isLoading = true))
                // Search logic stub
                emit(GlobalSearchUiState(query = query, isLoading = false))
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), GlobalSearchUiState())

    fun onQueryChanged(query: String) {
        _query.value = query
    }
}
