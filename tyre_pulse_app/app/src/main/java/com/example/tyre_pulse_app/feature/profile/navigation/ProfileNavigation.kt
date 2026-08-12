package com.example.tyre_pulse_app.feature.profile.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.profile.ui.ProfileRoute

object ProfileDestination : NavigationDestination {
    override val route = "profile_route"
    override val destination = "profile_destination"
}

fun NavController.navigateToProfile(navOptions: NavOptions? = null) {
    this.navigate(ProfileDestination.route, navOptions)
}

fun NavGraphBuilder.profileScreen(
    onLogout: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToDiagnostics: () -> Unit,
    onNavigateToModule: (String) -> Unit
) {
    composable(route = ProfileDestination.route) {
        ProfileRoute(
            onLogout = onLogout,
            onNavigateToSettings = onNavigateToSettings,
            onNavigateToDiagnostics = onNavigateToDiagnostics,
            onNavigateToModule = onNavigateToModule
        )
    }
}
