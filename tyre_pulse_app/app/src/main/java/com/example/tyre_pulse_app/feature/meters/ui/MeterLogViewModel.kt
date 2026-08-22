package com.example.tyre_pulse_app.feature.meters.ui

import androidx.lifecycle.ViewModel
import com.example.tyre_pulse_app.core.data.repository.SyncRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MeterLogUiState(
    val assetNo: String = "",
    val currentKm: Long = 125420,
    val currentHours: Long = 3640,
    val newKm: String = "",
    val newHours: String = "",
    val kmError: String? = null,
    val hoursError: String? = null,
    val isSubmitting: Boolean = false
)

@HiltViewModel
class MeterLogViewModel @Inject constructor(
    private val syncRepository: SyncRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(MeterLogUiState())
    val uiState = _uiState.asStateFlow()

    fun onKmChanged(v: String) {
        val km = v.toLongOrNull() ?: 0
        val error = if (km > 0 && km < _uiState.value.currentKm) "Cannot be less than current KM" else null
        _uiState.update { it.copy(newKm = v, kmError = error) }
    }

    fun onHoursChanged(v: String) {
        val hrs = v.toLongOrNull() ?: 0
        val error = if (hrs > 0 && hrs < _uiState.value.currentHours) "Cannot be less than current Hours" else null
        _uiState.update { it.copy(newHours = v, hoursError = error) }
    }

    fun submit(onSuccess: () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true) }
            val state = _uiState.value
            val payload = mapOf(
                "asset_no" to state.assetNo,
                "new_km" to state.newKm,
                "new_hours" to state.newHours
            )
            syncRepository.enqueueCommand("METER_LOG", payload)
            _uiState.update { it.copy(isSubmitting = false) }
            onSuccess()
        }
    }
}
