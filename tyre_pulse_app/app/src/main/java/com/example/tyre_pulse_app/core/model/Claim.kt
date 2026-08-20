package com.example.tyre_pulse_app.core.model

data class Claim(
    val id: String = "",
    val accidentId: String = "",
    val claimAmount: Double = 0.0,
    val status: String = "", // e.g., "pending", "approved", "rejected"
    val description: String = "",
    val timestamp: Long = 0L
)
