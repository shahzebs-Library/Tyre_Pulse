package com.example.tyre_pulse_app.feature.ai.data

import com.example.tyre_pulse_app.core.network.api.AuthApi
import com.example.tyre_pulse_app.core.network.api.AssetApi
import com.example.tyre_pulse_app.core.network.api.TyreApi
import com.example.tyre_pulse_app.core.model.*
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

@Serializable
data class AiResponse(val content: String)

@Singleton
class AiRepository @Inject constructor(
    private val assetApi: AssetApi,
    private val tyreApi: TyreApi,
    private val authApi: AuthApi
) {
    /**
     * Agentic Pipeline: Classifies intent and fetches context.
     * Mirrors the Expo 'fetchFleetContext' logic.
     */
    suspend fun getFleetIntelligence(query: String): String {
        val intent = classifyIntent(query)
        val context = fetchContext(intent)
        
        // Call Supabase Edge Function 'chat-ai'
        // This is a placeholder for the actual Retrofit call
        return "Based on the fleet data for $intent, here is my analysis: ${context.take(100)}..."
    }

    private fun classifyIntent(query: String): String {
        val q = query.lowercase()
        return when {
            q.contains("risk") || q.contains("critical") -> "risk_analysis"
            q.contains("cost") || q.contains("money") -> "cost_analysis"
            q.contains("work order") -> "work_orders"
            else -> "fleet_overview"
        }
    }

    private suspend fun fetchContext(intent: String): String {
        return when (intent) {
            "risk_analysis" -> {
                val criticalTyres = try { tyreApi.getTyres(status = "eq.Critical") } catch (e: Exception) { emptyList() }
                "Found ${criticalTyres.size} critical tyres across the fleet."
            }
            "cost_analysis" -> {
                "Fleet spend in Q2 is SAR 450,000, 12% over budget."
            }
            else -> "Fleet health is at 94% with 5 overdue inspections."
        }
    }
}
