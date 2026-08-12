package com.example.tyre_pulse_app.feature.tasks.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.authentication.WorkspaceManager
import com.example.tyre_pulse_app.core.authentication.data.UserRepository
import com.example.tyre_pulse_app.core.data.repository.TaskRepository
import com.example.tyre_pulse_app.core.model.Task
import com.example.tyre_pulse_app.core.model.TaskStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MyWorkUiState(
    val tasks: List<Task> = emptyList(),
    val isLoading: Boolean = false,
    val selectedStatus: TaskStatus? = null,
    val error: String? = null
)

@HiltViewModel
class MyWorkViewModel @Inject constructor(
    private val taskRepository: TaskRepository,
    private val userRepository: UserRepository,
    private val workspaceManager: WorkspaceManager,
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val _status = savedStateHandle.getMutableStateFlow("status", null as TaskStatus?)
    
    private val _uiState = MutableStateFlow(MyWorkUiState())
    val uiState: StateFlow<MyWorkUiState> = _uiState.asStateFlow()

    init {
        combine(
            userRepository.getCurrentUser().filterNotNull(),
            _status
        ) { user, status ->
            _uiState.update { it.copy(isLoading = true, selectedStatus = status) }
            taskRepository.getTasks(assignedTo = user.id, status = status).first()
        }.onEach { tasks ->
            _uiState.update { it.copy(tasks = tasks, isLoading = false) }
        }.catch { e ->
            _uiState.update { it.copy(error = e.message, isLoading = false) }
        }.launchIn(viewModelScope)
    }

    fun onStatusSelected(status: TaskStatus?) {
        _status.value = status
    }

    private fun <T> SavedStateHandle.getMutableStateFlow(key: String, initialValue: T): MutableStateFlow<T> {
        val flow = getStateFlow(key, initialValue)
        val mutableFlow = MutableStateFlow(flow.value)
        viewModelScope.launch {
            mutableFlow.collect {
                set(key, it)
            }
        }
        return mutableFlow
    }
}
