package com.example.tyre_pulse_app.feature.inventory.ui

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

data class StockUiState(
    val selectedSite: String = "Qiddiya Site",
    val inventory: List<StockItem> = listOf(
        StockItem("Bridgestone M729", "315/80R22.5", "New", 24, 0xFF4CAF50),
        StockItem("Michelin X Multi", "315/80R22.5", "New", 12, 0xFFFFCC00),
        StockItem("Continental HDR", "315/80R22.5", "Retread", 45, 0xFF2196F3),
        StockItem("Pirelli TR01", "315/80R22.5", "Used", 8, 0xFFF44336)
    )
)

data class StockItem(
    val brand: String,
    val size: String,
    val type: String,
    val quantity: Int,
    val statusColor: Long
)

class StockViewModel @Inject constructor() : ViewModel() {
    private val _uiState = MutableStateFlow(StockUiState())
    val uiState = _uiState.asStateFlow()
}
