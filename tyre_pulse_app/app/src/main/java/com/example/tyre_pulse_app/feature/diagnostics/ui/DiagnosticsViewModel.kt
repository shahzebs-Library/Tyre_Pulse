package com.example.tyre_pulse_app.feature.diagnostics.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.data.repository.AppDiagnostics
import com.example.tyre_pulse_app.core.data.repository.DiagnosticRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class DiagnosticsViewModel @Inject constructor(
    private val diagnosticRepository: DiagnosticRepository
) : ViewModel() {

    val diagnostics: StateFlow<AppDiagnostics?> = diagnosticRepository.getDiagnostics()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)
}
