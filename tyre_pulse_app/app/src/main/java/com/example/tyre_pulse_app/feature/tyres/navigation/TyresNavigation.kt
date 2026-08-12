package com.example.tyre_pulse_app.feature.tyres.navigation

import androidx.navigation.*
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.tyres.ui.TyreDetailRoute
import com.example.tyre_pulse_app.feature.tyres.ui.TyreListRoute

object TyreListDestination : NavigationDestination {
    override val route = "tyre_list_route"
    override val destination = "tyre_list_destination"
}

object TyreDetailDestination : NavigationDestination {
    override val route = "tyre_detail_route/{tyreId}"
    override val destination = "tyre_detail_destination"
    fun createRoute(tyreId: String) = "tyre_detail_route/$tyreId"
}

fun NavController.navigateToTyreList(navOptions: NavOptions? = null) {
    this.navigate(TyreListDestination.route, navOptions)
}

fun NavController.navigateToTyreDetail(tyreId: String, navOptions: NavOptions? = null) {
    this.navigate(TyreDetailDestination.createRoute(tyreId), navOptions)
}

fun NavGraphBuilder.tyresScreen(
    onTyreClick: (String) -> Unit,
    onBack: () -> Unit,
    onReplaceTyre: (String) -> Unit
) {
    composable(route = TyreListDestination.route) {
        TyreListRoute(onTyreClick = onTyreClick)
    }
    composable(
        route = TyreDetailDestination.route,
        arguments = listOf(navArgument("tyreId") { type = NavType.StringType })
    ) {
        TyreDetailRoute(
            onBack = onBack,
            onReplaceTyre = onReplaceTyre
        )
    }
}
