package com.example.tyre_pulse_app.feature.inspections.navigation

import androidx.compose.runtime.remember
import androidx.navigation.*
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.inspections.ui.InspectionFormRoute
import com.example.tyre_pulse_app.feature.inspections.ui.TyreInspectionRoute
import com.example.tyre_pulse_app.feature.inspections.ui.InspectionViewModel

object InspectionFormDestination : NavigationDestination {
    override val route = "inspection_form_route/{assetId}?draftId={draftId}"
    override val destination = "inspection_form_destination"
    fun createRoute(assetId: String, draftId: String? = null) = 
        "inspection_form_route/$assetId" + if (draftId != null) "?draftId=$draftId" else ""
}

object TyreInspectionDestination : NavigationDestination {
    override val route = "tyre_inspection_route/{assetId}/{tyreId}"
    override val destination = "tyre_inspection_destination"
    fun createRoute(assetId: String, tyreId: String) = "tyre_inspection_route/$assetId/$tyreId"
}

fun NavController.navigateToInspectionForm(assetId: String, draftId: String? = null) {
    this.navigate(InspectionFormDestination.createRoute(assetId, draftId))
}

fun NavController.navigateToTyreInspection(assetId: String, tyreId: String) {
    this.navigate(TyreInspectionDestination.createRoute(assetId, tyreId))
}

fun NavGraphBuilder.inspectionsScreen(
    navController: NavController,
    onBack: () -> Unit
) {
    composable(
        route = InspectionFormDestination.route,
        arguments = listOf(
            navArgument("assetId") { type = NavType.StringType },
            navArgument("draftId") { type = NavType.StringType; nullable = true; defaultValue = null }
        )
    ) { backStackEntry ->
        InspectionFormRoute(
            onBack = onBack,
            onTyreClick = { assetId, tyreId ->
                navController.navigateToTyreInspection(assetId, tyreId)
            }
        )
    }

    composable(
        route = TyreInspectionDestination.route,
        arguments = listOf(
            navArgument("assetId") { type = NavType.StringType },
            navArgument("tyreId") { type = NavType.StringType }
        )
    ) { backStackEntry ->
        val tyreId = backStackEntry.arguments?.getString("tyreId") ?: ""
        
        // To share the same ViewModel instance, we can scope it to the InspectionForm entry
        val parentEntry = remember(backStackEntry) {
            navController.getBackStackEntry(InspectionFormDestination.route)
        }
        val inspectionViewModel: InspectionViewModel = androidx.hilt.navigation.compose.hiltViewModel(parentEntry)

        TyreInspectionRoute(
            initialReading = inspectionViewModel.getReading(tyreId),
            onBack = { reading ->
                if (reading != null) {
                    inspectionViewModel.updateReading(reading)
                }
                navController.popBackStack()
            }
        )
    }
}
