package com.example.tyre_pulse_app.feature.washing.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.WashRepository
import com.example.tyre_pulse_app.core.data.repository.StorageRepository
import com.example.tyre_pulse_app.core.model.WashRecord
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
class WashingViewModel @Inject constructor(
    private val washRepository: WashRepository,
    private val storageRepository: StorageRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<WashingUiState>(WashingUiState.Loading)
    val uiState: StateFlow<WashingUiState> = _uiState.asStateFlow()

    init {
        loadWashes()
    }

    fun loadWashes() {
        viewModelScope.launch {
            _uiState.value = WashingUiState.Loading
            washRepository.getWashRecords()
                .catch { e ->
                    _uiState.value = WashingUiState.Error(mapError(e))
                }
                .collect { records ->
                    _uiState.value = WashingUiState.Success(records)
                }
        }
    }

    fun logWash(record: WashRecord, photoBytes: ByteArray?, onSuccess: () -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                var finalRecord = record
                if (photoBytes != null) {
                    val path = storageRepository.uploadPhoto(photoBytes)
                    finalRecord = record.copy(photos = listOf(path))
                }
                washRepository.logWash(finalRecord)
                loadWashes() // Refresh
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

sealed interface WashingUiState {
    object Loading : WashingUiState
    data class Success(val records: List<WashRecord>) : WashingUiState
    data class Error(val message: String) : WashingUiState
}
