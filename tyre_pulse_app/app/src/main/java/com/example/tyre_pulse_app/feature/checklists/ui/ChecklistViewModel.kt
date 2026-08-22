package com.example.tyre_pulse_app.feature.checklists.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.ChecklistRepository
import com.example.tyre_pulse_app.core.model.ChecklistField
import com.example.tyre_pulse_app.core.model.ChecklistTemplate
import com.example.tyre_pulse_app.core.model.VisibilityCondition
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ChecklistUiState(
    val isLoading: Boolean = false,
    val template: ChecklistTemplate? = null,
    val answers: Map<String, String> = emptyMap(),
    val error: String? = null
)

@HiltViewModel
class ChecklistViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val checklistRepository: ChecklistRepository
) : ViewModel() {

    private val templateId: String = savedStateHandle["templateId"] ?: "dvir_1"
    
    private val _uiState = MutableStateFlow(ChecklistUiState())
    val uiState = _uiState.asStateFlow()

    init {
        loadTemplate()
    }

    private fun loadTemplate() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val result = checklistRepository.getTemplates()
            if (result.isSuccess) {
                val templates = result.getOrNull() ?: emptyList()
                val match = templates.find { it.id == templateId }
                if (match != null) {
                    _uiState.update { it.copy(template = match, isLoading = false) }
                } else {
                    _uiState.update { it.copy(error = "Template not found", isLoading = false) }
                }
            } else {
                _uiState.update { it.copy(error = result.exceptionOrNull()?.message ?: "Failed to load", isLoading = false) }
            }
        }
    }

    fun updateAnswer(fieldId: String, value: String) {
        _uiState.update { current ->
            val newAnswers = current.answers + (fieldId to value)
            current.copy(answers = newAnswers)
        }
    }

    fun submit() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            // Porting the record queue logic...
            _uiState.update { it.copy(isLoading = false) }
        }
    }
}
