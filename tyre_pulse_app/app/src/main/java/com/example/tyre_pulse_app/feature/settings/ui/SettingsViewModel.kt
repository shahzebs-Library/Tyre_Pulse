package com.example.tyre_pulse_app.feature.settings.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.datastore.AppPrefsDataStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val appPrefsDataStore: AppPrefsDataStore
) : ViewModel() {

    val themeMode: StateFlow<String> = appPrefsDataStore.themeMode
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), "system")

    val languageCode: StateFlow<String> = appPrefsDataStore.languageCode
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), "en")

    fun setThemeMode(mode: String) {
        viewModelScope.launch {
            appPrefsDataStore.setThemeMode(mode)
        }
    }

    fun setLanguage(code: String) {
        viewModelScope.launch {
            appPrefsDataStore.setLanguage(code)
        }
    }
}
