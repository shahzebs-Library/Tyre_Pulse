package com.example.tyre_pulse_app.feature.checklists.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.ChecklistRepository
import com.example.tyre_pulse_app.core.model.ChecklistTemplate
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The published checklist templates.
 *
 * WHAT THIS REPLACED. The library listed four templates as `TemplateSummary` literals
 * with invented ids - "dvir_1", "handover_1", "post_maint_1", "gate_pass_1". This was
 * worse than a display fabrication, because the ids were live: tapping a card routed
 * to `checklist_runner/dvir_1`, and no such template exists, so the runner opened on
 * a template it could never load. The library was reachable from the Home hub, so
 * this was the shipped behaviour of the whole checklist feature.
 *
 * `ChecklistRepository.getTemplates()` already existed and was already correct. It
 * simply was not called from here.
 */
data class ChecklistLibraryUiState(
    val templates: List<ChecklistTemplate> = emptyList(),
    val isLoading: Boolean = true,
    val error: String? = null,
)

@HiltViewModel
class ChecklistLibraryViewModel @Inject constructor(
    private val checklistRepository: ChecklistRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChecklistLibraryUiState())
    val uiState = _uiState.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            checklistRepository.getTemplates()
                .onSuccess { templates ->
                    _uiState.value = ChecklistLibraryUiState(templates = templates, isLoading = false)
                }
                .onFailure { e ->
                    // An empty library and an unreachable one are different facts. The
                    // first means nobody has published a checklist; the second means we
                    // could not look. The screen renders them differently.
                    _uiState.value = ChecklistLibraryUiState(
                        isLoading = false,
                        error = e.message?.takeIf { it.isNotBlank() }
                            ?: "Checklists could not be loaded.",
                    )
                }
        }
    }
}
