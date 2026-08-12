package com.example.tyre_pulse_app.feature.tyre_replacement.navigation

import androidx.navigation.*
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.tyre_replacement.ui.TyreReplacementRoute

object TyreReplacementDestination : NavigationDestination {
    override val route = "tyre_replacement_route/{tyreId}"
    override val destination = "tyre_replacement_destination"
    fun createRoute(tyreId: String) = "tyre_replacement_route/$tyreId"
}

fun NavController.navigateToTyreReplacement(tyreId: String, navOptions: NavOptions? = null) {
    this.navigate(TyreReplacementDestination.createRoute(tyreId), navOptions)
}

fun NavGraphBuilder.tyreReplacementScreen(
    onBack: () -> Unit
) {
    composable(
        route = TyreReplacementDestination.route,
        arguments = listOf(navArgument("tyreId") { type = NavType.StringType })
    ) {
        TyreReplacementRoute(onBack = onBack)
    }
}
