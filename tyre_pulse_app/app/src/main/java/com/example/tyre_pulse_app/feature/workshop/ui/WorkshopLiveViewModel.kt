package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.data.repository.WorkshopRepository
import com.example.tyre_pulse_app.core.model.WorkOrder
import com.example.tyre_pulse_app.core.model.WorkshopEvent
import com.example.tyre_pulse_app.core.network.dto.WorkshopEventDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.OffsetDateTime
import javax.inject.Inject

/**
 * Time on shift, split by what the technician was actually doing.
 *
 * `productiveMin` and `blockedMin` are null when there is nothing to measure - no
 * events yet today - rather than 0, because "nobody has recorded anything" and
 * "worked zero minutes" are different statements and only one of them is an
 * accusation.
 */
data class Productivity(
    val productiveMin: Int? = null,
    val blockedMin: Int? = null,
    val jobsCompleted: Int = 0,
)

data class WorkshopLiveUiState(
    val jobs: List<WorkOrder> = emptyList(),
    val events: List<WorkshopEvent> = emptyList(),
    val isCheckedIn: Boolean = false,
    val selectedJobId: String? = null,
    val productivity: Productivity = Productivity(),
    val site: String? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class WorkshopLiveViewModel @Inject constructor(
    private val repository: WorkshopRepository,
    private val userRepository: UserRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(WorkshopLiveUiState())
    val uiState = _uiState.asStateFlow()

    private var currentUserId: String? = null

    init {
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val user = userRepository.getCurrentUser().filterNotNull().first()
            currentUserId = user.id

            combine(
                repository.getWorkOrders(),
                repository.getLiveEvents(user.id),
            ) { jobs, events ->
                jobs to events
            }
                .catch { e ->
                    // Surface the failure. Leaving the spinner up, or showing an
                    // empty board, would read as "no work" rather than "we could
                    // not check".
                    _uiState.update { it.copy(isLoading = false, error = e.message) }
                }
                .collect { (jobs, events) ->
                    _uiState.update { state ->
                        state.copy(
                            jobs = jobs,
                            events = events,
                            isCheckedIn = isCheckedIn(events),
                            selectedJobId = state.selectedJobId ?: jobs.firstOrNull()?.id,
                            productivity = calculateProductivity(events),
                            // The site comes from the work actually in front of this
                            // technician. Null when nothing says where they are.
                            site = jobs.firstOrNull { !it.siteId.isNullOrBlank() }?.siteId,
                            isLoading = false,
                            error = null,
                        )
                    }
                }
        }
    }

    /**
     * Record a technician action.
     *
     * This writes straight through and reports a failure. It used to enqueue a
     * `WORKSHOP_EVENT` into the offline queue and then optimistically add the event
     * to the list - but that queue drains to a table that does not exist, so the tap
     * always LOOKED recorded and never was. Showing an action as done when it was
     * not is worse than showing it failed.
     */
    fun recordEvent(type: String, jobId: String? = null, reason: String? = null, note: String? = null) {
        val userId = currentUserId ?: return
        viewModelScope.launch {
            try {
                val saved = repository.recordEvent(
                    userId = userId,
                    eventType = type,
                    jobId = jobId,
                    reasonCode = reason,
                    note = note,
                    site = _uiState.value.site,
                )
                _uiState.update { state ->
                    val events = state.events + saved
                    state.copy(
                        events = events,
                        isCheckedIn = isCheckedIn(events),
                        productivity = calculateProductivity(events),
                        error = null,
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "The activity could not be recorded.") }
            }
        }
    }

    fun selectJob(id: String) {
        _uiState.update { it.copy(selectedJobId = id) }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * On duty when the most recent of check_in / check_out is a check_in.
     *
     * The previous version compared each check_out against the FIRST check_in it
     * found, so a second shift in one day read as off duty. Ordering the two event
     * types and taking the last one is what the question actually asks.
     */
    private fun isCheckedIn(events: List<WorkshopEvent>): Boolean =
        events.asSequence()
            .filter {
                it.eventType == WorkshopEventDto.CHECK_IN || it.eventType == WorkshopEventDto.CHECK_OUT
            }
            .filter { epochMillisOf(it.at) != null }
            .maxByOrNull { epochMillisOf(it.at) ?: Long.MIN_VALUE }
            ?.eventType == WorkshopEventDto.CHECK_IN

    /**
     * Real productivity, ported from the web engine `src/lib/workshopLive.js`
     * (`EVENT_STATE` + `buildSegments`) so both apps classify a shift the same way.
     *
     * WHAT THIS REPLACED. `Productivity(45, 10, 2)` - a hard-coded stub marked
     * "Stub for now" that told every technician, on every device, that they had been
     * productive for 45 minutes and blocked for 10.
     *
     * The rule that matters is fairness: non-working time is never blanket "idle".
     * Each stretch between two events is classified by the event that opened it -
     * productive, blocked (waiting on parts / tools / approval / a vehicle), on
     * break, in training, or genuinely unassigned. Only productive and blocked are
     * reported here; the rest is neither the technician's output nor their fault.
     */
    private fun calculateProductivity(events: List<WorkshopEvent>): Productivity {
        val ordered = events
            .mapNotNull { event -> epochMillisOf(event.at)?.let { event to it } }
            .sortedBy { it.second }
        if (ordered.isEmpty()) return Productivity()

        var productiveMs = 0L
        var blockedMs = 0L
        var state: String? = null
        var start: Long? = null

        fun close(end: Long) {
            val from = start ?: return
            val kind = state ?: return
            if (end <= from) return
            when (kind) {
                PRODUCTIVE -> productiveMs += end - from
                BLOCKED -> blockedMs += end - from
            }
        }

        for ((event, at) in ordered) {
            // report_problem is an annotation: it flags something without changing
            // what the technician is doing, so the running segment continues.
            if (event.eventType == WorkshopEventDto.REPORT_PROBLEM) continue

            val next = stateFor(event) ?: continue
            close(at)
            if (next == OFF) {
                state = null
                start = null
                continue
            }
            state = next
            start = at
        }
        close(Instant.now().toEpochMilli())

        return Productivity(
            productiveMin = (productiveMs / 60_000L).toInt(),
            blockedMin = (blockedMs / 60_000L).toInt(),
            jobsCompleted = ordered.count { it.first.eventType == WorkshopEventDto.COMPLETE_TASK },
        )
    }

    /**
     * The state an event moves the technician into. Mirrors `EVENT_STATE` in the web
     * engine. An unmapped event type returns null and is skipped rather than being
     * guessed at.
     */
    private fun stateFor(event: WorkshopEvent): String? = when (event.eventType) {
        WorkshopEventDto.CHECK_IN, WorkshopEventDto.END_BREAK, WorkshopEventDto.COMPLETE_TASK -> UNASSIGNED
        WorkshopEventDto.START_JOB, WorkshopEventDto.RESUME_JOB -> PRODUCTIVE
        WorkshopEventDto.REQUEST_PARTS,
        WorkshopEventDto.WAITING_TOOLS,
        WorkshopEventDto.WAITING_APPROVAL,
        WorkshopEventDto.WAITING_VEHICLE,
        -> BLOCKED
        WorkshopEventDto.START_BREAK -> BREAK
        WorkshopEventDto.TRAINING -> TRAINING
        WorkshopEventDto.CHECK_OUT -> OFF
        // A pause carries its own reason: a blocked reason is blocked time, a break
        // is a break, and a bare pause is unassigned - not blocked, because nothing
        // says anyone else was holding the job up.
        WorkshopEventDto.PAUSE_JOB -> when (event.reasonCode?.trim()?.lowercase().orEmpty()) {
            in BLOCKED_REASONS -> BLOCKED
            "break" -> BREAK
            else -> UNASSIGNED
        }
        else -> null
    }

    /**
     * PostgREST renders timestamptz with a numeric offset - "2026-08-23T10:00:00+00:00" -
     * and `Instant.parse` on Android's java.time only accepts the "Z" form, so it is
     * tried second, not first. An unparseable timestamp yields null and the event is
     * dropped from the calculation rather than being anchored to an invented time.
     */
    private fun epochMillisOf(raw: String?): Long? =
        raw?.takeIf { it.isNotBlank() }?.let { text ->
            runCatching { OffsetDateTime.parse(text).toInstant().toEpochMilli() }.getOrNull()
                ?: runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()
        }

    private companion object {
        const val PRODUCTIVE = "productive"
        const val BLOCKED = "blocked"
        const val UNASSIGNED = "unassigned"
        const val BREAK = "break"
        const val TRAINING = "training"
        const val OFF = "off"

        /** Waiting time that is NOT the technician's fault. Mirrors the web engine. */
        val BLOCKED_REASONS = setOf("parts", "tools", "approval", "vehicle", "vendor", "support")
    }
}
