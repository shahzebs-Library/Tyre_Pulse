package com.example.tyre_pulse_app.core.network

import com.example.tyre_pulse_app.core.authentication.TokenManager
import com.example.tyre_pulse_app.core.network.di.NetworkConfig
import kotlinx.coroutines.flow.first
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
    private var isRefreshing = false

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()
        
        // Agent R1: Thread-safe token refresh and workspace injection
        synchronized(refreshLock) {
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

            val request = requestBuilder.build()
            val response = chain.proceed(request)

            if (response.code == 401 && !isRefreshing && token != null) {
                isRefreshing = true
                try {
                    val refreshedToken = runBlocking { tokenManager.refreshToken() }
                    if (refreshedToken != null) {
                        response.close()
                        val newRequest = originalRequest.newBuilder()
                            .header("Authorization", "Bearer $refreshedToken")
                            .build()
                        return chain.proceed(newRequest)
                    } else {
                        // Force clear if refresh fails completely so app logs out
                        runBlocking { tokenManager.clearTokens() }
                    }
                } finally {
                    isRefreshing = false
                }
            }
            return response
        }
    }
}
