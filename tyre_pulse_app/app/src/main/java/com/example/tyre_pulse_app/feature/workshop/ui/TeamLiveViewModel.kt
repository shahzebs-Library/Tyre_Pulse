package com.example.tyre_pulse_app.feature.workshop.ui

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
 * Team Productivity Live.
 *
 * WHAT THIS REPLACED. The screen's three tabs WERE the data. Twelve invented people -
 * "John T.", "Ahmed S.", "Musa B.", "Kevin L." under Technicians, "Sarah M." and
 * "David O." under Managers, "Omar H.", "Ali M.", "Tariq K." under Drivers - each
 * card carrying an invented job ("ACTIVE: Mixer 2841") and an invented elapsed time
 * ("ELAPSED: 45m") derived from nothing but the tab index. A supervisor reading that
 * board was reading fiction with a live-looking clock on it.
 *
 * It now reads real people from `profiles` and their latest recorded activity from
 * `tech_activity_events`, following [com.example.tyre_pulse_app.feature.team.ui.TeamViewModel],
 * which is this codebase's reference implementation for exactly this shape.
 *
 * THREE HONESTY RULES THAT MATTER HERE:
 *
 * 1. A person with no recorded event reads "No activity recorded", never "Idle".
 *    "Idle" asserts they are doing nothing; the truth is only that nothing was
 *    recorded, and on a board a supervisor acts from those are very different claims.
 *
 * 2. `tech_activity_events` carries an own-visibility policy:
 *    `user_id = auth.uid() OR app_is_elevated()`. A NON-elevated user therefore sees
 *    ONLY THEIR OWN activity, so every colleague legitimately shows as having no
 *    recorded activity. [TeamLiveUiState.noActivityVisible] exists so the screen can
 *    SAY that, instead of the board reading as "the whole team is idle".
 *
 * 3. The role tabs are DERIVED from the roles the loaded people actually hold. The
 *    old fixed Technicians/Managers/Drivers taxonomy was an invention of its own - it
 *    promised three populations whether or not anybody held those roles, and hid
 *    anyone whose role fell outside them.
 */
data class TeamLiveMember(
    val id: String,
    val name: String,
    val role: String?,
    val site: String?,
    /** Null when nothing has been recorded for this person. Never defaulted to "Idle". */
    val lastEvent: String?,
    /** The asset named on the latest recorded event, when that event named one. */
    val lastEventAsset: String?,
    /** When the latest event was recorded. Null means no event, not "just now". */
    val lastEventAt: String?,
) {
    val hasActivity: Boolean get() = lastEvent != null
}

data class TeamLiveUiState(
    val members: List<TeamLiveMember> = emptyList(),
    /** Distinct roles actually present, in display order. Empty until people load. */
    val roles: List<String> = emptyList(),
    val selectedRole: String? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    /**
     * True when the activity read returned nothing at all. Paired with the RLS rule
     * above, it is why the screen can say "you can only see your own activity"
     * rather than implying a quiet workshop.
     */
    val noActivityVisible: Boolean = false,
) {
    /** People matching the selected role, or everyone when no role is selected. */
    val visibleMembers: List<TeamLiveMember>
        get() = selectedRole?.let { role -> members.filter { it.role == role } } ?: members
}

@HiltViewModel
class TeamLiveViewModel @Inject constructor(
    private val teamApi: TeamApi,
    private val workshopApi: WorkshopApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TeamLiveUiState())
    val uiState = _uiState.asStateFlow()

    init { load() }

    fun selectRole(role: String?) {
        _uiState.update { it.copy(selectedRole = role) }
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val people = runCatching { teamApi.getTeam() }
            if (people.isFailure) {
                // "We could not load it" and "there is nobody" are opposite statements.
                // The error path must never fall through to an empty list.
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
                TeamLiveMember(
                    id = id,
                    name = p.fullName?.takeIf { it.isNotBlank() }
                        ?: p.username?.takeIf { it.isNotBlank() }
                        ?: "Unnamed",
                    role = p.role?.takeIf { it.isNotBlank() },
                    site = p.site?.takeIf { it.isNotBlank() },
                    lastEvent = latest?.eventType,
                    lastEventAsset = latest?.assetNo?.takeIf { it.isNotBlank() },
                    lastEventAt = latest?.at,
                )
            }

            val roles = members.mapNotNull { it.role }.distinct().sorted()

            _uiState.update {
                it.copy(
                    isLoading = false,
                    members = members,
                    roles = roles,
                    // Drop a selected role that no longer exists in the data rather
                    // than leaving the screen filtered to an empty set.
                    selectedRole = it.selectedRole?.takeIf { role -> role in roles },
                    noActivityVisible = events.isEmpty() && members.isNotEmpty(),
                )
            }
        }
    }
}

/**
 * Render a stored timestamp as date and time, with no invented precision.
 *
 * `at` arrives as an ISO string such as `2026-08-23T10:15:32.123456+00:00`. This
 * trims it to minutes and does NOT convert time zones or compute an elapsed
 * duration - the old card printed "ELAPSED: 45m" against no clock at all, and a
 * derived duration would be a second claim this screen cannot support.
 */
fun formatRecordedAt(raw: String?): String? {
    val value = raw?.trim().orEmpty()
    if (value.length < 16) return value.takeIf { it.isNotEmpty() }
    return value.substring(0, 16).replace('T', ' ')
}

/** Turn a stored event token such as `start_job` into "Start job". */
fun formatEventType(raw: String?): String? =
    raw?.takeIf { it.isNotBlank() }
        ?.replace('_', ' ')
        ?.replaceFirstChar { it.uppercase() }
