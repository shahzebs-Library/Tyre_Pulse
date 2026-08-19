package com.example.tyre_pulse_app.feature.accidents.logic

import com.example.tyre_pulse_app.core.model.Accident
import com.example.tyre_pulse_app.core.model.AccidentStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccidentCaseEngineTest {

    @Test
    fun testBuildCaseRouteStandard() {
        val record = AccidentRecord(
            fields = mapOf(
                "severity" to "major",
                "third_party_involved" to true,
                "insurer" to ""
            )
        )
        val route = AccidentCaseEngine.buildCaseRoute(record)
        assertEquals("standard", route.key)
    }

    @Test
    fun testBuildCaseRouteMinorNoInsurance() {
        val record = AccidentRecord(
            fields = mapOf(
                "severity" to "minor",
                "third_party_involved" to false,
                "insurance_involved" to false
            )
        )
        val route = AccidentCaseEngine.buildCaseRoute(record)
        assertEquals("minor_no_insurance", route.key)
    }

    @Test
    fun testBuildCaseRouteInjury() {
        val record = AccidentRecord(
            fields = mapOf(
                "injuries" to true,
                "injury_count" to 2.0
            )
        )
        val route = AccidentCaseEngine.buildCaseRoute(record)
        assertEquals("injury", route.key)
    }

    @Test
    fun testCompletenessCalculation() {
        val route = AccidentCaseEngine.CASE_ROUTES["minor_no_insurance"]!!
        val record = AccidentRecord(
            fields = mapOf(
                "photos" to "file:///photo.jpg",
                "submitted" to true,
                "severity" to "minor"
            )
        )

        // For minor_no_insurance, standard workstreams are required
        val rows = listOf(
            WorkstreamRow("incident_evidence", "incident_evidence", "completed"),
            WorkstreamRow("fleet_validation", "fleet_validation", "completed")
        )

        val completeness = AccidentCaseEngine.completeness(record, rows, route)
        
        // Incident segment should be partially/fully complete
        assertTrue(completeness.incident != null)
        assertTrue(completeness.overall!! > 0)
    }

    @Test
    fun testMarkedNAValidation() {
        val rows = listOf(
            WorkstreamRow(
                key = "insurance",
                workstream = "insurance",
                status = "cancelled",
                naReason = "No third party",
                naBy = "Manager A",
                naAt = "2025-08-19",
                naApprovedBy = "Director B"
            )
        )
        
        val record = AccidentRecord(emptyMap())
        val isNaApproved = AccidentCaseEngine.markedNA(record, rows, "insurance", requireApproval = true)
        assertTrue(isNaApproved)

        val notApprovedRows = listOf(
            WorkstreamRow(
                key = "insurance",
                workstream = "insurance",
                status = "cancelled",
                naReason = "No third party",
                naBy = "Manager A",
                naAt = "2025-08-19",
                naApprovedBy = null // Missing approval
            )
        )
        val isNaMissingApproval = AccidentCaseEngine.markedNA(record, notApprovedRows, "insurance", requireApproval = true)
        assertFalse(isNaMissingApproval)
    }
}
