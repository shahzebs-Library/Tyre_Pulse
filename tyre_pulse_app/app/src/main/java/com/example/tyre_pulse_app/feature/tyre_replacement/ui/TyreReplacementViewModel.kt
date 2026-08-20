package com.example.tyre_pulse_app.feature.tyre_replacement.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
import com.example.tyre_pulse_app.core.data.repository.TyreRepository
import com.example.tyre_pulse_app.core.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TyreReplacementUiState(
    val asset: Asset? = null,
    val removedTyre: Tyre? = null,
    val removalReasons: List<RemovalReason> = emptyList(),
    val availableTyres: List<Tyre> = emptyList(),
    val selectedReason: RemovalReason? = null,
    val removalKm: String = "",
    val removalCondition: String = "Worn",
    val selectedNewTyre: Tyre? = null,
    val isLoading: Boolean = false,
    val isSubmitting: Boolean = false,
    val isSubmitted: Boolean = false,
    val error: String? = null,
    val currentStep: Int = 1
)

@HiltViewModel
class TyreReplacementViewModel @Inject constructor(
    private val tyreRepository: TyreRepository,
    private val assetRepository: AssetRepository,
    private val workspaceManager: WorkspaceManager,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val tyreId: String = checkNotNull(savedStateHandle["tyreId"])

    private val _uiState = MutableStateFlow(TyreReplacementUiState())
    val uiState: StateFlow<TyreReplacementUiState> = _uiState.asStateFlow()

    init {
        loadInitialData()
    }

    private fun loadInitialData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val removedTyre = tyreRepository.getTyre(tyreId)
                val asset = removedTyre.currentAssetNumber?.let { assetRepository.searchAssets(removedTyre.tenantId ?: "", it).first().firstOrNull() }
                val reasons = tyreRepository.getRemovalReasons()
                
                _uiState.update { it.copy(
                    removedTyre = removedTyre,
                    asset = asset,
                    removalReasons = reasons,
                    removalKm = asset?.currentKm?.toString() ?: "",
                    isLoading = false
                ) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message, isLoading = false) }
            }
        }
    }

    fun nextStep() {
        if (_uiState.value.currentStep == 1) {
            loadAvailableTyres()
        }
        _uiState.update { it.copy(currentStep = it.currentStep + 1) }
    }

    fun prevStep() {
        _uiState.update { it.copy(currentStep = it.currentStep - 1) }
    }

    private fun loadAvailableTyres() {
        viewModelScope.launch {
            val workspace = workspaceManager.currentWorkspace.filterNotNull().first()
            tyreRepository.searchTyres(workspace.tenant.id, "").collect { tyres ->
                _uiState.update { it.copy(availableTyres = tyres.filter { t -> t.status == TyreStatus.AVAILABLE }) }
            }
        }
    }

    fun onReasonSelected(reason: RemovalReason) {
        _uiState.update { it.copy(selectedReason = reason) }
    }

    fun onKmChanged(km: String) {
        _uiState.update { it.copy(removalKm = km) }
    }

    fun onConditionChanged(condition: String) {
        _uiState.update { it.copy(removalCondition = condition) }
    }

    fun onNewTyreSelected(tyre: Tyre) {
        _uiState.update { it.copy(selectedNewTyre = tyre) }
    }

    fun selectRemovedTyre(tyreId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                val tyre = tyreRepository.getTyre(tyreId)
                _uiState.update { it.copy(removedTyre = tyre, isLoading = false) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message, isLoading = false) }
            }
        }
    }

    fun submit() {
        viewModelScope.launch {
            val state = _uiState.value
            val workspace = workspaceManager.currentWorkspace.filterNotNull().first()
            
            val request = TyreReplacementRequest(
                assetId = state.asset?.id ?: "",
                position = state.removedTyre?.position ?: "",
                removedTyreId = tyreId,
                removalReason = state.selectedReason?.name ?: "",
                removalKm = state.removalKm.toLongOrNull() ?: 0L,
                removalCondition = state.removalCondition,
                installedTyreId = state.selectedNewTyre?.id,
                tenantId = workspace.tenant.id,
                companyId = workspace.company.id,
                countryId = workspace.country.id,
                siteId = workspace.site?.id
            )

            _uiState.update { it.copy(isSubmitting = true) }
            try {
                tyreRepository.submitReplacementRequest(request)
                _uiState.update { it.copy(isSubmitting = false, isSubmitted = true) }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message, isSubmitting = false) }
            }
        }
    }
}
