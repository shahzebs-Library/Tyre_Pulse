package com.example.tyre_pulse_app.feature.inspections.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
import com.example.tyre_pulse_app.core.data.repository.InspectionRepository
import com.example.tyre_pulse_app.core.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject
import com.example.tyre_pulse_app.core.notifications.TyreAlertNotificationManager


data class RecurrenceInfo(
    val daysAgo: Long,
    val dueInDays: Long,
    val documentNo: String?
)

data class InspectionUiState(
    val asset: Asset? = null,
    val inspection: Inspection? = null,
    val recurrenceWarning: RecurrenceInfo? = null,
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
    private val userRepository: UserRepository,
    private val notificationManager: TyreAlertNotificationManager,
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
                // Mock data for demo purposes to avoid infinite suspension on missing workspace/user
                val demoWorkspace = WorkspaceContext(
                    tenant = Tenant(id = "demo-tenant-123", name = "Demo Tenant"),
                    company = Company(id = "demo-company", tenantId = "demo-tenant-123", name = "TyrePulse Logistics"),
                    country = Country(id = "demo-country", companyId = "demo-company", name = "United States", code = "US", currency = "USD", timezone = "UTC"),
                    site = Site(id = "site-1", countryId = "demo-country", name = "Main Depot")
                )
                
                val demoTyres = listOf(
                    FittedTyre(id = "demo-1", position = "FL", serialNumber = "SN-1001", brand = "Michelin", pattern = "X Multi Z", size = "295/80R22.5", condition = "Good"),
                    FittedTyre(id = "demo-2", position = "FR", serialNumber = "SN-1002", brand = "Michelin", pattern = "X Multi Z", size = "295/80R22.5", condition = "Warning"),
                    FittedTyre(id = "demo-3", position = "RL1", serialNumber = "SN-1003", brand = "Bridgestone", pattern = "M729", size = "315/80R22.5", condition = "Critical"),
                    FittedTyre(id = "demo-4", position = "RR1", serialNumber = "SN-1004", brand = "Bridgestone", pattern = "M729", size = "315/80R22.5", condition = "Good")
                )
                val demoAsset = Asset(
                    id = assetId.ifEmpty { "asset-1" }, 
                    assetNumber = if (assetId.isNotEmpty()) assetId else "TRK-001", 
                    type = "Truck", 
                    fittedTyres = demoTyres
                )
                
                val initialInspection = createInitialInspection(demoAsset, demoWorkspace, "Demo Inspector")

                _uiState.update { it.copy(asset = demoAsset, inspection = initialInspection, recurrenceWarning = null, isLoading = false) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message, isLoading = false) }
            }
        }
    }

    private fun createInitialInspection(asset: Asset, workspace: WorkspaceContext, inspectorName: String): Inspection {
        return Inspection(
            id = UUID.randomUUID().toString(),
            assetNumber = asset.assetNumber,
            type = "Routine",
            status = "In Progress",
            inspector = inspectorName,
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
                
                // Parse and trigger alerts based on tyre life and pressure
                inspection.tyreReadings.forEach { reading ->
                    val depthVal = reading.treadDepth?.toDoubleOrNull()
                    val pressVal = reading.pressure?.toDoubleOrNull()
                    
                    if (depthVal != null && depthVal <= 2.0) {
                        notificationManager.sendCriticalTyreAlert(
                            assetNumber = inspection.assetNumber,
                            tyrePosition = reading.position,
                            treadDepth = depthVal,
                            pressure = pressVal
                        )
                    } else if (depthVal != null && depthVal <= 3.5) {
                        notificationManager.sendTyreLifeWarning(
                            assetNumber = inspection.assetNumber,
                            tyrePosition = reading.position,
                            remainingLifePercent = ((depthVal / 8.0) * 100).toInt().coerceIn(0, 100),
                            predictedKmLeft = ((depthVal - 2.0) * 8000).toInt().coerceAtLeast(0)
                        )
                    }
                }
            } else {
                _uiState.update { it.copy(isSubmitting = false, error = result.exceptionOrNull()?.message) }
            }
        }
    }
}
