package com.tyrepulse.inspector.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tyrepulse.inspector.core.auth.AuthRepository
import com.tyrepulse.inspector.core.config.AppConfig
import com.tyrepulse.inspector.core.network.ApiClient
import com.tyrepulse.inspector.core.network.ApiException
import com.tyrepulse.inspector.core.network.Profile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeUiState(
    val loading: Boolean = true,
    val profile: Profile? = null,
    val error: String? = null,
    val apiConfigured: Boolean = AppConfig.isApiConfigured,
)

class HomeViewModel(
    private val api: ApiClient,
    private val auth: AuthRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init { load() }

    /** Loads the authoritative profile from the Go API (GET /api/v1/me). */
    fun load() {
        if (!AppConfig.isApiConfigured) {
            _state.update { it.copy(loading = false, apiConfigured = false) }
            return
        }
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val profile = api.me()
                _state.update { it.copy(loading = false, profile = profile) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, error = e.message) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = "Could not reach the API.") }
            }
        }
    }

    fun signOut(onDone: () -> Unit) {
        viewModelScope.launch {
            auth.signOut()
            onDone()
        }
    }
}
