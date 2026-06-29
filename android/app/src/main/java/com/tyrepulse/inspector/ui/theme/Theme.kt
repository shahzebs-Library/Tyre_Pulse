package com.tyrepulse.inspector.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// TyrePulse brand greens, matching the web/Expo apps.
val Green = Color(0xFF16A34A)
val GreenDark = Color(0xFF15803D)
val Surface = Color(0xFFF0F5F1)
val Ink = Color(0xFF0F172A)
val Muted = Color(0xFF64748B)
val Danger = Color(0xFFDC2626)

private val LightColors = lightColorScheme(
    primary = Green,
    onPrimary = Color.White,
    secondary = GreenDark,
    background = Surface,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    error = Danger,
)

private val DarkColors = darkColorScheme(
    primary = Green,
    onPrimary = Color.White,
    secondary = GreenDark,
    error = Danger,
)

@Composable
fun TyrePulseTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
