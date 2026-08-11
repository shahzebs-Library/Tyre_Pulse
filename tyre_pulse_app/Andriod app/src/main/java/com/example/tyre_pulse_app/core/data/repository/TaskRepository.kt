package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Task
import com.example.tyre_pulse_app.core.model.TaskStatus
import com.example.tyre_pulse_app.core.network.api.TaskApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TaskRepository @Inject constructor(
    private val taskApi: TaskApi
) {
    fun getTasks(assignedTo: String? = null, status: TaskStatus? = null): Flow<List<Task>> = flow {
        val tasks = taskApi.getTasks(assignedTo = assignedTo, status = status?.name)
        emit(tasks)
    }

    suspend fun getTask(id: String): Task {
        return taskApi.getTask(id)
    }

    suspend fun updateTaskStatus(id: String, status: TaskStatus): Task {
        return taskApi.updateTaskStatus(id, status.name)
    }
}
