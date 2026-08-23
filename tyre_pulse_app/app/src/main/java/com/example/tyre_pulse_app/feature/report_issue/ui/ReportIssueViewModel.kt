package com.example.tyre_pulse_app.feature.report_issue.ui

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
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject

/**
 * Payload for the REPORT_ISSUE sync command.
 *
 * Field names are the REAL columns of public.corrective_actions. SyncRepository
 * sanitises against an allow-list of exactly these names and drops anything else, so
 * a renamed field here does not error - it silently vanishes from the insert.
 */
@Serializable
data class ReportIssuePayload(
    val title: String,
    val priority: String,
    val status: String = "Open",
    val site: String? = null,
    val asset_no: String? = null,
    val tyre_serial: String? = null,
    val description: String? = null,
    val assigned_to: String? = null,
    val due_date: String? = null,
    val country: String? = null,
    val created_by: String? = null,
)

data class ReportIssueUiState(
    val title: String = "",
    val priority: String = DEFAULT_PRIORITY,
    val site: String = "",
    val assetNo: String = "",
    val description: String = "",
    val dueInDays: Int? = 7,
    val isSaving: Boolean = false,
    val error: String? = null,
    val done: Boolean = false,
) {
    val canSubmit: Boolean get() = title.isNotBlank() && !isSaving
}

/**
 * The database CHECK on corrective_actions.priority accepts exactly High, Medium and
 * Low. The Expo app offers a fourth option, "Critical" - picking it makes the insert
 * violate the constraint, so that issue is never recorded. This app offers only the
 * three the database will accept rather than reproducing that bug.
 */
val ISSUE_PRIORITIES = listOf("High", "Medium", "Low")
const val DEFAULT_PRIORITY = "Medium"

/**
 * Raise a fault from the field.
 *
 * The native app had no equivalent of the Expo app's Report Issue module at all, even
 * though the offline plumbing for it already existed: SyncRepository already maps the
 * REPORT_ISSUE command to corrective_actions and already sanitises its fields. Only
 * the screen was missing.
 */
@HiltViewModel
class ReportIssueViewModel @Inject constructor(
    private val syncRepository: SyncRepository,
    private val userRepository: UserRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ReportIssueUiState())
    val uiState = _uiState.asStateFlow()

    fun prefill(assetNo: String?, site: String?) {
        _uiState.update {
            it.copy(
                assetNo = assetNo?.takeIf { a -> a.isNotBlank() } ?: it.assetNo,
                site = site?.takeIf { s -> s.isNotBlank() } ?: it.site,
            )
        }
    }

    fun onTitle(v: String) = _uiState.update { it.copy(title = v, error = null) }
    fun onPriority(v: String) = _uiState.update { it.copy(priority = v) }
    fun onSite(v: String) = _uiState.update { it.copy(site = v) }
    fun onAsset(v: String) = _uiState.update { it.copy(assetNo = v) }
    fun onDescription(v: String) = _uiState.update { it.copy(description = v) }
    fun onDueInDays(v: Int?) = _uiState.update { it.copy(dueInDays = v) }

    fun submit() {
        val state = _uiState.value
        if (!state.canSubmit) return

        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null) }

            val user = runCatching { userRepository.getCurrentUser().first() }.getOrNull()

            val payload = ReportIssuePayload(
                title = state.title.trim(),
                priority = state.priority,
                site = state.site.trim().ifBlank { null },
                asset_no = state.assetNo.trim().ifBlank { null },
                description = state.description.trim().ifBlank { null },
                // Who raised it, as a name. The column is free text, not a user id.
                assigned_to = user?.name?.ifBlank { null },
                due_date = state.dueInDays?.let {
                    Instant.now().plus(it.toLong(), ChronoUnit.DAYS).toString()
                },
                created_by = user?.id,
            )

            val result = syncRepository.enqueueCommand("REPORT_ISSUE", payload)
            _uiState.update {
                if (result.isSuccess) {
                    it.copy(isSaving = false, done = true)
                } else {
                    // The write failed outright. Do NOT navigate away as though it had
                    // been recorded - an approval decision elsewhere in this app used to
                    // do exactly that and the report vanished silently.
                    it.copy(
                        isSaving = false,
                        error = result.exceptionOrNull()?.message ?: "Could not raise this issue",
                    )
                }
            }
        }
    }

    fun consumeDone() = _uiState.update { it.copy(done = false) }
}
