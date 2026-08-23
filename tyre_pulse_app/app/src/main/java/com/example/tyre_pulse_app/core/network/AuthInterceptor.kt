package com.example.tyre_pulse_app.core.network

import com.example.tyre_pulse_app.core.authentication.TokenManager
import com.example.tyre_pulse_app.core.network.di.NetworkConfig
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

import com.example.tyre_pulse_app.core.authentication.WorkspaceManager

@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenManager: TokenManager,
    private val workspaceManager: WorkspaceManager
) : Interceptor {

    private val refreshLock = Any()

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // NOTE: nothing here is synchronized. The lock below guards ONLY the token
        // refresh. Holding it across chain.proceed() - as this once did - serialises
        // every HTTP call in the app behind a single mutex, so a screen issuing
        // several parallel loads executes them one at a time.
        val token = runBlocking { tokenManager.accessToken.value }
        val currentWorkspace = runBlocking { workspaceManager.currentWorkspace.firstOrNull() }

        val requestBuilder = originalRequest.newBuilder()
            .header("apikey", NetworkConfig.SUPABASE_ANON_KEY)

        if (token != null) {
            requestBuilder.header("Authorization", "Bearer $token")
        }

        // Agent G-12: Strict Site Trespass Guard
        currentWorkspace?.let {
            requestBuilder.header("x-org-id", it.tenant.id)
            requestBuilder.header("x-site-id", it.site?.id ?: "unscoped")
        }

        val response = chain.proceed(requestBuilder.build())

        if (response.code != 401 || token == null) return response

        // One refresh at a time. Whichever call gets the lock first performs the
        // exchange; the others arrive after it and reuse whatever token is now
        // stored, rather than each firing their own refresh and invalidating one
        // another - Supabase rotates the refresh token on every exchange.
        val refreshedToken = synchronized(refreshLock) {
            val tokenNow = tokenManager.accessToken.value
            if (tokenNow != null && tokenNow != token) {
                tokenNow // someone else already refreshed while we were queued
            } else {
                runBlocking { tokenManager.refreshToken() }
            }
        }

        if (refreshedToken == null) {
            // Refresh failed for good: end the session rather than leaving the user
            // on a screen where every request silently 401s.
            runBlocking { tokenManager.clearTokens() }
            return response
        }

        response.close()
        // Retry through the SAME builder, so the apikey and the x-org-id / x-site-id
        // scope headers are carried over. Rebuilding from originalRequest would drop
        // them and send the retry unscoped.
        return chain.proceed(
            requestBuilder.header("Authorization", "Bearer $refreshedToken").build()
        )
    }
}
