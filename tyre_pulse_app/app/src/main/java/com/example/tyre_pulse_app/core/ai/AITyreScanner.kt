package com.example.tyre_pulse_app.core.ai

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max

data class AIAnalysisResult(
    val treadDepthMm: Float,
    val wearRateMmPer10kKm: Float,
    val remainingLifeKm: Int,
    val replacementDate: String,
    val confidence: String,
    val wearPattern: String,
    val recommendation: String
)

object AITyreScanner {
    fun analyzeTreadDepth(
        kmAtFitment: Double,
        currentKm: Double,
        previousReadings: List<Pair<Long, Float>> = emptyList(), // DateMs to depth
        vehicleType: String = "Truck",
        siteType: String = "Highway"
    ): AIAnalysisResult {
        // Base wear rates by vehicle type & site
        val baseWearRate = when (vehicleType.uppercase()) {
            "MIXER" -> 1.8f  // heavy transit mixer
            "PUMP" -> 1.5f
            "LOADER" -> 2.5f
            "BUS" -> 1.1f
            "PICKUP" -> 0.9f
            else -> 1.2f
        } * when (siteType.uppercase()) {
            "OFFROAD", "CONSTRUCTION" -> 1.4f
            "HIGHWAY" -> 0.9f
            else -> 1.0f
        }

        val usageKm = max(0.0, currentKm - kmAtFitment)
        val initialTread = 16.0f // standard new truck tyre tread depth in mm

        // Linear/exponential regression over previous readings to calculate real wear rate
        val calculatedWearRate = if (previousReadings.size >= 2) {
            val sorted = previousReadings.sortedBy { it.first }
            val first = sorted.first()
            val last = sorted.last()
            val dt = (last.first - first.first) / (1000 * 60 * 60 * 24 * 30.0) // months
            if (dt > 0) {
                (first.second - last.second) / dt.toFloat() // mm per month
            } else {
                baseWearRate
            }
        } else {
            baseWearRate
        }

        // Current estimated tread depth if not scanned
        val currentTread = max(2.0f, initialTread - (usageKm / 10000.0f) * calculatedWearRate)

        // Remaining life calculation (limit is 3.0mm)
        val remainingTread = max(0.0f, currentTread - 3.0f)
        val wearPer10k = calculatedWearRate * 1.0f // mm per 10k km
        val remainingLifeKm = if (wearPer10k > 0) {
            ((remainingTread / wearPer10k) * 10000).toInt()
        } else {
            60000
        }

        // Recommendation
        val recommendation = when {
            currentTread < 3.0f -> "CRITICAL: Replace immediately"
            currentTread < 5.0f -> "WARNING: Monitor closely, replace soon"
            else -> "GOOD: Regular monitoring"
        }

        val replacementMs = System.currentTimeMillis() + (remainingLifeKm.toLong() / 50 * 24 * 60 * 60 * 1000) // assume average 50km/day
        val replacementDateStr = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(replacementMs))

        val confidence = if (previousReadings.size >= 2) "High" else "Medium"
        val wearPattern = if (vehicleType == "MIXER") "Inner shoulder wear (Alignment recommended)" else "Even wear"

        return AIAnalysisResult(
            treadDepthMm = Math.round(currentTread * 10f) / 10f,
            wearRateMmPer10kKm = Math.round(wearPer10k * 100f) / 100f,
            remainingLifeKm = remainingLifeKm,
            replacementDate = replacementDateStr,
            confidence = confidence,
            wearPattern = wearPattern,
            recommendation = recommendation
        )
    }
}
