package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.Task
import com.example.tyre_pulse_app.core.model.TaskStatus
import com.example.tyre_pulse_app.core.network.api.TaskApi
import com.example.tyre_pulse_app.core.network.dto.TaskDto
import com.example.tyre_pulse_app.core.network.dto.taskStatusToColumn
import com.example.tyre_pulse_app.core.network.dto.toDomain
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Tasks, read from public.corrective_actions.
 *
 * This repository used to call `tasks`, `tasks/{id}` and `tasks/{id}/status`. None
 * of those exist - see [TaskDto] for which tables were measured and why
 * corrective_actions is the one in use.
 */
@Singleton
class TaskRepository @Inject constructor(
    private val taskApi: TaskApi
) {

    /**
     * Tasks as a stream, for screens that collect it.
     *
     * This deliberately lets a failure PROPAGATE. The collector already has a
     * `.catch` that puts the message on screen; swallowing the error here and
     * emitting an empty list would render a network failure as "no tasks assigned",
     * and "nothing to do" and "we could not check" are opposite statements.
     *
     * Filtering happens SERVER-side, as PostgREST filter strings.
     *
     * @param assignedTo a person's NAME. The column holds names, not user ids
     *        - passing a uuid here matches nothing and looks like an empty queue.
     * @param status null means every status; a value narrows to exactly it.
     * @param openOnly when true and [status] is null, narrows to the non-terminal
     *        statuses instead of returning closed work as well.
     */
    fun getTasks(
        assignedTo: String? = null,
        status: TaskStatus? = null,
        openOnly: Boolean = false,
        site: String? = null,
        limit: Int = PAGE_SIZE,
    ): Flow<List<Task>> = flow {
        emit(fetchTasks(assignedTo, status, openOnly, site, limit))
    }

    /**
     * The same read as [getTasks], but as a [Result] for callers that need to tell
     * a failure from an empty queue.
     */
    suspend fun getTasksResult(
        assignedTo: String? = null,
        status: TaskStatus? = null,
        openOnly: Boolean = false,
        site: String? = null,
        limit: Int = PAGE_SIZE,
    ): Result<List<Task>> = runCatching { fetchTasks(assignedTo, status, openOnly, site, limit) }

    private suspend fun fetchTasks(
        assignedTo: String?,
        status: TaskStatus?,
        openOnly: Boolean,
        site: String?,
        limit: Int,
    ): List<Task> = taskApi.getTasks(
        // `assigned_to` is free text holding a person's name, so an exact match is
        // the only defensible filter - a partial match would attach one person's
        // work to another whose name contains theirs.
        assignedTo = assignedTo?.takeIf { it.isNotBlank() }?.let { "eq.$it" },
        status = when {
            status != null -> "eq.${taskStatusToColumn(status)}"
            openOnly -> TaskDto.OPEN_STATUS_FILTER
            else -> null
        },
        site = site?.takeIf { it.isNotBlank() }?.let { "eq.$it" },
        limit = limit,
    ).map(TaskDto::toDomain)

    /**
     * One task.
     *
     * Throws when the id matches no row. A missing task is an error, not an empty
     * screen: the caller navigated to a specific id, so silently rendering a blank
     * task would hide a broken link.
     */
    suspend fun getTask(id: String): Task =
        taskApi.getTask(id = "eq.$id")
            .firstOrNull()
            ?.toDomain()
            ?: throw NoSuchElementException("No task with id $id")

    /**
     * Move a task to a new status.
     *
     * Writes the vocabulary the column already holds ("Open" / "Closed") rather than
     * the enum name, so a task this app closes looks identical to one closed by the
     * Expo app or the web, and every other reader's "is it closed" test keeps
     * working.
     *
     * Closing also stamps `resolved_at` and `closed_at`, which is what the Expo app
     * does (`status: 'Closed', resolved_at: now()`). Reopening CLEARS them, because
     * a task that is open again did not stay resolved - leaving the timestamp would
     * report a resolution that has been undone.
     *
     * Returns the row the database actually stored, not the one we hoped it stored.
     */
    suspend fun updateTaskStatus(id: String, status: TaskStatus): Task {
        val patch = buildStatusPatch(status)
        return taskApi.patchTask(id = "eq.$id", patch = patch)
            .firstOrNull()
            ?.toDomain()
            ?: throw NoSuchElementException("Task $id was not updated - no such row, or it is not visible to this user")
    }

    private fun buildStatusPatch(status: TaskStatus): JsonObject {
        val terminal = status == TaskStatus.COMPLETED || status == TaskStatus.CANCELLED
        val now = Instant.now().toString()
        val body = buildMap<String, JsonElement> {
            put("status", JsonPrimitive(taskStatusToColumn(status)))
            if (terminal) {
                put("resolved_at", JsonPrimitive(now))
                put("closed_at", JsonPrimitive(now))
            } else {
                // Explicit nulls here are intentional, and are the one place a null
                // belongs in a patch: reopening a task must ERASE the resolution
                // stamps, or the row reports a resolution that has been undone.
                put("resolved_at", JsonNull)
                put("closed_at", JsonNull)
            }
        }
        return JsonObject(body)
    }

    private companion object {
        const val PAGE_SIZE = 50
    }
}
