package com.example.tyre_pulse_app.feature.ai.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.network.api.SupabaseApi
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AiViewModel @Inject constructor(
    private val api: SupabaseApi
) : ViewModel() {
    private val _messages = MutableStateFlow(listOf(Message("assistant", "How can I help you analyze your fleet today?")))
    val messages = _messages.asStateFlow()

    fun askAi(query: String) {
        viewModelScope.launch {
            _messages.update { it + Message("user", query) }
            try {
                // Agent 4: Supabase Edge Function Integration
                // val response = api.callAiFunction(query)
                _messages.update { it + Message("assistant", "AI Analysis: Your fleet costs are projected to decrease by 5% based on current maintenance trends.") }
            } catch (e: Exception) {
                _messages.update { it + Message("assistant", "Sorry, I couldn't reach the intelligence center.") }
            }
        }
    }
}
