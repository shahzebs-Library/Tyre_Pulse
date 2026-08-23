package com.example.tyre_pulse_app.feature.inventory.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.network.api.StockApi
import com.example.tyre_pulse_app.core.network.dto.StockRecordDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Stock on hand, read from public.stock_records.
 *
 * WHAT THIS REPLACED. The default UI state WAS the inventory: four invented lines
 * ("Bridgestone M729", "Michelin X Multi", "Continental HDR", "Pirelli TR01") at a
 * hard-coded site called "Qiddiya Site". Nothing was injected and no endpoint
 * existed, so the Stock screen showed the same fictional stock to everyone.
 *
 * The class was also missing @HiltViewModel. It survived only because its
 * constructor took no arguments, so the default factory could build it - the moment
 * it gained a dependency (as it now has) that would have failed at runtime.
 */
data class StockUiState(
    val selectedSite: String? = null,
    val inventory: List<StockItem> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
)

/**
 * One line of stock. Fields renamed to what the table actually holds - the old
 * `brand`/`size`/`type` triple existed to describe the invented tyres and had no
 * counterpart in stock_records.
 */
data class StockItem(
    val description: String,
    val location: String,
    val status: String,
    val quantity: Int,
    val statusColor: Long,
)

@HiltViewModel
class StockViewModel @Inject constructor(
    private val stockApi: StockApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(StockUiState())
    val uiState = _uiState.asStateFlow()

    init {
        load()
    }

    fun load(site: String? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            runCatching { stockApi.getStockRecords(siteEq = site?.let { s -> "eq.$s" }) }
                .onSuccess { rows ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            selectedSite = site,
                            inventory = rows.map(::toItem),
                        )
                    }
                }
                .onFailure { e ->
                    // An empty list and a failed read mean opposite things. Keeping the
                    // list empty AND setting an error lets the screen say which.
                    _uiState.update {
                        it.copy(isLoading = false, error = e.message ?: "Could not load stock")
                    }
                }
        }
    }

    private fun toItem(row: StockRecordDto): StockItem {
        val qty = row.stockQty ?: 0
        return StockItem(
            description = row.description?.takeIf { it.isNotBlank() } ?: "Unnamed item",
            location = row.site?.takeIf { it.isNotBlank() } ?: "No site",
            status = row.stockStatus?.takeIf { it.isNotBlank() } ?: statusFor(qty, row),
            quantity = qty,
            statusColor = colourFor(qty, row),
        )
    }

    /** Only used when the row carries no stock_status of its own. */
    private fun statusFor(qty: Int, row: StockRecordDto): String = when {
        row.criticalLevel != null && qty <= row.criticalLevel -> "Critical"
        row.minLevel != null && qty <= row.minLevel -> "Low"
        else -> "In stock"
    }

    private fun colourFor(qty: Int, row: StockRecordDto): Long = when {
        row.criticalLevel != null && qty <= row.criticalLevel -> COLOUR_CRITICAL
        row.minLevel != null && qty <= row.minLevel -> COLOUR_LOW
        else -> COLOUR_OK
    }

    private companion object {
        const val COLOUR_OK = 0xFF4CAF50
        const val COLOUR_LOW = 0xFFFFCC00
        const val COLOUR_CRITICAL = 0xFFF44336
    }
}
