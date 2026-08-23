package com.example.tyre_pulse_app.feature.notifications.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.NotificationRepository
import com.example.tyre_pulse_app.core.model.Notification
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class NotificationUiState(
    val notifications: List<Notification> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class NotificationViewModel @Inject constructor(
    private val notificationRepository: NotificationRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(NotificationUiState())
    val uiState: StateFlow<NotificationUiState> = _uiState.asStateFlow()

    init {
        loadNotifications()
    }

    fun loadNotifications() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            notificationRepository.getNotifications()
                // The repository lets failures propagate, so this is where a failed
                // read becomes a message. Without it the screen sat on a spinner
                // forever and an unreachable inbox was indistinguishable from an
                // empty one.
                .catch { e ->
                    _uiState.update {
                        it.copy(isLoading = false, error = e.message ?: "Notifications could not be loaded.")
                    }
                }
                .collect { notifications ->
                    _uiState.update { it.copy(notifications = notifications, isLoading = false, error = null) }
                }
        }
    }

    /**
     * Mark one notification read.
     *
     * The row is updated locally as well as reloaded: the reload is what confirms it,
     * but a failure must not leave the list showing the notification as read when the
     * write was refused - so the local flip only happens after the call returns.
     */
    fun markAsRead(id: String) {
        viewModelScope.launch {
            try {
                notificationRepository.markAsRead(id)
                _uiState.update { state ->
                    state.copy(
                        notifications = state.notifications.map {
                            if (it.id == id) it.copy(isRead = true) else it
                        },
                        error = null,
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "That notification could not be marked read.") }
            }
        }
    }

    fun markAllAsRead() {
        viewModelScope.launch {
            try {
                notificationRepository.markAllAsRead()
                _uiState.update { state ->
                    state.copy(
                        notifications = state.notifications.map { it.copy(isRead = true) },
                        error = null,
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message ?: "Notifications could not be marked read.") }
            }
        }
    }

    fun dismissError() {
        _uiState.update { it.copy(error = null) }
    }
}
