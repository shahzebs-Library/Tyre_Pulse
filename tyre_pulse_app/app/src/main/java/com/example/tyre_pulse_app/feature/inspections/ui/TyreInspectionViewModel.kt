package com.example.tyre_pulse_app.feature.inspections.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
import com.example.tyre_pulse_app.core.data.repository.InspectionRepository
import com.example.tyre_pulse_app.core.model.TyreInspectionReading
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
    val isSaved: Boolean = false,
    val vehicleType: String = "Truck",
    val currentKm: Double = 0.0,
    val kmAtFitment: Double = 0.0,
    val siteType: String = "Highway"
)

@HiltViewModel
class TyreInspectionViewModel @Inject constructor(
    private val inspectionRepository: InspectionRepository,
    private val assetRepository: AssetRepository,
    private val workspaceManager: WorkspaceManager,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val assetId: String = savedStateHandle["assetId"] ?: ""
    private val tyreId: String = savedStateHandle["tyreId"] ?: ""
    private val position: String = savedStateHandle["position"] ?: "FL"

    private val _uiState = MutableStateFlow(TyreInspectionUiState(
        assetId = assetId,
        tyreId = tyreId,
        position = position
    ))
    val uiState: StateFlow<TyreInspectionUiState> = _uiState.asStateFlow()

    init {
        loadAssetContext()
    }

    private fun loadAssetContext() {
        viewModelScope.launch {
            try {
                val workspace = workspaceManager.currentWorkspace.filterNotNull().first()
                val asset = assetRepository.getAsset(assetId, workspace.tenant.id)
                val tyre = asset.tyres?.find { it.id == tyreId || it.position.uppercase() == position.uppercase() }
                _uiState.update { it.copy(
                    vehicleType = asset.type ?: "Truck",
                    currentKm = asset.odometerKm ?: 0.0,
                    kmAtFitment = tyre?.kmAtFitment ?: 0.0,
                    siteType = workspace.site?.name ?: "Highway"
                ) }
            } catch (e: Exception) {
                android.util.Log.e("TyreInspectionViewModel", "Failed to load asset context", e)
            }
        }
    }

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
            try {
                val draft = inspectionRepository.getDraft(assetId)
                if (draft != null) {
                    val updatedReadings = draft.tyreReadings.toMutableList()
                    val index = updatedReadings.indexOfFirst { it.position.uppercase() == position.uppercase() }

                    val newReading = TyreInspectionReading(
                        position = position,
                        pressure = _uiState.value.pressure?.toString(),
                        condition = _uiState.value.condition ?: "Good",
                        treadDepth = _uiState.value.treadDepth?.toString()
                    )

                    if (index >= 0) {
                        updatedReadings[index] = newReading
                    } else {
                        updatedReadings.add(newReading)
                    }

                    inspectionRepository.saveDraft(
                        assetId,
                        draft.copy(tyreReadings = updatedReadings)
                    )
                }
            } catch (e: Exception) {
                android.util.Log.e("TyreInspectionViewModel", "Failed to save tyre reading", e)
            } finally {
                _uiState.update { it.copy(isSaving = false, isSaved = true) }
            }
        }
    }
}
