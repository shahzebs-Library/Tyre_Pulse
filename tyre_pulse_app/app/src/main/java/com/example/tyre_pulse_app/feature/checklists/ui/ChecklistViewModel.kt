package com.example.tyre_pulse_app.feature.checklists.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val templateId: String = savedStateHandle["templateId"] ?: "dvir_1"
    
    private val _uiState = MutableStateFlow(ChecklistUiState())
    val uiState = _uiState.asStateFlow()

    init {
        loadMockTemplate()
    }

    private fun loadMockTemplate() {
        val mockTemplate = ChecklistTemplate(
            id = "dvir_1",
            name = "Driver Daily Inspection (DVIR)",
            fields = listOf(
                ChecklistField("s1", "General Vehicle State", "section"),
                ChecklistField("f1", "Exterior Cleanliness", "boolean", required = true),
                ChecklistField("f2", "Odometer Reading", "number", required = true),
                ChecklistField("s2", "Safety Systems", "section"),
                ChecklistField("f3", "Brake Performance", "boolean", required = true),
                ChecklistField("f4", "Lights & Indicators", "boolean", required = true),
                ChecklistField("has_defects", "Any defects found?", "boolean"),
                ChecklistField(
                    id = "f6",
                    label = "Defect Description",
                    type = "select",
                    options = listOf("Oil Leak", "Brake Squeal", "Tire Wear", "Body Damage"),
                    visibleWhen = VisibilityCondition("has_defects", "eq", "true")
                )
            ),
            scored = true
        )
        _uiState.update { it.copy(template = mockTemplate) }
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
