package com.example.tyre_pulse_app.core.designsystem.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = YellowPrimary,
    onPrimary = TextOnYellow,
    secondary = YellowVariant,
    background = OLED_Black,
    surface = OLED_Black,
    surfaceVariant = OLED_Card,
    onSurface = TextPrimary,
    onBackground = TextPrimary,
    outline = TextSecondary,
    error = StatusRed
)

private val LightColorScheme = lightColorScheme(
    primary = YellowPrimary,
    onPrimary = Color.Black,
    secondary = YellowVariant,
    background = Color(0xFFF8F9FA),
    surface = Color.White,
    surfaceVariant = Color(0xFFF1F3F4),
    onSurface = Color(0xFF1F2937),
    onBackground = Color(0xFF1F2937),
    outline = Color(0xFF9CA3AF),
    error = Color(0xFFDC2626)
)

@Composable
fun Tyre_pulse_appTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    val view = LocalView.current
    
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            window.navigationBarColor = colorScheme.background.toArgb()
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !darkTheme
            controller.isAppearanceLightNavigationBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
