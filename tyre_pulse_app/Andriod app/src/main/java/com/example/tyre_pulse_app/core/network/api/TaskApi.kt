package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.Task
import retrofit2.http.*

interface TaskApi {
    @GET("tasks")
    suspend fun getTasks(
        @Query("assignedTo") assignedTo: String? = null,
        @Query("status") status: String? = null,
        @Query("priority") priority: String? = null,
        @Query("page") page: Int = 0,
        @Query("pageSize") pageSize: Int = 20
    ): List<Task>

    @GET("tasks/{id}")
    suspend fun getTask(@Path("id") id: String): Task

    @PATCH("tasks/{id}/status")
    suspend fun updateTaskStatus(
        @Path("id") id: String,
        @Body status: String
    ): Task
}
