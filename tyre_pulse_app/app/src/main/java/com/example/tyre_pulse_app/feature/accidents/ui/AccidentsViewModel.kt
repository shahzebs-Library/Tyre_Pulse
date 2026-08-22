package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.AccidentRepository
import com.example.tyre_pulse_app.core.model.Accident
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import javax.inject.Inject

import retrofit2.HttpException
import java.io.IOException

@HiltViewModel
class AccidentsViewModel @Inject constructor(
    private val accidentRepository: AccidentRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<AccidentsUiState>(AccidentsUiState.Loading)
    val uiState: StateFlow<AccidentsUiState> = _uiState.asStateFlow()

    init {
        loadAccidents()
    }

    fun loadAccidents() {
        viewModelScope.launch {
            _uiState.value = AccidentsUiState.Loading
            accidentRepository.getAccidents()
                .catch { e ->
                    _uiState.value = AccidentsUiState.Error(mapError(e))
                }
                .collect { records ->
                    _uiState.value = AccidentsUiState.Success(records)
                }
        }
    }

    fun reportAccident(record: Accident, onSuccess: () -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                accidentRepository.reportAccident(record)
                loadAccidents() // Refresh
                onSuccess()
            } catch (e: Exception) {
                onError(mapError(e))
            }
        }
    }
    
    private fun mapError(e: Throwable): String {
        return when (e) {
            is IOException -> "Network error. Please check your internet connection."
            is HttpException -> "Server error (${e.code()}). Please try again later."
            else -> e.message ?: "An unexpected error occurred"
        }
    }
}

sealed interface AccidentsUiState {
    object Loading : AccidentsUiState
    data class Success(val records: List<Accident>) : AccidentsUiState
    data class Error(val message: String) : AccidentsUiState
}
