package com.tyrepulse.inspector.core.network

import com.tyrepulse.inspector.core.auth.TokenStore
import com.tyrepulse.inspector.core.config.AppConfig
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import kotlinx.serialization.serializer
import java.util.UUID

/**
 * Typed client for the TyrePulse Go API (/api/v1). Attaches the current
 * Supabase access token as a Bearer credential and speaks the {data,error,meta}
 * envelope. As mobile modules are cut over (ADR 0004), their write commands are
 * posted here with an Idempotency-Key.
 */
class ApiClient(
    private val http: HttpClient,
    private val tokenStore: TokenStore,
) {
    private fun requireBaseUrl(): String {
        if (!AppConfig.isApiConfigured) {
            throw ApiException("not_configured", "API base URL is not set for this build.")
        }
        return AppConfig.apiBaseUrl
    }

    /** GET /api/v1/me — the authenticated user's authoritative profile. */
    suspend fun me(): Profile {
        val token = tokenStore.accessToken()
            ?: throw ApiException("unauthorized", "Not signed in.", status = 401)
        val res = http.get("${requireBaseUrl()}/api/v1/me") {
            header(HttpHeaders.Authorization, "Bearer $token")
            header("X-Request-Id", UUID.randomUUID().toString())
        }
        return decode<Profile>(res)
    }

    /** Decode an envelope, mapping non-2xx and error bodies to ApiException. */
    private suspend inline fun <reified T> decode(res: HttpResponse): T {
        val requestId = res.headers["X-Request-Id"]
        val text = res.bodyAsText()
        val env = runCatching {
            HttpClientFactory.json.decodeFromString(
                Envelope.serializer(serializer<T>()), text,
            )
        }.getOrNull()

        if (!res.status.isSuccess()) {
            val code = env?.error?.code ?: statusToCode(res.status.value)
            val msg = env?.error?.message ?: res.status.description
            throw ApiException(code, msg, res.status.value, requestId)
        }
        return env?.data
            ?: throw ApiException("internal_error", "Empty response body.", res.status.value, requestId)
    }

    private fun statusToCode(status: Int): String = when (status) {
        400 -> "bad_request"
        401 -> "unauthorized"
        403 -> "forbidden"
        404 -> "not_found"
        409 -> "conflict"
        429 -> "rate_limited"
        503 -> "service_unavailable"
        else -> "internal_error"
    }
}
