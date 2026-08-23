package com.example.tyre_pulse_app.core.network.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * The fleet copilot, backed by the deployed `chat-ai` Supabase Edge Function.
 *
 * NOT under /rest/v1/. Edge functions live at `{SUPABASE_URL}/functions/v1/{name}`,
 * so this interface is built on its own Retrofit against SUPABASE_URL - the same
 * arrangement StorageApi uses, and for the same reason.
 *
 * WHAT THIS REPLACED. The chat screen ran a local `when` block over keywords in the
 * user's text and returned hard-coded paragraphs containing invented tyre readings -
 * "Mixer 2841 - FL (tread: 1.8mm, REPLACE NOW)", an invented budget of
 * "AED 24,000-32,000", an invented "Confidence: 87%" and an invented fleet of
 * 47 vehicles. It even slept 1200ms first so the answer looked computed. A
 * maintenance manager could read REPLACE NOW against a tyre that does not exist and
 * pull a vehicle out of service on it.
 *
 * The function authenticates the caller itself, so the standard auth headers this
 * app already attaches are what authorise the call.
 */
@Serializable
data class AiMessage(
    val role: String,
    val content: String,
)

@Serializable
data class AiChatRequest(
    /** Instructions to the model. Kept short; this is billed per token. */
    val system: String,
    val messages: List<AiMessage>,
    /**
     * Sent for contract compatibility with the web client only. The edge function
     * pins the model server-side and ignores this, which is deliberate - the model
     * choice is not a client's to make.
     */
    val model: String = DEFAULT_MODEL,
    @SerialName("max_tokens") val maxTokens: Int = DEFAULT_MAX_TOKENS,
) {
    companion object {
        const val DEFAULT_MODEL = "claude-haiku-4-5-20251001"
        const val DEFAULT_MAX_TOKENS = 900
    }
}

@Serializable
data class AiChatResponse(
    val content: String? = null,
    /** Populated when the function refuses - disabled, over budget, or rate limited. */
    val error: String? = null,
)

interface AiApi {
    @POST("functions/v1/chat-ai")
    suspend fun chat(@Body request: AiChatRequest): AiChatResponse
}
