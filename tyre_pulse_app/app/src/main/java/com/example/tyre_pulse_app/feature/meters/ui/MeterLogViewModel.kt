package com.example.tyre_pulse_app.feature.meters.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.SyncRepository
import com.example.tyre_pulse_app.core.network.api.AssetApi
import com.example.tyre_pulse_app.core.network.api.EngineHoursApi
import com.example.tyre_pulse_app.core.network.api.OdometerApi
import com.example.tyre_pulse_app.core.network.dto.EngineHoursLogPayload
import com.example.tyre_pulse_app.core.network.dto.OdometerLogPayload
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.util.UUID
import javax.inject.Inject

/**
 * Recording a meter reading - odometer, engine hours, or both.
 *
 * WHAT THIS REPLACED, and none of it worked:
 *
 * - `currentKm = 125420` and `currentHours = 3640` were HARD-CODED. Both readings
 *   were validated against invented baselines, so a genuine reading could be rejected
 *   and a wrong one accepted, on every asset in the fleet.
 * - `assetNo` defaulted to `""` and nothing could set it - there was no asset field
 *   and no setter - so every submission named no asset.
 * - It enqueued a command type `"METER_LOG"` that has no table mapping, with keys
 *   `new_km` and `new_hours` that are columns of nothing. It aimed at a table called
 *   "meter_log", which does not exist.
 * - `onSuccess()` fired unconditionally, including when the enqueue failed, so the
 *   screen reported a saved reading either way.
 *
 * TWO METERS ARE TWO ROWS IN TWO TABLES. The old payload put km and hours in one
 * object; they live in `odometer_logs` and `engine_hours_logs` respectively. Each is
 * enqueued separately and only when actually entered, so a driver who reads only the
 * hour meter does not also write a phantom odometer row.
 *
 * BACKWARDS READINGS WARN, THEY DO NOT BLOCK. A meter can genuinely be replaced or
 * rolled over, and the database's own convention for this is accept-but-flag, never
 * refuse. Refusing here would leave a fitter standing at a machine unable to record
 * what the meter actually says - and the reading would simply never be captured.
 */
data class MeterLogUiState(
    val assetNo: String = "",
    /** Confirmed against the fleet register. Null until an asset is resolved. */
    val assetResolved: Boolean = false,
    val assetSite: String? = null,
    val lookupError: String? = null,
    val isLookingUp: Boolean = false,

    /**
     * Last recorded readings. NULL means not known - either none recorded or the
     * lookup failed - and the comparison is then skipped rather than run against a
     * number nobody has. Never 0, never a placeholder.
     */
    val previousKm: Long? = null,
    val previousHours: Long? = null,

    val newKm: String = "",
    val newHours: String = "",
    /** Advisory only. A warning never disables the submit button. */
    val kmWarning: String? = null,
    val hoursWarning: String? = null,
    /** Blocking. Set only when the text is not a usable number. */
    val kmError: String? = null,
    val hoursError: String? = null,

    val isSubmitting: Boolean = false,
    val error: String? = null,
) {
    val hasKm: Boolean get() = newKm.isNotBlank()
    val hasHours: Boolean get() = newHours.isNotBlank()

    /** Something to save, an asset to save it against, and nothing unparseable. */
    val canSubmit: Boolean
        get() = assetResolved && (hasKm || hasHours) &&
            kmError == null && hoursError == null && !isSubmitting
}

