package com.example.tyre_pulse_app.feature.home.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.UserRole
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.data.repository.ApprovalRepository
import com.example.tyre_pulse_app.core.data.repository.WorkOrderRepository
import com.example.tyre_pulse_app.core.network.api.InspectionApi
import com.example.tyre_pulse_app.core.model.WorkOrder
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class JobSummary(
    val id: String,
    val assetName: String,
    val type: String,
    val time: String,
    val status: String
)

/**
 * Home dashboard state.
 *
 * The KPI counts are NULLABLE on purpose. Null means "not measured" - the read
 * failed, or nothing is wired to that number yet - and the UI renders that as a dash,
 * never as 0. A dashboard that shows a network failure as "0 open jobs" is worse than
 * one that admits it could not check: the first is quietly wrong and gets acted on.
 */
data class HomeUiState(
    val role: UserRole = UserRole.TECHNICIAN,
    /** Started but not finished. See loadDashboardData for why this is not "due". */
    val inspectionsInProgress: Int? = null,
    val openJobs: Int? = null,
    val pendingApprovals: Int? = null,
    val criticalTyres: Int? = null,
    val todaysJobs: List<JobSummary> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    /** True when at least one figure could not be read, so the screen can say so. */
    val partial: Boolean = false,
    /**
     * The signed-in person's name for the greeting.
     *
     * Null until the profile loads, and null is rendered as a plain greeting with no
     * name. The header used to print the literal "John Technician" to every user on
     * every device - a fabricated identity on the first screen of the app, and
     * indistinguishable from a real profile that failed to load.
     */
    val userName: String? = null,
)

/**
 * WHAT THIS REPLACED. loadDashboardData() previously assigned constants:
 * inspectionsDue = 4, openJobs = 2, and two invented jobs ("Mixer 2841",
 * "Trailer 502"). It injected nothing and called no API, so every user on every
 * device saw the same four fabricated numbers on the first screen of the app.
 */
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val workOrderRepository: WorkOrderRepository,
    private val inspectionApi: InspectionApi,
    private val approvalRepository: ApprovalRepository,
    private val userRepository: UserRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        observeUser()
        loadDashboardData()
    }

    /**
     * Kept separate from loadDashboardData: the name is not a dashboard figure, and a
     * failure to read the KPIs must not blank the greeting (or the reverse). Collected
     * rather than fetched once so a profile arriving late still reaches the header.
     */
    private fun observeUser() {
        viewModelScope.launch {
            userRepository.getCurrentUser().collect { user ->
                _uiState.update { it.copy(userName = user?.name?.takeIf { n -> n.isNotBlank() }) }
            }
        }
    }

    fun loadDashboardData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val openJobs = workOrderRepository.getOpenWorkOrders(limit = TODAY_LIMIT)

            // Inspections that are started but not finished. The table has no
            // "scheduled" or "overdue" state at all - only Done and In Progress - so a
            // "due today" figure cannot be computed from it, and this tile reports what
            // is actually true instead.
            val inProgress = runCatching { inspectionApi.countByStatus(statusEq = "eq.In Progress") }

            val approvals = runCatching { approvalRepository.pendingCount() }

            _uiState.update { state ->
                state.copy(
                    isLoading = false,
                    openJobs = openJobs.getOrNull()?.size,
                    todaysJobs = openJobs.getOrNull()?.map(::toSummary).orEmpty(),
                    inspectionsInProgress = inProgress.getOrNull()?.size,
                    pendingApprovals = approvals.getOrNull(),
                    // NOT wired, and deliberately so: tyre_records.risk_level is null on
                    // every one of the 11,205 rows, so any "critical tyres" count would
                    // be a confident zero derived from no data.
                    criticalTyres = null,
                    partial = openJobs.isFailure || inProgress.isFailure || approvals.isFailure,
                    error = openJobs.exceptionOrNull()?.message,
                )
            }
        }
    }

    private fun toSummary(order: WorkOrder) = JobSummary(
        id = order.id,
        assetName = order.assetNumber.ifBlank { order.jobNumber },
        type = order.reportedIssue.ifBlank { order.type.name },
        // The row carries a full timestamp; the clock time is the useful part on a
        // day view. If it is not a timestamp we show it verbatim rather than
        // formatting something that is not a date.
        time = order.createdAt.substringAfter('T', "").take(5).ifBlank { "--:--" },
        status = order.status.name,
    )

    private companion object {
        const val TODAY_LIMIT = 20
    }
}
