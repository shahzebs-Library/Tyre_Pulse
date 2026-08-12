package com.example.tyre_pulse_app.core.network.model.response

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LoginResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    val user: SupabaseUserResponse
)

@Serializable
data class SupabaseUserResponse(
    val id: String,
    val email: String? = null
)

@Serializable
data class UserResponse(
    val id: String,
    @SerialName("full_name") val name: String,
    val email: String? = null,
    val role: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    @SerialName("org_id") val orgId: String? = null
)
