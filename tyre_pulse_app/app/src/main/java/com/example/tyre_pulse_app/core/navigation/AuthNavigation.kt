package com.example.tyre_pulse_app.core.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.feature.auth.ui.LoginRoute

object AuthDestination : NavigationDestination {
    override val route = "auth_route"
    override val destination = "auth_destination"
}

fun NavController.navigateToAuth(navOptions: NavOptions? = null) {
    this.navigate(AuthDestination.route, navOptions)
}

fun NavGraphBuilder.authScreen(onLoginSuccess: () -> Unit) {
    composable(route = AuthDestination.route) {
        LoginRoute(onLoginSuccess = onLoginSuccess)
    }
}
