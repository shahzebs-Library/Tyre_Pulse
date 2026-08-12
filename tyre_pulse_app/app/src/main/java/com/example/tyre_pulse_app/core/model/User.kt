package com.example.tyre_pulse_app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class User(
    val id: String,
    val name: String,
    val email: String,
    val role: String? = null,
    val avatarUrl: String? = null,
    val availableWorkspaces: List<WorkspaceContext> = emptyList(),
    val permissions: Map<String, List<String>> = emptyMap() // Map of Scope (e.g. CountryID) to permissions
)
