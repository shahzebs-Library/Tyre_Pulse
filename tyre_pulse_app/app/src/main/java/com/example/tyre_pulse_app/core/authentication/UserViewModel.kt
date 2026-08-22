package com.example.tyre_pulse_app.core.authentication

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.data.AuthRepository
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.model.User
import com.example.tyre_pulse_app.core.model.WorkspaceContext
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class UserViewModel @Inject constructor(
    private val userRepository: UserRepository,
    private val workspaceManager: WorkspaceManager,
    private val authRepository: AuthRepository
) : ViewModel() {

    val currentUser: StateFlow<User?> = userRepository.getCurrentUser()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    val currentWorkspace: StateFlow<WorkspaceContext?> = workspaceManager.currentWorkspace
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    fun selectWorkspace(workspace: WorkspaceContext) {
        viewModelScope.launch {
            workspaceManager.setWorkspace(workspace)
            // Here we would also trigger a global refresh of other repositories
        }
    }

    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
        }
    }
}
