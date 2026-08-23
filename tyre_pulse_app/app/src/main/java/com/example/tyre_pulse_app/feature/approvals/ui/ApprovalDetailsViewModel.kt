package com.example.tyre_pulse_app.feature.approvals.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.ApprovalRepository
import com.example.tyre_pulse_app.core.model.Approval
import com.example.tyre_pulse_app.core.model.ApprovalSource
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ApprovalDetailsUiState(
    val approval: Approval? = null,
    val isLoading: Boolean = false,
    val isDeciding: Boolean = false,
    /** Failed to LOAD the record. Distinct from [decisionError]. */
    val error: String? = null,
    /** The record loaded, but the decision was refused. */
    val decisionError: String? = null,
    /** True once the read finished and named no row. */
    val notFound: Boolean = false,
    /** The approver's drawn mark as SVG, or null while unsigned. */
    val signature: String? = null,
    val note: String = "",
)

@HiltViewModel
class ApprovalDetailsViewModel @Inject constructor(
    private val repository: ApprovalRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val approvalId: String = checkNotNull(savedStateHandle["approvalId"])

    private val _uiState = MutableStateFlow(ApprovalDetailsUiState())
    val uiState: StateFlow<ApprovalDetailsUiState> = _uiState.asStateFlow()

    init {
        loadApproval()
    }

    fun loadApproval() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null, notFound = false)
            repository.getApprovalById(approvalId)
                .catch { e ->
                    // A failed read is NOT an empty record. Without this the flow
                    // would fail silently and the screen would sit on its spinner
                    // for ever.
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message ?: "Could not load this request",
                    )
                }
                .collect { approval ->
                    _uiState.value = _uiState.value.copy(
                        approval = approval,
                        isLoading = false,
                        notFound = approval == null,
                    )
                }
        }
    }

    fun onSignatureChange(signature: String?) {
        _uiState.value = _uiState.value.copy(signature = signature)
    }

    fun onNoteChange(note: String) {
        _uiState.value = _uiState.value.copy(note = note)
    }

    fun dismissDecisionError() {
        _uiState.value = _uiState.value.copy(decisionError = null)
    }

    /**
     * Can this record be approved with what has been entered so far?
     *
     * `decide_checklist_approval` refuses an approval carrying no signature, so
     * asking for one up front turns a server refusal into a disabled button with
     * a visible reason. An inspection decision does not require one.
     *
     * A PURE function of the state the screen is already observing, deliberately
     * not a method reading `_uiState.value`: the button's enabled flag has to be
     * derived from the same snapshot Compose recomposes on, or it can lag behind
     * the signature that was just drawn.
     */
    fun canApprove(state: ApprovalDetailsUiState): Boolean {
        if (state.isDeciding || state.approval == null) return false
        return state.approval.source != ApprovalSource.CHECKLIST || state.signature != null
    }

    /**
     * Approve or return the record.
     *
     * WHAT THIS REPLACED. It enqueued a sync command of type "UPDATE_APPROVAL".
     * Nothing anywhere consumes that type, so SyncRepository fell through to its
     * default table name and POSTed to `/rest/v1/update_approval` - which does
     * not exist. The request 404'd inside the background queue while this screen
     * called `onComplete()` and navigated back, so the operator believed they had
     * approved something that was never recorded. It also sent the domain enum
     * name ("APPROVED") into a column whose vocabulary is different again.
     *
     * The decision is now awaited, and a refusal is reported rather than
     * swallowed. `onComplete` runs ONLY on success - navigating away from a
     * failed decision is what made the old bug invisible.
     */
    fun decide(approved: Boolean, onComplete: () -> Unit) {
        val state = _uiState.value
        if (state.isDeciding || state.approval == null) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isDeciding = true, decisionError = null)
            try {
                repository.decide(
                    approvalId = approvalId,
                    approved = approved,
                    note = state.note,
                    // A rejection carries no signature: the approver is sending
                    // the record back, not attesting to it.
                    signature = if (approved) state.signature else null,
                )
                _uiState.value = _uiState.value.copy(isDeciding = false)
                onComplete()
            } catch (e: Exception) {
                // The server's own sentence - "This inspection was already
                // approved by X." - is the useful part. Keep the record on
                // screen so the reader can see what they were deciding.
                _uiState.value = _uiState.value.copy(
                    isDeciding = false,
                    decisionError = e.message ?: "That decision could not be recorded.",
                )
            }
        }
    }
}
