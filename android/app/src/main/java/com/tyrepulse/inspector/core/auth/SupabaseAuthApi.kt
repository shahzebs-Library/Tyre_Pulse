package com.tyrepulse.inspector.core.auth

import com.tyrepulse.inspector.core.config.AppConfig
import com.tyrepulse.inspector.core.network.ApiException
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.Serializable

/**
 * Talks to Supabase Auth (GoTrue) to obtain a session in Phase A. The Go API
 * then verifies the resulting JWT. A later phase can move identity fully behind
 * the Go API; callers depend on AuthRepository, not this class.
 */
class SupabaseAuthApi(private val http: HttpClient) {

    @Serializable
    private data class PasswordGrant(val email: String, val password: String)

    @Serializable
    data class Session(
        val access_token: String = "",
        val refresh_token: String = "",
        val token_type: String = "",
        val expires_in: Long = 0,
    )

    @Serializable
    private data class GoTrueError(
        val error: String? = null,
        val error_description: String? = null,
        val msg: String? = null,
    )

    /** Exchange email + password for a Supabase session. */
    suspend fun signInWithPassword(email: String, password: String): Session {
        val res = http.post("${AppConfig.supabaseUrl}/auth/v1/token?grant_type=password") {
            headers {
                append("apikey", AppConfig.supabaseAnonKey)
            }
            contentType(ContentType.Application.Json)
            setBody(PasswordGrant(email.trim(), password))
        }
        if (!res.status.isSuccess()) {
            // Never surface raw provider text (avoids user enumeration); map to a
            // single generic credential error.
            throw ApiException("unauthorized", "Invalid credentials. Please try again.", res.status.value)
        }
        return res.body()
    }
}
