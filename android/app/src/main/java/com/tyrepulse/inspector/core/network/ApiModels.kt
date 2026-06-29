package com.tyrepulse.inspector.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The TyrePulse Go API response envelope: { data, error, meta }.
 * Mirrors backend/internal/platform/httpserver/response.go.
 */
@Serializable
data class Envelope<T>(
    val data: T? = null,
    val error: ApiErrorBody? = null,
    val meta: kotlinx.serialization.json.JsonElement? = null,
)

@Serializable
data class ApiErrorBody(
    val code: String,
    val message: String,
)

/** Authoritative profile returned by GET /api/v1/me. */
@Serializable
data class Profile(
    val id: String,
    val email: String? = null,
    @SerialName("full_name") val fullName: String? = null,
    val username: String? = null,
    val role: String,
    val site: String? = null,
    val country: List<String>? = null,
    val approved: Boolean = false,
    val locked: Boolean = false,
)

/** Structured client-side error with a stable code, thrown by ApiClient. */
class ApiException(
    val code: String,
    override val message: String,
    val status: Int = 0,
    val requestId: String? = null,
) : Exception(message)
