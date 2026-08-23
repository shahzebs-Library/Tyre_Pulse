package com.example.tyre_pulse_app.feature.tyres.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.TyreRepository
import com.example.tyre_pulse_app.core.model.TyreHistoryEvent
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The real lifecycle of one tyre.
 *
 * WHAT THIS REPLACED. `TyreHistoryScreen` rendered four hard-coded rows for every
 * tyre in the fleet - "Installed / Mixer 2841 - FL", "Inspected / Condition: Good,
 * Tread: 8mm", "Repaired / Puncture repair - Bay 02", "Purchased / New Bridgestone
 * - Qiddiya Store". None of it came from anywhere. Two of those four events are not
 * even recorded by this system: there is no repair log and no purchase record a
 * tyre's history could be assembled from, so those lines could never have become
 * true. The inspected line went further and asserted a tread depth and a condition.
 *
 * The history that DOES exist is the set of fitment episodes in tyre_records, which
 * `TyreRepository.getTyreHistory` already assembles - fitted here, removed there,
 * refitted, moved to another asset. That is what this loads.
 *
 * FAILURES ARE NOT SWALLOWED. The repository lets a failed read propagate precisely
 * so a caller cannot render it as an empty history, and this keeps that distinction:
 * an error sets [error] and leaves [events] empty, so the screen can say which of
 * the two happened.
 */
data class TyreHistoryUiState(
    val events: List<TyreHistoryEvent> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class TyreHistoryViewModel @Inject constructor(
    private val tyreRepository: TyreRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TyreHistoryUiState())
    val uiState = _uiState.asStateFlow()

    /**
     * The id is passed in by the screen rather than read from SavedStateHandle, so
     * this view model does not depend on what the navigation graph happens to call
     * its argument.
     */
    fun load(tyreId: String) {
        if (tyreId.isBlank()) {
            _uiState.update {
                it.copy(isLoading = false, events = emptyList(), error = "No tyre was selected.")
            }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            runCatching { tyreRepository.getTyreHistory(tyreId) }
                .onSuccess { events ->
                    _uiState.update { it.copy(isLoading = false, events = events) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            events = emptyList(),
                            error = e.message ?: "Could not load this tyre's history",
                        )
                    }
                }
        }
    }
}