@HiltViewModel
class MeterLogViewModel @Inject constructor(
    private val syncRepository: SyncRepository,
    private val odometerApi: OdometerApi,
    private val engineHoursApi: EngineHoursApi,
    private val assetApi: AssetApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MeterLogUiState())
    val uiState = _uiState.asStateFlow()

    fun onAssetChanged(value: String) {
        // Any edit invalidates the resolved asset and its baselines - otherwise a
        // reading could be filed against the previous asset's readings.
        _uiState.update {
            it.copy(
                assetNo = value.trim().uppercase(),
                assetResolved = false,
                assetSite = null,
                previousKm = null,
                previousHours = null,
                kmWarning = null,
                hoursWarning = null,
                lookupError = null,
            )
        }
    }

    /**
     * Confirm the asset exists and load both baselines.
     *
     * The asset must be confirmed before anything can be saved. A meter reading filed
     * against an asset number that is not in the register is unattributable, and the
     * old screen allowed exactly that.
     */
    fun lookupAsset() {
        val assetNo = _uiState.value.assetNo
        if (assetNo.isBlank()) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLookingUp = true, lookupError = null) }

            // Range caps the response: this is an exact-match lookup, so one row is all
            // that can come back, and an unbounded read here would be a full-table
            // fetch if the filter were ever dropped.
            val asset = runCatching {
                assetApi.getAssets(range = "0-0", assetNumber = "eq.$assetNo")
            }.getOrNull()?.firstOrNull()

            if (asset == null) {
                _uiState.update {
                    it.copy(
                        isLookingUp = false,
                        assetResolved = false,
                        lookupError = "No asset $assetNo is in the register, " +
                            "or it is outside your access.",
                    )
                }
                return@launch
            }

            // Baselines are best-effort: a failed lookup must not stop the reading
            // being recorded. It only means the comparison is skipped.
            val km = runCatching { odometerApi.getLatestReading(assetNoEq = "eq.$assetNo") }
                .getOrNull()?.firstOrNull()?.odometerKm?.toLong()
            val hours = runCatching { engineHoursApi.getLatestReading(assetNoEq = "eq.$assetNo") }
                .getOrNull()?.firstOrNull()?.engineHours?.toLong()

            _uiState.update {
                it.copy(
                    isLookingUp = false,
                    assetResolved = true,
                    assetSite = asset.site,
                    previousKm = km,
                    previousHours = hours,
                )
            }
            // Re-check anything already typed against the baselines that just arrived.
            onKmChanged(_uiState.value.newKm)
            onHoursChanged(_uiState.value.newHours)
        }
    }

    fun onKmChanged(value: String) {
        val state = _uiState.value
        val parsed = value.trim().takeIf { it.isNotBlank() }?.toLongOrNull()
        val error = if (value.isNotBlank() && parsed == null) "Enter the reading as a whole number" else null
        val warning = warningFor(parsed, state.previousKm, "odometer", "km")
        _uiState.update { it.copy(newKm = value, kmError = error, kmWarning = warning) }
    }

    fun onHoursChanged(value: String) {
        val state = _uiState.value
        val parsed = value.trim().takeIf { it.isNotBlank() }?.toLongOrNull()
        val error = if (value.isNotBlank() && parsed == null) "Enter the reading as a whole number" else null
        val warning = warningFor(parsed, state.previousHours, "hour meter", "hrs")
        _uiState.update { it.copy(newHours = value, hoursError = error, hoursWarning = warning) }
    }

    /** Null when there is nothing to compare against, or nothing worth saying. */
    private fun warningFor(reading: Long?, previous: Long?, meter: String, unit: String): String? {
        if (reading == null || previous == null) return null
        if (reading >= previous) return null
        return "Lower than the last recorded $meter ($previous $unit). " +
            "It will be saved and flagged for review."
    }

    fun submit(onSuccess: () -> Unit) {
        val state = _uiState.value
        if (!state.canSubmit) return

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, error = null) }

            val today = LocalDate.now().toString()
            val failures = mutableListOf<String>()

            if (state.hasKm) {
                state.newKm.trim().toLongOrNull()?.let { km ->
                    val result = syncRepository.enqueueCommand(
                        "ODOMETER_LOG",
                        OdometerLogPayload(
                            asset_no = state.assetNo,
                            odometer_km = km,
                            reading_date = today,
                            site = state.assetSite,
                            // Per reading, so a retried queue item cannot double-write.
                            client_uuid = UUID.randomUUID().toString(),
                        ),
                    )
                    if (result.isFailure) failures += "odometer"
                }
            }

            if (state.hasHours) {
                state.newHours.trim().toLongOrNull()?.let { hours ->
                    val result = syncRepository.enqueueCommand(
                        "ENGINE_HOURS_LOG",
                        EngineHoursLogPayload(
                            asset_no = state.assetNo,
                            engine_hours = hours,
                            reading_date = today,
                            site = state.assetSite,
                            client_uuid = UUID.randomUUID().toString(),
                        ),
                    )
                    if (result.isFailure) failures += "hour meter"
                }
            }

            if (failures.isEmpty()) {
                _uiState.update { it.copy(isSubmitting = false) }
                onSuccess()
            } else {
                // Reported per meter. The old screen called onSuccess() whatever
                // happened, so a driver was told a reading was saved when it was not -
                // and one meter can genuinely fail while the other is queued.
                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        error = "The ${failures.joinToString(" and ")} reading could not be " +
                            "queued. Please try again.",
                    )
                }
            }
        }
    }
}
