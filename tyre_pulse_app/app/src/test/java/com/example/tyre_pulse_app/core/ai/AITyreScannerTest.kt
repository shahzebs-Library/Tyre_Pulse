package com.example.tyre_pulse_app.core.ai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AITyreScannerTest {

    @Test
    fun testBaseWearRateFallback() {
        // Test when there are no previous readings, it uses the base wear rate (e.g. MIXER on offroad site is higher)
        val result = AITyreScanner.analyzeTreadDepth(
            kmAtFitment = 0.0,
            currentKm = 20000.0,
            previousReadings = emptyList(),
            vehicleType = "MIXER",
            siteType = "OFFROAD"
        )

        // Standard new truck tyre starts at 16.0mm
        // Under high wear (MIXER + offroad = 1.8 * 1.4 = 2.52 mm per 10k km)
        // For 20,000 km, usage should be 20000 / 10000 * 2.52 = 5.04 mm wear
        // Expected tread depth = 16.0 - 5.04 = 10.96mm -> round to 11.0mm
        assertEquals(11.0f, result.treadDepthMm, 0.1f)
        assertTrue(result.remainingLifeKm > 0)
        assertEquals("Medium", result.confidence)
    }

    @Test
    fun testRegressionCalculatedWearRate() {
        // Test when there are multiple readings, it computes the regression wear rate
        val oneMonthAgo = System.currentTimeMillis() - (1000L * 60 * 60 * 24 * 30)
        val now = System.currentTimeMillis()

        val readings = listOf(
            Pair(oneMonthAgo, 14.0f),
            Pair(now, 12.5f) // 1.5mm wear in 1 month
        )

        val result = AITyreScanner.analyzeTreadDepth(
            kmAtFitment = 10000.0,
            currentKm = 15000.0,
            previousReadings = readings,
            vehicleType = "TRUCK",
            siteType = "HIGHWAY"
        )

        // Confidence should be high since we have multiple readings
        assertEquals("High", result.confidence)
        // Wear rate per month = 1.5mm, so wear rate per 10k km should be derived accordingly
        assertTrue(result.wearRateMmPer10kKm > 0f)
    }

    @Test
    fun testCriticalTreadDepthRecommendation() {
        val result = AITyreScanner.analyzeTreadDepth(
            kmAtFitment = 0.0,
            currentKm = 60000.0,
            previousReadings = emptyList(),
            vehicleType = "MIXER",
            siteType = "CONSTRUCTION"
        )

        // Tread depth should be very low, check that critical replacement recommendation triggers
        assertTrue(result.treadDepthMm <= 4.0f)
        assertTrue(result.recommendation.contains("CRITICAL") || result.recommendation.contains("WARNING"))
    }
}
