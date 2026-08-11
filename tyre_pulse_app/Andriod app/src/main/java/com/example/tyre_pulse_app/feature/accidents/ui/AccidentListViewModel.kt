package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.AccidentRepository
import com.example.tyre_pulse_app.core.model.Accident
import com.example.tyre_pulse_app.core.model.AccidentStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AccidentListUiState(
    val accidents: List<Accident> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class AccidentListViewModel @Inject constructor(
    private val accidentRepository: AccidentRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AccidentListUiState())
    val uiState: StateFlow<AccidentListUiState> = _uiState.asStateFlow()

    init {
        loadAccidents()
    }

    private fun loadAccidents() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            accidentRepository.getAccidents().collect { accidents ->
                _uiState.update { it.copy(accidents = accidents, isLoading = false) }
            }
        }
    }
}
