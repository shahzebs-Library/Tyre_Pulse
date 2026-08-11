package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
data class ChecklistTemplate(
    val id: String,
    val name: String,
    val description: String? = null,
    val category: String? = null,
    val fields: List<ChecklistField>,
    val requireSignature: Boolean = false,
    val requireApproval: Boolean = false
)

@Serializable
data class ChecklistField(
    val id: String,
    val type: String, // "text", "number", "select", "boolean", "photo", "signature", "section"
    val label: String,
    val help: String? = null,
    val section: String? = null,
    val required: Boolean = false,
    val options: List<String>? = null,
    val min: Float? = null,
    val max: Float? = null
)

@Serializable
data class ChecklistSubmission(
    val id: String? = null,
    val templateId: String,
    val assetNo: String? = null,
    val answers: Map<String, JsonElement>, // fieldId -> value
    val photos: Map<String, List<String>> = emptyMap(), // fieldId -> photoUrls
    val signatureData: String? = null,
    val status: String = "submitted"
)
