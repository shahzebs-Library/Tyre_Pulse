package com.example.tyre_pulse_app.core.data.repository

import com.example.tyre_pulse_app.core.model.ChecklistTemplate
import com.example.tyre_pulse_app.core.network.api.ChecklistApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChecklistRepository @Inject constructor(
    private val checklistApi: ChecklistApi
) {
    suspend fun getTemplates(): Result<List<ChecklistTemplate>> {
        return try {
            val templates = checklistApi.getChecklistTemplates()
            Result.success(templates)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
