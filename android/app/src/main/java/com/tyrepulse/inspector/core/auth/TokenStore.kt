package com.tyrepulse.inspector.core.auth

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.authDataStore by preferencesDataStore(name = "tp_auth")

/**
 * Persists the Supabase session tokens. DataStore is used for the foundation;
 * a hardening pass should wrap the values with EncryptedSharedPreferences / a
 * keystore-backed cipher before storing long-lived refresh tokens.
 */
class TokenStore(private val context: Context) {

    private object Keys {
        val ACCESS = stringPreferencesKey("access_token")
        val REFRESH = stringPreferencesKey("refresh_token")
    }

    val isSignedIn = context.authDataStore.data.map { it[Keys.ACCESS]?.isNotBlank() == true }

    suspend fun accessToken(): String? =
        context.authDataStore.data.map { it[Keys.ACCESS] }.first()

    suspend fun refreshToken(): String? =
        context.authDataStore.data.map { it[Keys.REFRESH] }.first()

    suspend fun save(access: String, refresh: String) {
        context.authDataStore.edit {
            it[Keys.ACCESS] = access
            it[Keys.REFRESH] = refresh
        }
    }

    suspend fun clear() {
        context.authDataStore.edit { it.clear() }
    }
}
