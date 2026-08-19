package com.example.tyre_pulse_app.feature.workshop.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.workshop.ui.WorkshopHomeScreen

object WorkshopDestination : NavigationDestination {
    override val route = "workshop_route"
    override val destination = "workshop_destination"
}

fun NavController.navigateToWorkshop(navOptions: NavOptions? = null) {
    this.navigate(WorkshopDestination.route, navOptions)
}

fun NavGraphBuilder.workshopScreen(
    onWorkOrderClick: (String) -> Unit,
    onViewTeam: () -> Unit,
    onViewCalendar: () -> Unit,
    onBack: () -> Unit
) {
    composable(route = WorkshopDestination.route) {
        WorkshopHomeScreen(
            onViewOrders = { onWorkOrderClick("list") },
            onViewTeam = onViewTeam,
            onViewCalendar = onViewCalendar
        )
    }
}
