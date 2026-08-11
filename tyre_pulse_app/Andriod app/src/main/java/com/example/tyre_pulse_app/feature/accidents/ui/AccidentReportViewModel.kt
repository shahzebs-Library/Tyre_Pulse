package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.database.dao.DraftDao
import com.example.tyre_pulse_app.core.database.model.DraftEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AccidentReportUiState(
    val currentStep: Int = 1,
    val assetNo: String = "",
    val description: String = "",
    val location: String = "",
    val photos: List<String> = emptyList(),
    val isDraftSaved: Boolean = false
)

@HiltViewModel
class AccidentReportViewModel @Inject constructor(
    private val draftDao: DraftDao
) : ViewModel() {
    private val _uiState = MutableStateFlow(AccidentReportUiState())
    val uiState = _uiState.asStateFlow()

    fun updateField(assetNo: String? = null, desc: String? = null) {
        _uiState.update { it.copy(
            assetNo = assetNo ?: it.assetNo,
            description = desc ?: it.description
        )}
        saveDraft()
    }

    private fun saveDraft() {
        viewModelScope.launch {
            // Logic to persist accident draft in Room
        }
    }

    fun nextStep() { _uiState.update { it.copy(currentStep = it.currentStep + 1) } }
}
