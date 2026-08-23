package com.example.tyre_pulse_app.core.authentication

import android.content.SharedPreferences
import com.example.tyre_pulse_app.core.network.di.NetworkConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TokenManager @Inject constructor(
    private val prefs: SharedPreferences
) {
    companion object {
        private const val ACCESS_TOKEN = "access_token"
        private const val REFRESH_TOKEN = "refresh_token"
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }

    /** No interceptors on purpose - see [refreshToken]. */
    private val refreshClient = OkHttpClient()

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

    /**
     * Swap the stored refresh token for a fresh access token.
     *
     * WHY THIS IS A BARE OkHttpClient AND NOT THE INJECTED AuthApi. The shared
     * Retrofit/OkHttp stack carries [AuthInterceptor], and that interceptor calls
     * THIS method whenever it sees a 401 - so refreshing through it would recurse.
     * Injecting AuthApi here instead would close a Hilt dependency cycle
     * (AuthApi -> OkHttp -> AuthInterceptor -> TokenManager -> AuthApi) and fail
     * the build. A dedicated client with no interceptors avoids both.
     *
     * Returns null on any failure, which is what [AuthInterceptor] reads as
     * "this session is over" before clearing the tokens.
     */
    suspend fun refreshToken(): String? {
        val refresh = prefs.getString(REFRESH_TOKEN, null) ?: return null

        return withContext(Dispatchers.IO) {
            try {
                val payload = JSONObject().put("refresh_token", refresh).toString()
                val request = Request.Builder()
                    .url(NetworkConfig.SUPABASE_URL + "auth/v1/token?grant_type=refresh_token")
                    .header("apikey", NetworkConfig.SUPABASE_ANON_KEY)
                    .post(payload.toRequestBody(JSON_MEDIA_TYPE))
                    .build()

                val response = refreshClient.newCall(request).execute()
                val bodyText = response.use { it.body?.string() }

                if (!response.isSuccessful || bodyText.isNullOrEmpty()) {
                    null
                } else {
                    val json = JSONObject(bodyText)
                    val access = json.optString("access_token")
                    if (access.isEmpty()) {
                        null
                    } else {
                        // Supabase rotates the refresh token on every exchange. Storing
                        // the old one back would make the NEXT refresh fail, so the
                        // session would still die - just one hour later.
                        val rotated = json.optString("refresh_token").ifEmpty { refresh }
                        saveTokens(access, rotated)
                        access
                    }
                }
            } catch (e: Exception) {
                null
            }
        }
    }
}
