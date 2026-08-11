package com.example.tyre_pulse_app.feature.reports.ui

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

data class ReportsUiState(
    val totalTyres: Int = 156,
    val inspected: Int = 138,
    val replaced: Int = 18,
    val puncture: Int = 12,
    val cost: String = "28,450",
    val tyreConditions: List<ConditionStat> = listOf(
        ConditionStat("OK", 72, 0xFF4CAF50),
        ConditionStat("Monitor", 18, 0xFFFF9800),
        ConditionStat("Critical", 10, 0xFFF44336)
    )
)

data class ConditionStat(val label: String, val percentage: Int, val color: Long)

@HiltViewModel
class ReportsViewModel @Inject constructor() : ViewModel() {
    private val _uiState = MutableStateFlow(ReportsUiState())
    val uiState = _uiState.asStateFlow()
}
