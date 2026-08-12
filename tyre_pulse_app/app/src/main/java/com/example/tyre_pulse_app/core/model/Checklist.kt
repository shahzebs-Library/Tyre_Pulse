package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class ChecklistTemplate(
    val id: String,
    val name: String,
    val category: String? = null,
    val description: String? = null,
    val fields: List<ChecklistField> = emptyList(),
    val scored: Boolean = false,
    val pass_threshold: Int? = null,
    val require_signature: Boolean = false
)

@Serializable
data class ChecklistField(
    val id: String,
    val label: String,
    val type: String, // "boolean", "select", "number", "photo", "signature", "section"
    val required: Boolean = false,
    val help: String? = null,
    val options: List<String>? = null,
    val visibleWhen: VisibilityCondition? = null
)

@Serializable
data class VisibilityCondition(
    val fieldId: String,
    val operator: String, // "eq", "neq", "gt"
    val value: String
)

@Serializable
data class ChecklistSubmission(
    val templateId: String,
    val assetNumber: String? = null,
    val site: String? = null,
    val answers: Map<String, String>,
    val photos: Map<String, List<String>>,
    val signatureData: String? = null,
    val printedName: String? = null,
    val scorePct: Int? = null,
    val scorePassed: Boolean? = null
)
