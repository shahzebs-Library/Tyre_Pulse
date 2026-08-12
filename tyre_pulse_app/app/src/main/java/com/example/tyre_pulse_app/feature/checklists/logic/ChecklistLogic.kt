package com.example.tyre_pulse_app.feature.checklists.logic

import com.example.tyre_pulse_app.core.model.ChecklistField
import com.example.tyre_pulse_app.core.model.ChecklistTemplate

object ChecklistLogic {

    /**
     * Advanced Visibility Engine: Mirrors Expo logic but optimized for Native performance.
     * Handles complex cascading dependencies.
     */
    fun isFieldVisible(field: ChecklistField, answers: Map<String, String>): Boolean {
        val condition = field.visibleWhen ?: return true
        val targetValue = answers[condition.fieldId] ?: ""
        
        return when (condition.operator) {
            "eq" -> targetValue.lowercase() == condition.value.lowercase()
            "neq" -> targetValue.lowercase() != condition.value.lowercase()
            "gt" -> (targetValue.toDoubleOrNull() ?: 0.0) > (condition.value.toDoubleOrNull() ?: 0.0)
            "lt" -> (targetValue.toDoubleOrNull() ?: 0.0) < (condition.value.toDoubleOrNull() ?: 0.0)
            "filled" -> targetValue.isNotBlank()
            else -> true
        }
    }

    /**
     * Smart Field Status: Returns the 'Tone' (Success/Danger/Neutral) based on answer semantics.
     */
    fun getFieldTone(field: ChecklistField, value: String?): String {
        if (value.isNullOrBlank()) return "neutral"
        return when (field.type) {
            "boolean" -> if (value == "true") "pass" else "fail"
            "select" -> {
                val v = value.lowercase()
                if (v.contains("good") || v.contains("ok") || v.contains("pass")) "pass"
                else if (v.contains("defect") || v.contains("fail") || v.contains("damage")) "fail"
                else "info"
            }
            else -> "info"
        }
    }

    fun calculateProgress(template: ChecklistTemplate, answers: Map<String, String>): Pair<Int, Int> {
        val visible = template.fields.filter { isFieldVisible(it, answers) && it.type != "section" }
        val done = visible.count { answers[it.id]?.isNotBlank() == true }
        return done to visible.size
    }
}
