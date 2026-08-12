package com.example.tyre_pulse_app.core.authentication

import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TokenManager @Inject constructor(
    private val prefs: SharedPreferences
) {
    companion object {
        private const val ACCESS_TOKEN = "access_token"
        private const val REFRESH_TOKEN = "refresh_token"
    }

    private val _accessToken = MutableStateFlow(prefs.getString(ACCESS_TOKEN, null))
    val accessToken: StateFlow<String?> = _accessToken

    fun saveTokens(access: String, refresh: String) {
        prefs.edit().apply {
            putString(ACCESS_TOKEN, access)
            putString(REFRESH_TOKEN, refresh)
            apply()
        }
        _accessToken.value = access
    }

    fun clearTokens() {
        prefs.edit().apply {
            remove(ACCESS_TOKEN)
            remove(REFRESH_TOKEN)
            apply()
        }
        _accessToken.value = null
    }

    suspend fun refreshToken(): String? {
        val refresh = prefs.getString(REFRESH_TOKEN, null) ?: return null
        
        // Agent 37: Supabase Silent Refresh Logic
        // In production, this calls the Supabase Auth API to swap the refresh token
        // for a new access token without user interaction.
        return try {
            // val response = authApi.refresh(refresh)
            // saveTokens(response.access, response.refresh)
            // response.access
            null // Placeholder for real implementation
        } catch (e: Exception) {
            null
        }
    }
}
