package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.AccidentRepository
import com.example.tyre_pulse_app.core.model.Accident
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * One accident case.
 *
 * WHAT THIS REPLACED. AccidentCaseScreen took a `caseId` and then ignored it. Every
 * case, whichever row the user tapped in the register, rendered the same fixed text:
 * status "Under Review", "Assigned Officer: Sarah Connor", and a narrative about
 * "Vehicle TRK-09" and a "3D telematics model" that does not exist in this system.
 *
 * That was reachable in the shipped app - the register's row click routes straight
 * here - so opening a real incident showed someone else's invented story with a real
 * case id in the address. An accident record is evidence; this is the worst place in
 * the app for fabricated narrative.
 *
 * There is no "assigned officer" field anywhere in the accident schema, so that line
 * is not re-derived from something else - it is simply gone, rather than filled with
 * the nearest available name.
 */
data class AccidentCaseUiState(
    val accident: Accident? = null,
    val isLoading: Boolean = true,
    val error: String? = null,
)

@HiltViewModel
class AccidentCaseViewModel @Inject constructor(
    private val accidentRepository: AccidentRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AccidentCaseUiState())
    val uiState = _uiState.asStateFlow()

    /**
     * Loaded per id rather than in `init` so the screen passes the id it was actually
     * routed with. Guarded against reloading a case already held, because the screen
     * calls this from a LaunchedEffect.
     */
    fun load(caseId: String) {
        if (caseId.isBlank()) {
            _uiState.value = AccidentCaseUiState(isLoading = false, error = "No case was specified.")
            return
        }
        if (_uiState.value.accident?.id == caseId) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            runCatching { accidentRepository.getAccident(caseId) }
                .onSuccess { accident ->
                    _uiState.value = AccidentCaseUiState(accident = accident, isLoading = false)
                }
                .onFailure { e ->
                    // The repository already raises a readable sentence for a row that
                    // is missing or out of scope; anything else degrades to one line.
                    _uiState.value = AccidentCaseUiState(
                        isLoading = false,
                        error = e.message?.takeIf { it.isNotBlank() }
                            ?: "This case could not be loaded.",
                    )
                }
        }
    }
}
