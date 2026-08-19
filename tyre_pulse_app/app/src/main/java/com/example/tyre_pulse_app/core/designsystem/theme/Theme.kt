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
    primary = Night_Primary,
    onPrimary = Color.Black,
    secondary = Night_Secondary,
    onSecondary = Color.Black,
    background = Night_Canvas,
    surface = Night_Surface,
    surfaceVariant = Color(0xFF21262D),
    onSurface = Night_TextPrimary,
    onBackground = Night_TextPrimary,
    outline = Night_TextSecondary,
    error = Night_Danger
)

private val LightColorScheme = lightColorScheme(
    primary = Day_Primary,
    onPrimary = Color.White,
    secondary = Day_Secondary,
    onSecondary = Color.White,
    background = Day_Canvas,
    surface = Day_Surface,
    surfaceVariant = Color(0xFFF1F5F9),
    onSurface = Day_TextPrimary,
    onBackground = Day_TextPrimary,
    outline = Day_TextSecondary,
    error = Day_Danger
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
