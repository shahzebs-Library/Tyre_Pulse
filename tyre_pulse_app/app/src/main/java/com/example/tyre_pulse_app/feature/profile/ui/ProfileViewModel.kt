package com.example.tyre_pulse_app.feature.profile.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.model.User
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/**
 * The signed-in user, for the profile header.
 *
 * WHAT THIS REPLACED. The header was hard-coded: every user, on every device, saw
 * "John Technician" with the initials "JT" and a green "Active - Site A" badge. A
 * fabricated identity is worse than a blank one, because there is nothing to
 * distinguish it from a real profile that failed to load.
 *
 * Null means the user is not loaded. The screen renders that as an unknown profile
 * rather than inventing a name.
 */
@HiltViewModel
class ProfileViewModel @Inject constructor(
    userRepository: UserRepository,
) : ViewModel() {

    val user: StateFlow<User?> = userRepository.getCurrentUser()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
}

/**
 * Initials for the avatar. Returns null when there is no name to derive them from -
 * the caller shows a neutral placeholder instead of inventing letters.
 */
fun initialsOf(name: String?): String? {
    val parts = name?.trim()?.split(Regex("\\s+"))?.filter { it.isNotBlank() }.orEmpty()
    if (parts.isEmpty()) return null
    return parts.take(2).joinToString("") { it.first().uppercase() }
}
