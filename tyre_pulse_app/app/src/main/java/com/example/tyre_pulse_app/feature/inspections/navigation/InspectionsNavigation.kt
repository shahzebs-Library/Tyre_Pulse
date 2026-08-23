package com.example.tyre_pulse_app.feature.inspections.navigation

import androidx.navigation.*
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.inspections.ui.InspectionFormScreen

object InspectionFormDestination : NavigationDestination {
    override val route = "inspection_form_route/{assetId}"
    override val destination = "inspection_form_destination"
    fun createRoute(assetId: String) = "inspection_form_route/$assetId"
}


fun NavController.navigateToInspectionForm(assetId: String, navOptions: NavOptions? = null) {
    this.navigate(InspectionFormDestination.createRoute(assetId), navOptions)
}


fun NavGraphBuilder.inspectionsScreen(
    onBack: () -> Unit,
    onNavigateToScan: () -> Unit
) {
    composable(
        route = InspectionFormDestination.route,
        arguments = listOf(navArgument("assetId") { type = NavType.StringType })
    ) { backStackEntry ->
        val assetId = backStackEntry.arguments?.getString("assetId") ?: ""
        InspectionFormScreen(
            assetId = assetId,
            onBack = onBack,
            onNavigateToScan = onNavigateToScan
        )
    }

    // Tyre taps are handled inside InspectionFormScreen by a ModalBottomSheet, so
    // there is deliberately no tyre-inspection destination. A previous one was
    // deleted but its navigate() helper was left wired up, which crashed the app
    // on every tyre tap: the route it targeted no longer existed.
}
