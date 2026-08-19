package com.example.tyre_pulse_app.feature.scan.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.feature.scan.data.ScanResolution
import com.example.tyre_pulse_app.feature.scan.data.ScanResolver
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface ScanUiState {
    object Idle : ScanUiState
    object Resolving : ScanUiState
    data class Success(val resolution: ScanResolution) : ScanUiState
    data class Error(val message: String) : ScanUiState
}

@HiltViewModel
class ScanViewModel @Inject constructor(
    private val scanResolver: ScanResolver,
    private val workspaceManager: WorkspaceManager
) : ViewModel() {

    private val _uiState = MutableStateFlow<ScanUiState>(ScanUiState.Idle)
    val uiState: StateFlow<ScanUiState> = _uiState.asStateFlow()

    fun resolveBarcode(rawCode: String) {
        if (_uiState.value is ScanUiState.Resolving) return
        
        _uiState.value = ScanUiState.Resolving
        viewModelScope.launch {
            try {
                val workspace = workspaceManager.currentWorkspace.firstOrNull()
                val tenantId = workspace?.tenant?.id ?: "00000000-0000-0000-0000-000000000001"
                
                val result = scanResolver.resolveScan(rawCode, tenantId)
                _uiState.value = ScanUiState.Success(result)
            } catch (e: Exception) {
                _uiState.value = ScanUiState.Error(e.message ?: "Failed to resolve scan")
            }
        }
    }

    fun resetState() {
        _uiState.value = ScanUiState.Idle
    }
}
