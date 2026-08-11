package com.example.tyre_pulse_app.feature.inspections.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.inspections.ui.InspectionFormRoute
import com.example.tyre_pulse_app.feature.inspections.ui.TyreInspectionRoute

object InspectionFormDestination : NavigationDestination {
    override val route = "inspection_form_route/{assetId}"
    override val destination = "inspection_form_destination"
    fun createRoute(assetId: String) = "inspection_form_route/$assetId"
}

object TyreInspectionDestination : NavigationDestination {
    override val route = "tyre_inspection_route/{assetId}/{tyreId}/{position}"
    override val destination = "tyre_inspection_destination"
    fun createRoute(assetId: String, tyreId: String, position: String) = 
        "tyre_inspection_route/$assetId/$tyreId/$position"
}

fun NavController.navigateToInspectionForm(assetId: String) {
    this.navigate(InspectionFormDestination.createRoute(assetId))
}

fun NavController.navigateToTyreInspection(assetId: String, tyreId: String, position: String) {
    this.navigate(TyreInspectionDestination.createRoute(assetId, tyreId, position))
}

fun NavGraphBuilder.inspectionsScreen(
    onBack: () -> Unit,
    onTyreClick: (String, String, String) -> Unit // assetId, tyreId, position
) {
    composable(
        route = InspectionFormDestination.route,
        arguments = listOf(navArgument("assetId") { type = NavType.StringType })
    ) {
        InspectionFormRoute(
            onBack = onBack,
            onTyreClick = onTyreClick
        )
    }

    composable(
        route = TyreInspectionDestination.route,
        arguments = listOf(
            navArgument("assetId") { type = NavType.StringType },
            navArgument("tyreId") { type = NavType.StringType },
            navArgument("position") { type = NavType.StringType }
        )
    ) {
        TyreInspectionRoute(onBack = onBack)
    }
}
