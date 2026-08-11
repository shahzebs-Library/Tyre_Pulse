package com.example.tyre_pulse_app.feature.rca.ui

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

data class RcaUiState(
    val assetNo: String = "",
    val defectType: String = "",
    val rootCauses: List<String> = listOf("Operator Error", "Material Fatigue", "Maintenance Overdue", "Road Conditions", "Impact Damage"),
    val selectedCause: String? = null,
    val why1: String = "",
    val why2: String = "",
    val why3: String = "",
    val why4: String = "",
    val why5: String = "",
    val isSubmitting: Boolean = false
)

class RcaViewModel @Inject constructor() : ViewModel() {
    private val _uiState = MutableStateFlow(RcaUiState())
    val uiState = _uiState.asStateFlow()

    fun onCauseSelected(cause: String) {
        _uiState.update { it.copy(selectedCause = cause) }
    }

    fun onWhyChanged(index: Int, text: String) {
        _uiState.update {
            when(index) {
                1 -> it.copy(why1 = text)
                2 -> it.copy(why2 = text)
                3 -> it.copy(why3 = text)
                4 -> it.copy(why4 = text)
                5 -> it.copy(why5 = text)
                else -> it
            }
        }
    }
}
