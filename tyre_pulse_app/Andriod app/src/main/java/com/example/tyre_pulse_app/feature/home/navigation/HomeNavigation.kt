package com.example.tyre_pulse_app.feature.home.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.home.ui.HomeRoute

object HomeDestination : NavigationDestination {
    override val route = "home_route"
    override val destination = "home_destination"
}

fun NavController.navigateToHome(navOptions: NavOptions? = null) {
    this.navigate(HomeDestination.route, navOptions)
}

fun NavGraphBuilder.homeScreen(
    onInspectClick: () -> Unit,
    onAssetClick: (String) -> Unit
) {
    composable(route = HomeDestination.route) {
        HomeRoute(
            onInspectClick = onInspectClick,
            onAssetClick = onAssetClick
        )
    }
}
