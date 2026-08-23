package com.example.tyre_pulse_app.feature.rca.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.data.repository.SyncRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import javax.inject.Inject

/**
 * Payload for the RCA sync command.
 *
 * Field names are the REAL columns of public.rca_records. SyncRepository sanitises
 * against an allow-list of exactly these names and drops anything else, so a
 * renamed field here does not error - it silently vanishes from the insert.
 *
 * `contributing_factors` is a text[] on the table (the shipped Expo screen writes
 * `string[] | null` and the web reads it with Array.isArray), which is why the five
 * whys go across as a list rather than one paragraph.
 */
@Serializable
data class RcaPayload(
    val root_cause: String,
    val asset_no: String? = null,
    val contributing_factors: List<String>? = null,
    val created_by: String? = null,
)

data class RcaUiState(
    val assetNo: String = "",
    val defectType: String = "",
    val rootCauses: List<String> = listOf(
        "Operator Error",
        "Material Fatigue",
        "Maintenance Overdue",
        "Road Conditions",
        "Impact Damage",
    ),
    val selectedCause: String? = null,
    val why1: String = "",
    val why2: String = "",
    val why3: String = "",
    val why4: String = "",
    val why5: String = "",
    val isSubmitting: Boolean = false,
    val error: String? = null,
) {
    /** The five whys, in order, with the blanks left out. */
    val whys: List<String>
        get() = listOf(why1, why2, why3, why4, why5)
            .map { it.trim() }
            .filter { it.isNotEmpty() }

    /**
     * An RCA with no cause and no whys is a blank row, and rca_records would accept
     * it - so it would land looking like a real investigation nobody performed.
     */
    val canSubmit: Boolean get() = !isSubmitting && (selectedCause != null || whys.isNotEmpty())
}

/**
 * Record a root-cause investigation.
 *
 * WHAT THIS REPLACED, because all of it was broken at once:
 *
 *  1. It enqueued the command type "SUBMIT_RCA". SyncRepository has never mapped
 *     that name - it maps "RCA" - so every queued investigation aimed at a table
 *     derived from the command name, failed on sync, and stayed failed.
 *  2. Renaming the command alone would not have saved it. The payload was a map
 *     keyed `assetNo, defectType, selectedCause, why1..why5`, and NOT ONE of those
 *     is a column of rca_records. The queue's allow-list drops every key it does
 *     not recognise, so the insert would have gone out as `{}` - a blank RCA row
 *     that reads as a real record.
 *  3. `submit` ignored the returned Result and called `onSuccess()` regardless, so
 *     the screen navigated back and the technician was told an investigation had
 *     been recorded that had, in fact, failed twice over. This is the same
 *     anti-pattern ReportIssueViewModel and ApprovalDetailsViewModel already
 *     document as fixed; `onSuccess` now runs ONLY when the record is queued.
 *
 * DELIBERATELY NOT SENT: `failure_date`. The Expo screen stamps today's date, but
 * this screen asks for no date at all, and an RCA is routinely written up days
 * after the failure - so today's date would be a guess presented as a measurement.
 * A null failure date reads as "not recorded", which is the truth. Likewise `site`,
 * `brand`, `tyre_serial` and `km_at_failure`: this screen captures none of them.
 */
@HiltViewModel
class RcaViewModel @Inject constructor(
    private val syncRepository: SyncRepository,
    private val userRepository: UserRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(RcaUiState())
    val uiState = _uiState.asStateFlow()

    /** Prefill from a caller that already knows the machine (scan, tyre detail). */
    fun prefill(assetNo: String?) {
        val trimmed = assetNo?.trim().orEmpty()
        if (trimmed.isEmpty()) return
        _uiState.update { it.copy(assetNo = trimmed) }
    }

    fun onAssetNoChanged(value: String) = _uiState.update { it.copy(assetNo = value, error = null) }

    fun onDefectTypeChanged(value: String) = _uiState.update { it.copy(defectType = value) }

    fun onCauseSelected(cause: String) {
        _uiState.update { it.copy(selectedCause = cause, error = null) }
    }

    fun onWhyChanged(index: Int, text: String) {
        _uiState.update {
            when (index) {
                1 -> it.copy(why1 = text, error = null)
                2 -> it.copy(why2 = text, error = null)
                3 -> it.copy(why3 = text, error = null)
                4 -> it.copy(why4 = text, error = null)
                5 -> it.copy(why5 = text, error = null)
                else -> it
            }
        }
    }

    fun consumeError() = _uiState.update { it.copy(error = null) }

    fun submit(onSuccess: () -> Unit) {
        val state = _uiState.value
        if (!state.canSubmit) {
            _uiState.update {
                it.copy(error = "Pick a primary category or answer at least one Why before submitting.")
            }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, error = null) }

            val user = runCatching { userRepository.getCurrentUser().first() }.getOrNull()

            // The defect type is not a column of its own, so it is carried as the
            // first line of the cause rather than dropped on the floor.
            val cause = listOfNotNull(
                state.defectType.trim().takeIf { it.isNotEmpty() },
                state.selectedCause?.trim()?.takeIf { it.isNotEmpty() },
            ).joinToString(" - ").ifEmpty { state.whys.first() }

            val result = syncRepository.enqueueCommand(
                "RCA",
                RcaPayload(
                    root_cause = cause,
                    asset_no = state.assetNo.trim().ifBlank { null },
                    contributing_factors = state.whys.takeIf { it.isNotEmpty() },
                    created_by = user?.id,
                ),
            )

            if (result.isSuccess) {
                _uiState.update { it.copy(isSubmitting = false) }
                onSuccess()
            } else {
                // Stay on the screen with the investigation still typed in. Leaving
                // is what made the old failure invisible.
                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        error = result.exceptionOrNull()?.message
                            ?: "This investigation could not be saved. Please try again.",
                    )
                }
            }
        }
    }
}
