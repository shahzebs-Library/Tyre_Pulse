package com.example.tyre_pulse_app.feature.team.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.network.api.TeamApi
import com.example.tyre_pulse_app.core.network.api.WorkshopApi
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Team status.
 *
 * WHAT THIS REPLACED. The default state WAS the data: four invented technicians -
 * "John Doe", "Jane Smith", "Ahmed Khan", "Mike Ross" - with invented statuses and
 * jobs. There was no repository and no API, so every user saw the same four fictional
 * people whatever the real crew was doing.
 *
 * It now reads real people from profiles and their latest recorded activity from
 * tech_activity_events.
 *
 * TWO HONESTY RULES THAT MATTER HERE:
 *
 * 1. A person with no recorded event reads "No activity recorded", never "Idle".
 *    "Idle" asserts they are doing nothing; the truth is that nothing was recorded,
 *    and on a board a manager acts from those are very different claims.
 *
 * 2. tech_activity_events carries an own-visibility policy: `user_id = auth.uid()
 *    OR app_is_elevated()`. A non-elevated user therefore sees only their OWN
 *    activity, so for them every colleague would show as having no activity. The
 *    screen states that rather than letting it read as a quiet team.
 */
data class TeamMemberStatus(
    val id: String,
    val name: String,
    val role: String?,
    val site: String?,
    /** Null when nothing has been recorded for this person. Never defaulted to "Idle". */
    val lastEvent: String?,
    val lastEventAt: String?,
) {
    val hasActivity: Boolean get() = lastEvent != null
}

data class TeamUiState(
    val members: List<TeamMemberStatus> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    /**
     * True when the activity read returned nothing at all. Paired with the RLS rule
     * above, it is why the screen can say "you can only see your own activity"
     * instead of implying the whole team is doing nothing.
     */
    val noActivityVisible: Boolean = false,
)

@HiltViewModel
class TeamViewModel @Inject constructor(
    private val teamApi: TeamApi,
    private val workshopApi: WorkshopApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TeamUiState())
    val uiState = _uiState.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val people = runCatching { teamApi.getTeam() }
            if (people.isFailure) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = people.exceptionOrNull()?.message ?: "Could not load the team",
                    )
                }
                return@launch
            }

            // Activity is best-effort: the roster is still worth showing without it.
            val events = runCatching { workshopApi.getWorkshopEvents() }.getOrNull().orEmpty()
            val latestByUser = events
                .filter { it.userId != null }
                .groupBy { it.userId }
                .mapValues { (_, rows) -> rows.maxByOrNull { it.at.orEmpty() } }

            val members = people.getOrNull().orEmpty().mapNotNull { p ->
                val id = p.id ?: return@mapNotNull null
                val latest = latestByUser[id]
                TeamMemberStatus(
                    id = id,
                    name = p.fullName?.takeIf { it.isNotBlank() }
                        ?: p.username?.takeIf { it.isNotBlank() }
                        ?: "Unnamed",
                    role = p.role,
                    site = p.site,
                    lastEvent = latest?.eventType,
                    lastEventAt = latest?.at,
                )
            }

            _uiState.update {
                it.copy(
                    isLoading = false,
                    members = members,
                    noActivityVisible = events.isEmpty() && members.isNotEmpty(),
                )
            }
        }
    }
}
