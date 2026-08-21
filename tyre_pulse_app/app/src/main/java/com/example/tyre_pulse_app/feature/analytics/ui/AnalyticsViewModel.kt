package com.example.tyre_pulse_app.feature.analytics.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.feature.analytics.data.AnalyticsRepository
import com.example.tyre_pulse_app.feature.analytics.model.MobileAnalytics
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class AnalyticsUiState {
    object Loading : AnalyticsUiState()
    data class Success(val data: MobileAnalytics) : AnalyticsUiState()
    data class Error(val message: String) : AnalyticsUiState()
}

@HiltViewModel
class AnalyticsViewModel @Inject constructor(
    private val repository: AnalyticsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<AnalyticsUiState>(AnalyticsUiState.Loading)
    val uiState: StateFlow<AnalyticsUiState> = _uiState.asStateFlow()

    private val _selectedSite = MutableStateFlow<String?>(null)
    val selectedSite: StateFlow<String?> = _selectedSite.asStateFlow()

    init {
        loadAnalytics()
    }

    fun setSiteFilter(site: String?) {
        _selectedSite.value = site
        loadAnalytics(site = site)
    }

    fun loadAnalytics(site: String? = _selectedSite.value) {
        viewModelScope.launch {
            repository.getMobileAnalytics(site = site)
                .onStart { _uiState.value = AnalyticsUiState.Loading }
                .catch { e -> _uiState.value = AnalyticsUiState.Error(e.message ?: "Unknown error") }
                .collect { data -> _uiState.value = AnalyticsUiState.Success(data) }
        }
    }
}
