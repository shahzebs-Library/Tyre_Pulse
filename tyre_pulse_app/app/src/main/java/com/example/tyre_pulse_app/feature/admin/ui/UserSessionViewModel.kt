package com.example.tyre_pulse_app.feature.admin.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.network.api.TeamApi
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The user roster behind the admin sessions screen.
 *
 * WHAT THIS REPLACED. The screen listed three invented people with invented session
 * states - "John Technician / Active", "Ahmed Supervisor / Active", "Mike Ross /
 * Offline" - beside a "Kick" button that ended nothing. An administrator could read
 * that board, believe two staff were signed in, press Kick, and be told "Kicked Mike
 * Ross" by a snackbar while no session anywhere was touched.
 *
 * The roster is now real, read from `profiles`.
 *
 * WHAT IS DELIBERATELY STILL MISSING, AND WHY IT IS NOT FILLED IN. Nothing in this
 * app can see live sessions. There is no session table among the twenty-one API
 * interfaces in `core/network/api`, and `profiles` carries no last-seen or
 * signed-in column. So this model exposes NO session status at all rather than
 * deriving a plausible one: an administrator acting on "Active" needs it to be a
 * fact, and a guess dressed as a fact is the exact failure this replaced.
 *
 * By the same rule there is no kick action here. Restoring one needs a real
 * session-revocation endpoint, not a local button.
 */
data class AdminUser(
    val id: String,
    val name: String,
    val role: String?,
    val site: String?,
)

data class UserSessionUiState(
    val users: List<AdminUser> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class UserSessionViewModel @Inject constructor(
    private val teamApi: TeamApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(UserSessionUiState())
    val uiState = _uiState.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = runCatching { teamApi.getTeam() }
            result.fold(
                onSuccess = { rows ->
                    val users = rows.mapNotNull { p ->
                        val id = p.id ?: return@mapNotNull null
                        AdminUser(
                            id = id,
                            name = p.fullName?.takeIf { it.isNotBlank() }
                                ?: p.username?.takeIf { it.isNotBlank() }
                                ?: "Unnamed",
                            role = p.role?.takeIf { it.isNotBlank() },
                            site = p.site?.takeIf { it.isNotBlank() },
                        )
                    }
                    _uiState.update { it.copy(isLoading = false, users = users) }
                },
                onFailure = { e ->
                    // A failed read must never render as an empty roster: "nobody is
                    // signed in" and "we could not look" are opposite statements.
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = e.message ?: "Could not load users",
                        )
                    }
                },
            )
        }
    }
}
