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

object TyreInspectionDestination : NavigationDestination {
    override val route = "tyre_inspection_route/{assetId}/{tyreId}"
    override val destination = "tyre_inspection_destination"
    fun createRoute(assetId: String, tyreId: String) = "tyre_inspection_route/$assetId/$tyreId"
}

fun NavController.navigateToInspectionForm(assetId: String, navOptions: NavOptions? = null) {
    this.navigate(InspectionFormDestination.createRoute(assetId), navOptions)
}

fun NavController.navigateToTyreInspection(assetId: String, tyreId: String, navOptions: NavOptions? = null) {
    this.navigate(TyreInspectionDestination.createRoute(assetId, tyreId), navOptions)
}

fun NavGraphBuilder.inspectionsScreen(
    onBack: () -> Unit,
    onTyreClick: (String, String) -> Unit,
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
            onTyreClick = { tyreId: String -> onTyreClick(assetId, tyreId) },
            onNavigateToScan = onNavigateToScan
        )
    }

    // TyreInspectionDestination is obsolete, handled by BottomSheet
}
