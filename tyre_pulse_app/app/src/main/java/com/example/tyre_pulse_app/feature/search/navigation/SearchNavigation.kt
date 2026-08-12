package com.example.tyre_pulse_app.feature.search.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.search.ui.GlobalSearchRoute

object SearchDestination : NavigationDestination {
    override val route = "search_route"
    override val destination = "search_destination"
}

fun NavController.navigateToSearch(navOptions: NavOptions? = null) {
    this.navigate(SearchDestination.route, navOptions)
}

fun NavGraphBuilder.searchScreen(
    onAssetClick: (String) -> Unit,
    onTyreClick: (String) -> Unit
) {
    composable(route = SearchDestination.route) {
        GlobalSearchRoute(
            onAssetClick = onAssetClick,
            onTyreClick = onTyreClick
        )
    }
}
