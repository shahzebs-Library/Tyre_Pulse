package com.example.tyre_pulse_app.feature.odometer.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.StorageRepository
import com.example.tyre_pulse_app.core.network.api.OdometerApi
import com.example.tyre_pulse_app.core.network.dto.OdometerLogPayload
import com.example.tyre_pulse_app.core.data.repository.SyncRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.util.UUID
import javax.inject.Inject

// OdometerLogPayload moved to core.network.dto and CORRECTED. The version that lived
// here sent "photo_url", which is not a column on odometer_logs (the real one is
// "photos", a text array). With encodeDefaults on, that key was written even when no
// photo was attached, and PostgREST rejects an unknown column - so every queued
// odometer reading failed on sync, silently, after the driver had moved on.

data class OdometerUiState(
    val isSubmitting: Boolean = false,
    val error: String? = null,
    /**
     * The asset's last recorded reading. NULL means "not known" - either none has been
     * recorded or the lookup failed. It is never 0 and never a placeholder, because the
     * screen validates against this value: a fabricated baseline silently rejects or
     * accepts the wrong readings.
     */
    val previousOdometer: Int? = null,
    val loadingPrevious: Boolean = false,
)

@HiltViewModel
class OdometerViewModel @Inject constructor(
    private val syncRepository: SyncRepository,
    private val storageRepository: StorageRepository,
    private val odometerApi: OdometerApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(OdometerUiState())
    val uiState = _uiState.asStateFlow()

    /** Fetch the asset's last reading so the new one can be checked against it. */
    fun loadPreviousReading(assetNo: String) {
        if (assetNo.isBlank()) return
        viewModelScope.launch {
            _uiState.update { it.copy(loadingPrevious = true) }
            val km = runCatching { odometerApi.getLatestReading(assetNoEq = "eq.$assetNo") }
                .getOrNull()
                ?.firstOrNull()
                ?.odometerKm
                ?.toInt()
            // A failed lookup and "no reading yet" both leave this null on purpose. The
            // screen then skips the backwards check rather than measuring against a
            // number it does not have.
            _uiState.update { it.copy(previousOdometer = km, loadingPrevious = false) }
        }
    }

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
                    odometer_km = reading.toLong(),
                    reading_date = LocalDate.now().toString(),
                    // The column is text[], so one uploaded path is a single-item list.
                    photos = photoPath?.let { listOf(it) },
                    client_uuid = UUID.randomUUID().toString(),
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
