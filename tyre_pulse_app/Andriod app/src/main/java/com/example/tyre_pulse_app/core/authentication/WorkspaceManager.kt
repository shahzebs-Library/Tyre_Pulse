package com.example.tyre_pulse_app.core.authentication

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.example.tyre_pulse_app.core.model.WorkspaceContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WorkspaceManager @Inject constructor(
    private val dataStore: DataStore<Preferences>,
    private val json: Json
) {
    companion object {
        private val CURRENT_WORKSPACE = stringPreferencesKey("current_workspace")
    }

    val currentWorkspace: Flow<WorkspaceContext?> = dataStore.data.map { preferences ->
        preferences[CURRENT_WORKSPACE]?.let {
            try {
                json.decodeFromString<WorkspaceContext>(it)
            } catch (e: Exception) {
                null
            }
        }
    }

    suspend fun setWorkspace(workspace: WorkspaceContext) {
        dataStore.edit { preferences ->
            preferences[CURRENT_WORKSPACE] = json.encodeToString(workspace)
        }
    }

    suspend fun clearWorkspace() {
        dataStore.edit { preferences ->
            preferences.remove(CURRENT_WORKSPACE)
        }
    }
}
