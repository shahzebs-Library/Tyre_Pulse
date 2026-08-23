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

/**
 * The workshop hub.
 *
 * WHY onViewOrders IS ITS OWN CALLBACK. This used to call onWorkOrderClick("list"),
 * using the string "list" as a sentinel meaning "show the whole list". The caller
 * routed every onWorkOrderClick to job_details_route/{id}, so the Orders tile opened
 * a JOB DETAIL screen for a job whose id was the literal text "list" - a detail page
 * for a record that cannot exist. Opening a list and opening one record are different
 * destinations, so they are different callbacks; a sentinel id is how they got fused.
 *
 * onBack went with it: this is a top-level hub reached from the tab bar, it has no
 * parent to return to, and WorkshopHomeScreen never rendered a back control - so the
 * parameter promised a behaviour that was never wired.
 */
fun NavGraphBuilder.workshopScreen(
    onViewOrders: () -> Unit,
    onViewTeam: () -> Unit,
    onViewCalendar: () -> Unit
) {
    composable(route = WorkshopDestination.route) {
        WorkshopHomeScreen(
            onViewOrders = onViewOrders,
            onViewTeam = onViewTeam,
            onViewCalendar = onViewCalendar
        )
    }
}
