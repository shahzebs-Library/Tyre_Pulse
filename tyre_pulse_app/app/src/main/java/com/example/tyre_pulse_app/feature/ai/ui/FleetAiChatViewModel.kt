package com.example.tyre_pulse_app.feature.ai.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.tyre_pulse_app.core.network.api.AiApi
import com.example.tyre_pulse_app.core.network.api.AiChatRequest
import com.example.tyre_pulse_app.core.network.api.AiMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import retrofit2.HttpException
import javax.inject.Inject

/**
 * The fleet copilot.
 *
 * WHAT THIS REPLACED. `generateAiResponse(input: String)` was a local `when` over
 * keywords in the user's own text. It returned fixed paragraphs presented as
 * analysis: invented tread depths with "REPLACE NOW" beside them, an invented
 * per-km cost for a named brand, an invented budget range, an invented
 * "Confidence: 87%", and an invented fleet size. Nothing was read from the
 * database. A 1200ms delay was inserted first so the answer appeared to be
 * computed.
 *
 * It now calls the deployed `chat-ai` edge function, the same backend the web app
 * uses. Three consequences that are deliberate:
 *
 * 1. A FAILURE IS SHOWN AS A FAILURE. If the call is refused - AI disabled for the
 *    organisation, monthly budget spent, rate limited, offline - the screen says so.
 *    The old code could not fail, which is exactly why it was dangerous: it always
 *    produced a confident answer.
 *
 * 2. NO FLEET DATA IS ATTACHED YET, and the system prompt says so. The model is told
 *    it has not been given fleet records and must not invent them. Sending real
 *    records is a genuine next step (the web app builds compact field-whitelisted
 *    digests for exactly this) but it is not done here, and pretending otherwise
 *    would recreate the original defect in a more convincing form.
 *
 * 3. HISTORY IS CAPPED. Every turn resends the conversation, and this is billed per
 *    token, so only the most recent exchanges travel.
 */
data class ChatUiMessage(
    val text: String,
    val isUser: Boolean,
    val timestamp: Long = System.currentTimeMillis(),
    /** Renders in the error tone. A refusal must not look like an answer. */
    val isError: Boolean = false,
)

data class FleetAiUiState(
    val messages: List<ChatUiMessage> = listOf(
        ChatUiMessage(
            "Ask me about tyres, fleet health or maintenance. " +
                "I answer from general knowledge - I am not connected to your fleet records yet, " +
                "so I will not quote your vehicles, readings or costs.",
            isUser = false,
        )
    ),
    val isSending: Boolean = false,
)

@HiltViewModel
class FleetAiChatViewModel @Inject constructor(
    private val aiApi: AiApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FleetAiUiState())
    val uiState = _uiState.asStateFlow()

    /** Back to the opening line only. The opener carries the "not connected to your
     *  fleet records" caveat, so clearing must not drop it. */
    fun clear() {
        _uiState.value = FleetAiUiState()
    }

    fun send(text: String) {
        val prompt = text.trim()
        if (prompt.isEmpty() || _uiState.value.isSending) return

        _uiState.update {
            it.copy(messages = it.messages + ChatUiMessage(prompt, isUser = true), isSending = true)
        }

        viewModelScope.launch {
            val history = _uiState.value.messages
                .filterNot { it.isError }
                .takeLast(HISTORY_TURNS)
                .map { AiMessage(role = if (it.isUser) "user" else "assistant", content = it.text) }

            val reply = runCatching {
                aiApi.chat(AiChatRequest(system = SYSTEM_PROMPT, messages = history))
            }

            val message = reply.fold(
                onSuccess = { response ->
                    val content = response.content?.trim()
                    when {
                        !response.error.isNullOrBlank() ->
                            ChatUiMessage(response.error, isUser = false, isError = true)

                        content.isNullOrEmpty() ->
                            ChatUiMessage(EMPTY_REPLY, isUser = false, isError = true)

                        else -> ChatUiMessage(content, isUser = false)
                    }
                },
                onFailure = { ChatUiMessage(readableFailure(it), isUser = false, isError = true) },
            )

            _uiState.update { it.copy(messages = it.messages + message, isSending = false) }
        }
    }

    /**
     * The edge function refuses with a sentence written to be read by an operator
     * ("AI is disabled for this organisation", "Monthly AI budget reached"), so that
     * sentence is surfaced rather than the HTTP code. Anything else degrades to one
     * plain line - a raw exception string tells a technician in a workshop nothing.
     */
    private fun readableFailure(e: Throwable): String {
        if (e is HttpException) {
            val body = runCatching { e.response()?.errorBody()?.string() }.getOrNull()
            val parsed = body?.takeIf { it.isNotBlank() }?.let { raw ->
                runCatching { JSONObject(raw).optString("error").takeIf { it.isNotBlank() } }.getOrNull()
            }
            if (parsed != null) return parsed
        }
        return GENERIC_FAILURE
    }

    private companion object {
        /**
         * The last clause is the load-bearing one. Without it a language model asked
         * "which tyres need replacing?" will happily produce a plausible list of
         * vehicles and tread depths - which is precisely the fabrication this change
         * removed, only harder to spot because it varies each time.
         */
        const val SYSTEM_PROMPT =
            "You are a fleet and tyre maintenance assistant inside the Tyre Pulse app. " +
                "Answer briefly and practically for a workshop technician. " +
                "You have NOT been given this fleet's records. Never invent vehicle numbers, " +
                "tyre serials, tread depths, costs, budgets or counts. If a question needs data " +
                "you were not given, say what you would need and where in the app to find it."

        const val EMPTY_REPLY = "The assistant returned an empty answer. Please try again."
        const val GENERIC_FAILURE =
            "The assistant could not be reached. Check your connection and try again."

        /** Conversation turns resent per request. Every one of these is billed. */
        const val HISTORY_TURNS = 10
    }
}
