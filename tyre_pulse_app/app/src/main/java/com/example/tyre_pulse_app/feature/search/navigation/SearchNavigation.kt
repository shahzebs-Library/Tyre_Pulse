package com.example.tyre_pulse_app.feature.search.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.search.ui.GlobalSearchRoute

object SearchDestination : NavigationDestination {
    override val route = "search_route?q={q}"
    override val destination = "search_destination"
    fun createRoute(query: String) = "search_route?q=$query"
}

fun NavController.navigateToSearch(query: String, navOptions: NavOptions? = null) {
    this.navigate(SearchDestination.createRoute(query), navOptions)
}

fun NavGraphBuilder.searchScreen(
    onAssetClick: (String) -> Unit,
    onTyreClick: (String) -> Unit
) {
    composable(
        route = SearchDestination.route,
        arguments = listOf(
            navArgument("q") {
                type = NavType.StringType
                nullable = true
                defaultValue = null
            }
        )
    ) {
        GlobalSearchRoute(
            onAssetClick = onAssetClick,
            onTyreClick = onTyreClick
        )
    }
}
