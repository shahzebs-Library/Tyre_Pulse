package com.example.tyre_pulse_app.feature.assets.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.AssetRepository
import com.example.tyre_pulse_app.core.model.Asset
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AssetDetailUiState(
    val asset: Asset? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class AssetDetailViewModel @Inject constructor(
    private val assetRepository: AssetRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val assetId: String = checkNotNull(savedStateHandle["assetId"])

    private val _uiState = MutableStateFlow(AssetDetailUiState())
    val uiState: StateFlow<AssetDetailUiState> = _uiState.asStateFlow()

    init {
        loadAsset()
    }

    private fun loadAsset() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                val asset = assetRepository.getAsset(assetId)
                _uiState.value = _uiState.value.copy(asset = asset, isLoading = false)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(error = e.message, isLoading = false)
            }
        }
    }
}
