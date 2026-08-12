package com.example.tyre_pulse_app.feature.tyres.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.TyreRepository
import com.example.tyre_pulse_app.core.model.Tyre
import com.example.tyre_pulse_app.core.model.TyreHistoryEvent
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TyreDetailUiState(
    val tyre: Tyre? = null,
    val history: List<TyreHistoryEvent> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class TyreDetailViewModel @Inject constructor(
    private val tyreRepository: TyreRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val tyreId: String = checkNotNull(savedStateHandle["tyreId"])

    private val _uiState = MutableStateFlow(TyreDetailUiState())
    val uiState: StateFlow<TyreDetailUiState> = _uiState.asStateFlow()

    init {
        loadTyre()
    }

    private fun loadTyre() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                val tyre = tyreRepository.getTyre(tyreId)
                val history = tyreRepository.getTyreHistory(tyreId)
                _uiState.value = _uiState.value.copy(tyre = tyre, history = history, isLoading = false)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.message, isLoading = false)
            }
        }
    }
}
