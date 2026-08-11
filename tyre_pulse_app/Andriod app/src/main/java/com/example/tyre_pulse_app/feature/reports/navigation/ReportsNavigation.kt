package com.example.tyre_pulse_app.feature.reports.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.reports.ui.ReportsRoute

object ReportsDestination : NavigationDestination {
    override val route = "reports_route"
    override val destination = "reports_destination"
}

fun NavController.navigateToReports(navOptions: NavOptions? = null) {
    this.navigate(ReportsDestination.route, navOptions)
}

fun NavGraphBuilder.reportsScreen() {
    composable(route = ReportsDestination.route) {
        ReportsRoute()
    }
}
