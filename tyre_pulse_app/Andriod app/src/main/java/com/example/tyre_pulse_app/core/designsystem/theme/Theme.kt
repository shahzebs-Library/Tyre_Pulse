package com.example.tyre_pulse_app.core.designsystem.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Agent 19: Pure Black for OLED Battery Savings
private val DarkColorScheme = darkColorScheme(
    primary = YellowPrimary,
    onPrimary = Color.Black,
    background = Color(0xFF000000), // OLED BLACK
    surface = Color(0xFF121212),
    onBackground = Color.White,
    onSurface = Color.White,
    error = StatusRed
)

private val LightColorScheme = lightColorScheme(
    primary = YellowPrimary,
    onPrimary = Color.Black,
    background = Color(0xFFF8F9FA),
    surface = Color.White,
    onBackground = Color.Black,
    onSurface = Color.Black,
    error = StatusRed
)

@Composable
fun Tyre_pulse_appTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme,
        typography = Typography,
        content = content
    )
}
