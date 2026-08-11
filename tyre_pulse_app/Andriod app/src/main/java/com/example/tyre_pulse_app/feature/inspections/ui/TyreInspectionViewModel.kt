package com.example.tyre_pulse_app.feature.inspections.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.model.TyreReading
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class InspectionStep { PRESSURE, TREAD, CONDITION, PHOTOS }

data class TyreInspectionUiState(
    val assetId: String = "",
    val tyreId: String = "",
    val position: String = "",
    val currentStep: InspectionStep = InspectionStep.PRESSURE,
    val pressure: Float? = null,
    val temperature: Float? = null,
    val treadDepth: Float? = null,
    val condition: String? = null,
    val damageReason: String? = null,
    val photos: List<String> = emptyList(),
    val isSaving: Boolean = false,
    val isSaved: Boolean = false
)

@HiltViewModel
class TyreInspectionViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val _uiState = MutableStateFlow(TyreInspectionUiState(
        assetId = savedStateHandle["assetId"] ?: "",
        tyreId = savedStateHandle["tyreId"] ?: "",
        position = savedStateHandle["position"] ?: "Rear Right Outer"
    ))
    val uiState: StateFlow<TyreInspectionUiState> = _uiState.asStateFlow()

    fun onPressureChanged(value: Float) {
        _uiState.update { it.copy(pressure = value) }
    }

    fun onTemperatureChanged(value: Float) {
        _uiState.update { it.copy(temperature = value) }
    }

    fun onTreadDepthChanged(value: Float) {
        _uiState.update { it.copy(treadDepth = value) }
    }

    fun onConditionSelected(condition: String) {
        _uiState.update { it.copy(condition = condition) }
    }

    fun onPhotoAdded(path: String) {
        _uiState.update { it.copy(photos = it.photos + path) }
    }

    fun nextStep() {
        val current = _uiState.value.currentStep
        val next = when (current) {
            InspectionStep.PRESSURE -> InspectionStep.TREAD
            InspectionStep.TREAD -> InspectionStep.CONDITION
            InspectionStep.CONDITION -> InspectionStep.PHOTOS
            InspectionStep.PHOTOS -> return // End reached
        }
        _uiState.update { it.copy(currentStep = next) }
    }

    fun previousStep() {
        val current = _uiState.value.currentStep
        val prev = when (current) {
            InspectionStep.PRESSURE -> return
            InspectionStep.TREAD -> InspectionStep.PRESSURE
            InspectionStep.CONDITION -> InspectionStep.TREAD
            InspectionStep.PHOTOS -> InspectionStep.CONDITION
        }
        _uiState.update { it.copy(currentStep = prev) }
    }

    fun saveReading() {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true) }
            // TODO: Save to Room/Draft repository
            _uiState.update { it.copy(isSaving = false, isSaved = true) }
        }
    }
}
