package com.example.tyre_pulse_app.feature.accidents.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.accidents.ui.AccidentListRoute

object AccidentListDestination : NavigationDestination {
    override val route = "accident_list_route"
    override val destination = "accident_list_destination"
}

fun NavController.navigateToAccidentList(navOptions: NavOptions? = null) {
    this.navigate(AccidentListDestination.route, navOptions)
}

fun NavGraphBuilder.accidentsScreen(
    onAccidentClick: (String) -> Unit,
    onReportAccident: () -> Unit
) {
    composable(route = AccidentListDestination.route) {
        AccidentListRoute(
            onAccidentClick = onAccidentClick,
            onReportAccident = onReportAccident
        )
    }
}
