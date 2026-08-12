package com.example.tyre_pulse_app.feature.inspections.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
import com.example.tyre_pulse_app.core.data.repository.InspectionRepository
import com.example.tyre_pulse_app.core.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class InspectionUiState(
    val asset: Asset? = null,
    val inspection: Inspection? = null,
    val isLoading: Boolean = false,
    val isSubmitting: Boolean = false,
    val error: String? = null,
    val isSubmitted: Boolean = false
)

@HiltViewModel
class InspectionViewModel @Inject constructor(
    private val inspectionRepository: InspectionRepository,
    private val assetRepository: AssetRepository,
    private val workspaceManager: WorkspaceManager,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val assetId: String = checkNotNull(savedStateHandle["assetId"])

    private val _uiState = MutableStateFlow(InspectionUiState())
    val uiState: StateFlow<InspectionUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val workspace = workspaceManager.currentWorkspace.filterNotNull().first()
                val asset = assetRepository.getAsset(assetId, workspace.tenant.id)
                
                val draft = inspectionRepository.getDraft(assetId)
                val initialInspection = draft ?: createInitialInspection(asset, workspace)

                _uiState.update { it.copy(asset = asset, inspection = initialInspection, isLoading = false) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message, isLoading = false) }
            }
        }
    }

    private fun createInitialInspection(asset: Asset, workspace: WorkspaceContext): Inspection {
        return Inspection(
            id = UUID.randomUUID().toString(),
            assetNumber = asset.assetNumber,
            type = "Routine",
            status = "In Progress",
            inspector = "Current User",
            scheduledDate = System.currentTimeMillis().toString(),
            tenantId = workspace.tenant.id,
            site = workspace.site?.name ?: workspace.company.name,
            country = workspace.country.name,
            tyreReadings = (asset.tyres ?: emptyList()).map { tyre ->
                TyreInspectionReading(
                    position = tyre.position,
                    condition = "Good"
                )
            }
        )
    }

    fun updateReading(reading: TyreInspectionReading) {
        _uiState.update { state ->
            val updatedReadings = state.inspection?.tyreReadings?.toMutableList() ?: mutableListOf()
            val index = updatedReadings.indexOfFirst { it.position == reading.position }
            if (index >= 0) {
                updatedReadings[index] = reading
            } else {
                updatedReadings.add(reading)
            }
            state.copy(inspection = state.inspection?.copy(tyreReadings = updatedReadings))
        }
        saveDraft()
    }

    private fun saveDraft() {
        val currentInspection = _uiState.value.inspection ?: return
        viewModelScope.launch {
            inspectionRepository.saveDraft(assetId, currentInspection)
        }
    }

    fun submit() {
        viewModelScope.launch {
            val inspection = _uiState.value.inspection ?: return@launch
            _uiState.update { it.copy(isSubmitting = true) }
            val result = inspectionRepository.submitInspection(
                inspection.copy(status = "Done", completedDate = System.currentTimeMillis().toString())
            )
            if (result.isSuccess) {
                _uiState.update { it.copy(isSubmitting = false, isSubmitted = true) }
            } else {
                _uiState.update { it.copy(isSubmitting = false, error = result.exceptionOrNull()?.message) }
            }
        }
    }
}
