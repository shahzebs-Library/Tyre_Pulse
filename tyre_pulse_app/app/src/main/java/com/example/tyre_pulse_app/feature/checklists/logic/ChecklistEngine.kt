package com.example.tyre_pulse_app.feature.checklists.logic

import com.example.tyre_pulse_app.core.model.ChecklistField
import com.example.tyre_pulse_app.core.model.ChecklistTemplate

object ChecklistEngine {

    fun isFieldVisible(field: ChecklistField, answers: Map<String, String>): Boolean {
        val condition = field.visibleWhen ?: return true
        val actual = answers[condition.fieldId] ?: ""
        
        return when (condition.operator) {
            "=", "eq" -> actual.lowercase() == condition.value.lowercase()
            "!=", "neq" -> actual.lowercase() != condition.value.lowercase()
            ">" -> (actual.toDoubleOrNull() ?: 0.0) > (condition.value.toDoubleOrNull() ?: 0.0)
            "<" -> (actual.toDoubleOrNull() ?: 0.0) < (condition.value.toDoubleOrNull() ?: 0.0)
            "empty" -> actual.isBlank()
            "not_empty" -> actual.isNotBlank()
            else -> true
        }
    }

    fun calculateScore(template: ChecklistTemplate, answers: Map<String, String>): Int {
        var earned = 0
        var possible = 0
        
        template.fields.forEach { field ->
            if (field.type == "boolean" && isFieldVisible(field, answers)) {
                possible += 1
                if (answers[field.id] == "true") earned += 1
            }
        }
        
        return if (possible > 0) (earned * 100) / possible else 100
    }

    fun getSummaryText(field: ChecklistField, value: String?): String {
        if (value.isNullOrBlank()) return "Tap to record"
        return when (field.type) {
            "boolean" -> if (value == "true") "PASS" else "FAIL"
            "number" -> value
            "select" -> value
            else -> "Recorded"
        }
    }
}
