package com.example.tyre_pulse_app.feature.workshop.navigation

import androidx.navigation.*
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.workshop.ui.WorkOrderDetailsRoute
import com.example.tyre_pulse_app.feature.workshop.ui.WorkshopHomeRoute

object WorkshopHomeDestination : NavigationDestination {
    override val route = "workshop_home_route"
    override val destination = "workshop_home_destination"
}

object WorkOrderDetailsDestination : NavigationDestination {
    override val route = "work_order_details_route/{workOrderId}"
    override val destination = "work_order_details_destination"
    fun createRoute(workOrderId: String) = "work_order_details_route/$workOrderId"
}

fun NavController.navigateToWorkshopHome(navOptions: NavOptions? = null) {
    this.navigate(WorkshopHomeDestination.route, navOptions)
}

fun NavController.navigateToWorkOrderDetails(workOrderId: String, navOptions: NavOptions? = null) {
    this.navigate(WorkOrderDetailsDestination.createRoute(workOrderId), navOptions)
}

fun NavGraphBuilder.workshopScreen(
    onWorkOrderClick: (String) -> Unit,
    onBack: () -> Unit
) {
    composable(route = WorkshopHomeDestination.route) {
        WorkshopHomeRoute(onWorkOrderClick = onWorkOrderClick)
    }
    composable(
        route = WorkOrderDetailsDestination.route,
        arguments = listOf(navArgument("workOrderId") { type = NavType.StringType })
    ) {
        WorkOrderDetailsRoute(onBack = onBack)
    }
}
