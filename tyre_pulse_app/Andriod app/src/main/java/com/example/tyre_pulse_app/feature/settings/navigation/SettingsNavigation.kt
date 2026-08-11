package com.example.tyre_pulse_app.feature.settings.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.settings.ui.SettingsRoute

object SettingsDestination : NavigationDestination {
    override val route = "settings_route"
    override val destination = "settings_destination"
}

fun NavController.navigateToSettings(navOptions: NavOptions? = null) {
    this.navigate(SettingsDestination.route, navOptions)
}

fun NavGraphBuilder.settingsScreen(onBack: () -> Unit) {
    composable(route = SettingsDestination.route) {
        SettingsRoute(onBack = onBack)
    }
}
