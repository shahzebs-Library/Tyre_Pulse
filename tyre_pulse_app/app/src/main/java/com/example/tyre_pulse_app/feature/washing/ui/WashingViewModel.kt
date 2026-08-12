package com.example.tyre_pulse_app.feature.washing.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WashingUiState(
    val isLoading: Boolean = false,
    val selectedAsset: String? = null,
    val washType: String = "Full",
    val dueVehicles: List<String> = listOf("Mixer 2841", "Pump Truck 112"),
    val lastWashDate: String = "2025-05-10"
)

@HiltViewModel
class WashingViewModel @Inject constructor(
    private val workspaceManager: WorkspaceManager
) : ViewModel() {
    private val _uiState = MutableStateFlow(WashingUiState())
    val uiState = _uiState.asStateFlow()

    fun onAssetSelected(assetNo: String) {
        _uiState.update { it.copy(selectedAsset = assetNo) }
    }

    fun onWashTypeSelected(type: String) {
        _uiState.update { it.copy(washType = type) }
    }

    fun submitWash() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            // TODO: Connect to Real Wash API
            _uiState.update { it.copy(isLoading = false, selectedAsset = null) }
        }
    }
}
