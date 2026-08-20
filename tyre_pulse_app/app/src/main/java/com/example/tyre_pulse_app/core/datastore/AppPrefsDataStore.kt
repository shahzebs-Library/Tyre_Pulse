package com.example.tyre_pulse_app.core.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.appPrefs: DataStore<Preferences> by preferencesDataStore(name = "app_prefs")

enum class AppLanguage(val code: String, val displayName: String, val nativeName: String, val isRtl: Boolean) {
    ENGLISH("en", "English", "English", false),
    ARABIC("ar", "Arabic", "العربية", true),
    FRENCH("fr", "French", "Français", false),
    URDU("ur", "Urdu", "اردو", true)
}

@Singleton
class AppPrefsDataStore @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private val KEY_LANGUAGE = stringPreferencesKey("app_language")
    }

    val languageCode: Flow<String> = context.appPrefs.data.map { prefs ->
        prefs[KEY_LANGUAGE] ?: AppLanguage.ENGLISH.code
    }

    suspend fun setLanguage(code: String) {
        context.appPrefs.edit { prefs ->
            prefs[KEY_LANGUAGE] = code
        }
    }
}
