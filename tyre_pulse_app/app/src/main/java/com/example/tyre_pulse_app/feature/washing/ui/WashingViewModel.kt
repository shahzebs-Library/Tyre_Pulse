package com.example.tyre_pulse_app.feature.washing.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.data.repository.SyncRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
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
    private val syncRepository: SyncRepository,
    private val workspaceManager: WorkspaceManager,
    private val userRepository: UserRepository
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
        val asset = _uiState.value.selectedAsset ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val workspace = workspaceManager.currentWorkspace.filterNotNull().first()
                val user = userRepository.getCurrentUser().filterNotNull().first()
                
                val payload = mapOf(
                    "asset_no" to asset,
                    "driver_name" to user.name,
                    "date" to SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()),
                    "status" to _uiState.value.washType,
                    "site" to (workspace.site?.name ?: "Main Site")
                )

                syncRepository.enqueueCommand(
                    type = "WASH_RECORD",
                    payload = payload,
                    tenantId = workspace.tenant.id,
                    companyId = workspace.company.id,
                    countryId = workspace.country.id,
                    siteId = workspace.site?.id,
                    userId = user.id
                )
            } catch (e: Exception) {
                android.util.Log.e("WashingViewModel", "Failed to submit wash record", e)
            } finally {
                _uiState.update { it.copy(isLoading = false, selectedAsset = null) }
            }
        }
    }
}
