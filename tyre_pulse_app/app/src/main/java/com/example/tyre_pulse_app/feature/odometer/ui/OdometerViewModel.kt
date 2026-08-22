package com.example.tyre_pulse_app.feature.odometer.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.StorageRepository
import com.example.tyre_pulse_app.core.data.repository.SyncRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import javax.inject.Inject

@Serializable
data class OdometerLogPayload(
    val asset_no: String,
    val odometer_km: Int,
    val photo_url: String? = null
)

data class OdometerUiState(
    val isSubmitting: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class OdometerViewModel @Inject constructor(
    private val syncRepository: SyncRepository,
    private val storageRepository: StorageRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(OdometerUiState())
    val uiState = _uiState.asStateFlow()

    fun submitOdometer(
        vehicleId: String,
        reading: Int,
        photoBytes: ByteArray?,
        onSuccess: () -> Unit
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, error = null) }
            try {
                var photoPath: String? = null
                if (photoBytes != null) {
                    photoPath = storageRepository.uploadPhoto(photoBytes)
                }

                val payload = OdometerLogPayload(
                    asset_no = vehicleId,
                    odometer_km = reading,
                    photo_url = photoPath
                )

                val result = syncRepository.enqueueCommand("ODOMETER_LOG", payload)
                if (result.isSuccess) {
                    onSuccess()
                } else {
                    _uiState.update { it.copy(error = result.exceptionOrNull()?.message ?: "Failed to log odometer") }
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "Unknown error occurred") }
            } finally {
                _uiState.update { it.copy(isSubmitting = false) }
            }
        }
    }
}
