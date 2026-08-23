package com.example.tyre_pulse_app.core.network.api

import com.example.tyre_pulse_app.core.model.ChecklistTemplate
import retrofit2.http.GET
import retrofit2.http.Query

interface ChecklistApi {
    // Base URL already ends in /rest/v1/, so the path must NOT repeat it - it did, and
    // every request went to /rest/v1/rest/v1/checklists. The table is also
    // checklist_templates; there is no "checklists" table in this database.
    @GET("checklist_templates")
    suspend fun getChecklistTemplates(
        @Query("select") select: String = "*"
    ): List<ChecklistTemplate>
}
