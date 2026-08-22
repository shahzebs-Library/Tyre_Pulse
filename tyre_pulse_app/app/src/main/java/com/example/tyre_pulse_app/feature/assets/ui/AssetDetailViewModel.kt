package com.example.tyre_pulse_app.feature.assets.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
import com.example.tyre_pulse_app.core.model.Asset
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.random.Random

data class TelemetryData(
    val engineTemp: Float = 0f,
    val oilPressure: Float = 0f,
    val fuelLevel: Float = 0f,
    val healthScore: Int = 100,
    val aiRiskMessage: String? = null
)

data class AssetDetailUiState(
    val asset: Asset? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    val telemetry: TelemetryData = TelemetryData()
)

@HiltViewModel
class AssetDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val assetRepository: AssetRepository,
    private val workspaceManager: WorkspaceManager
) : ViewModel() {

    private val assetId: String = savedStateHandle["assetId"] ?: ""
    
    private val _uiState = MutableStateFlow(AssetDetailUiState(isLoading = true))
    val uiState = _uiState.asStateFlow()

    init {
        loadAsset()
        startTelemetrySimulation()
    }

    private fun loadAsset() {
        viewModelScope.launch {
            try {
                val workspace = workspaceManager.currentWorkspace.filterNotNull().first()
                val tenantId = workspace.tenant.id
                val realAsset = assetRepository.getAsset(assetId, tenantId)
                _uiState.update { it.copy(asset = realAsset, isLoading = false) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "Failed to load asset", isLoading = false) }
            }
        }
    }

    private fun startTelemetrySimulation() {
        viewModelScope.launch {
            while (true) {
                _uiState.update { current ->
                    val temp = 85f + Random.nextFloat() * 10f
                    val pressure = 40f + Random.nextFloat() * 5f
                    val score = if (temp > 92f) 82 else 94
                    val risk = if (temp > 92f) "High Engine Temp Detected" else null
                    
                    current.copy(
                        telemetry = TelemetryData(
                            engineTemp = temp,
                            oilPressure = pressure,
                            fuelLevel = 78f,
                            healthScore = score,
                            aiRiskMessage = risk
                        )
                    )
                }
                delay(2500) // Update every 2.5s
            }
        }
    }
}
