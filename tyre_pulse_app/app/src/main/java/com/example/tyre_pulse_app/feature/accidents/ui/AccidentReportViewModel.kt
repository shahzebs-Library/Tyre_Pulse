package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
import com.example.tyre_pulse_app.core.data.repository.SyncRepository
import com.example.tyre_pulse_app.core.database.dao.DraftDao
import com.example.tyre_pulse_app.core.model.Accident
import com.example.tyre_pulse_app.core.model.AccidentStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class AccidentReportUiState(
    val currentStep: Int = 1,
    val accident: Accident = Accident(id = UUID.randomUUID().toString(), assetNumber = "", date = "", description = ""),
    val isLoading: Boolean = false,
    val error: String? = null,
    val isSubmitted: Boolean = false,
    val isOfflineSaved: Boolean = false
)

@HiltViewModel
class AccidentReportViewModel @Inject constructor(
    private val assetRepository: AssetRepository,
    private val syncRepository: SyncRepository,
    private val workspaceManager: WorkspaceManager,
    private val draftDao: DraftDao
) : ViewModel() {

    private val _uiState = MutableStateFlow(AccidentReportUiState())
    val uiState: StateFlow<AccidentReportUiState> = _uiState.asStateFlow()

    init {
        // Initialize with current date/time parity with Expo emptyBase()
        val now = java.time.LocalDateTime.now()
        updateAccident { it.copy(
            date = now.toLocalDate().toString(),
            time = now.toLocalTime().toString().substring(0, 5)
        )}
    }

    fun updateAccident(transform: (Accident) -> Accident) {
        _uiState.update { it.copy(accident = transform(it.accident)) }
        calculateRecovered()
    }

    private fun calculateRecovered() {
        val acc = _uiState.value.accident
        val claim = acc.claimAmount ?: 0.0
        val approved = acc.claimApprovedAmount ?: 0.0
        val deductible = acc.deductible ?: 0.0
        
        val recovered = (claim - approved - deductible).coerceAtLeast(0.0)
        if (recovered != acc.recoveredAmount) {
            _uiState.update { it.copy(accident = it.accident.copy(recoveredAmount = recovered)) }
        }
    }

    fun nextStep() {
        if (_uiState.value.currentStep < 7) {
            _uiState.update { it.copy(currentStep = it.currentStep + 1) }
        }
    }

    fun previousStep() {
        if (_uiState.value.currentStep > 1) {
            _uiState.update { it.copy(currentStep = it.currentStep - 1) }
        }
    }

    fun submit() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val workspace = workspaceManager.currentWorkspace.firstOrNull()
            val finalAccident = _uiState.value.accident.copy(
                tenantId = workspace?.tenant?.id,
                companyId = workspace?.company?.id,
                country = workspace?.country?.name,
                site = workspace?.site?.name,
                clientUuid = UUID.randomUUID().toString()
            )

            val result = syncRepository.enqueueCommand("REPORT_ACCIDENT", finalAccident)
            if (result.isSuccess) {
                _uiState.update { it.copy(isLoading = false, isSubmitted = true, isOfflineSaved = result.getOrNull() == true) }
            } else {
                _uiState.update { it.copy(isLoading = false, error = result.exceptionOrNull()?.message) }
            }
        }
    }
}
