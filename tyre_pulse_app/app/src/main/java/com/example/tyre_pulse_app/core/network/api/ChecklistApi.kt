package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.ChecklistTemplate
import retrofit2.http.GET
import retrofit2.http.Query

interface ChecklistApi {
    @GET("rest/v1/checklists")
    suspend fun getChecklistTemplates(
        @Query("select") select: String = "*"
    ): List<ChecklistTemplate>
}
