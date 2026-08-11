package com.example.tyre_pulse_app.core.designsystem.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

// Agent 41: Ultra-High Contrast for 100% Sunlight Glare
val SunlightColorScheme = lightColorScheme(
    primary = Color(0xFF000000), // Deep Black for text/icons
    onPrimary = Color(0xFFFFFFFF),
    background = Color(0xFFFFFFFF), // Pure White Background
    surface = Color(0xFFEEEEEE),
    onSurface = Color(0xFF000000),
    error = Color(0xFFFF0000), // Pure Red
    secondary = Color(0xFF0055FF) // High-Saturation Blue
)
