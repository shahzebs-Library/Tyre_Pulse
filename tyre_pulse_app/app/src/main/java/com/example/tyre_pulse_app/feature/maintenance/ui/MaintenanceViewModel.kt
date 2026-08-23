package com.example.tyre_pulse_app.feature.maintenance.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.network.api.MaintenanceApi
import com.example.tyre_pulse_app.core.network.dto.PM_DUE_SOON_DAYS
import com.example.tyre_pulse_app.core.network.dto.PmProgramDto
import com.example.tyre_pulse_app.core.network.dto.RecordServiceRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import javax.inject.Inject

/** How close a programme is to falling due. */
enum class DueBand { OVERDUE, DUE_SOON, OK, NO_DATE }

data class PmPlan(
    val id: String,
    val name: String,
    val assetNo: String?,
    val site: String?,
    val nextDue: String?,
    /** Null when the programme carries no due date - not zero, and not "today". */
    val daysToDue: Int?,
    val nextDueMeter: Double?,
    val meterSource: String?,
    val priority: String?,
    val band: DueBand,
)

data class MaintenanceUiState(
    val plans: List<PmPlan> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val isSaving: Boolean = false,
    val savedMessage: String? = null,
) {
    val overdue: Int get() = plans.count { it.band == DueBand.OVERDUE }
    val dueSoon: Int get() = plans.count { it.band == DueBand.DUE_SOON }
    /** True only after a successful read, so "nothing due" is never shown for a failure. */
    val loadedCleanly: Boolean get() = !isLoading && error == null
}

/**
 * Preventive maintenance programmes that are due.
 *
 * The native app had no PM module. This mirrors the Expo screen, including its
 * due-soon threshold, so the two apps never disagree about what is late.
 */
@HiltViewModel
class MaintenanceViewModel @Inject constructor(
    private val maintenanceApi: MaintenanceApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MaintenanceUiState())
    val uiState = _uiState.asStateFlow()

    init { load() }

    fun load(site: String? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            runCatching { maintenanceApi.getPrograms(siteEq = site?.let { s -> "eq.$s" }) }
                .onSuccess { rows ->
                    _uiState.update { it.copy(isLoading = false, plans = rows.mapNotNull(::toPlan)) }
                }
                .onFailure { e ->
                    // An empty list and a failed read mean opposite things. The list stays
                    // empty AND an error is set, so the screen can say which it is.
                    _uiState.update {
                        it.copy(isLoading = false, error = e.message ?: "Could not load maintenance programmes")
                    }
                }
        }
    }

    /**
     * Record a completed service through the RPC, which advances the schedule in the
     * same transaction. On success the list is reloaded so the new due date is the
     * server's, never one computed here.
     */
    fun recordService(
        plan: PmPlan,
        meterReading: Double?,
        performedBy: String?,
        workshop: String?,
        partsCost: Double?,
        labourCost: Double?,
        findings: String?,
        outcome: String,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null, savedMessage = null) }
            runCatching {
                maintenanceApi.recordService(
                    RecordServiceRequest(
                        programId = plan.id,
                        serviceDate = LocalDate.now().toString(),
                        meterReading = meterReading,
                        performedBy = performedBy?.ifBlank { null },
                        workshop = workshop?.ifBlank { null },
                        site = plan.site,
                        partsCost = partsCost,
                        labourCost = labourCost,
                        findings = findings?.ifBlank { null },
                        outcome = outcome,
                    )
                )
            }.onSuccess {
                _uiState.update { it.copy(isSaving = false, savedMessage = "Service recorded") }
                load()
            }.onFailure { e ->
                _uiState.update {
                    it.copy(isSaving = false, error = e.message ?: "Could not record this service")
                }
            }
        }
    }

    fun consumeMessage() = _uiState.update { it.copy(savedMessage = null, error = null) }

    private fun toPlan(dto: PmProgramDto): PmPlan? {
        val id = dto.id ?: return null
        val days = daysToDue(dto.nextDue)
        return PmPlan(
            id = id,
            name = dto.name?.takeIf { it.isNotBlank() } ?: "Unnamed programme",
            assetNo = dto.assetNo,
            site = dto.site,
            nextDue = dto.nextDue?.take(10),
            daysToDue = days,
            nextDueMeter = dto.nextDueMeter,
            meterSource = dto.meterSource,
            priority = dto.priority,
            band = bandFor(days),
        )
    }

    companion object {
        /** Whole days from today to the due date. Null when there is no usable date. */
        fun daysToDue(nextDue: String?): Int? {
            val text = nextDue?.take(10) ?: return null
            return try {
                ChronoUnit.DAYS.between(LocalDate.now(), LocalDate.parse(text)).toInt()
            } catch (e: DateTimeParseException) {
                // An unparseable date is unknown, not overdue. Treating it as overdue
                // would put a data-entry error at the top of the work list.
                null
            }
        }

        fun bandFor(days: Int?): DueBand = when {
            days == null -> DueBand.NO_DATE
            days < 0 -> DueBand.OVERDUE
            days <= PM_DUE_SOON_DAYS -> DueBand.DUE_SOON
            else -> DueBand.OK
        }
    }
}
