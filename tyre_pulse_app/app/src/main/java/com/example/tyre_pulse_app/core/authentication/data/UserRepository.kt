package com.example.tyre_pulse_app.core.authentication.data

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.example.tyre_pulse_app.core.model.User
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserRepository @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    private val json: Json
) {
    companion object {
        private val CURRENT_USER = stringPreferencesKey("current_user")
    }

    fun getCurrentUser(): Flow<User?> {
        return dataStore.data.map { preferences ->
            preferences[CURRENT_USER]?.let {
                try {
                    json.decodeFromString<User>(it)
                } catch (e: Exception) {
                    null
                }
            }
        }
    }

    suspend fun setCurrentUser(user: User) {
        dataStore.edit { preferences ->
            preferences[CURRENT_USER] = json.encodeToString(user)
        }
    }

    suspend fun clearCurrentUser() {
        dataStore.edit { preferences ->
            preferences.remove(CURRENT_USER)
        }
    }
}
