package com.example.tyre_pulse_app.feature.assets.navigation

import androidx.navigation.*
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.assets.ui.AssetListRoute
import com.example.tyre_pulse_app.feature.assets.ui.AssetDetailRoute

object AssetListDestination : NavigationDestination {
    override val route = "asset_list_route"
    override val destination = "asset_list_destination"
}

object AssetDetailDestination : NavigationDestination {
    override val route = "asset_detail_route/{assetId}"
    override val destination = "asset_detail_destination"
    fun createRoute(assetId: String) = "asset_detail_route/$assetId"
}

fun NavController.navigateToAssetList(navOptions: NavOptions? = null) {
    this.navigate(AssetListDestination.route, navOptions)
}

fun NavController.navigateToAssetDetail(assetId: String, navOptions: NavOptions? = null) {
    this.navigate(AssetDetailDestination.createRoute(assetId), navOptions)
}

fun NavGraphBuilder.assetsScreen(
    onAssetClick: (String) -> Unit,
    onBack: () -> Unit,
    onStartInspection: (String) -> Unit,
    onTyreClick: (String) -> Unit
) {
    composable(route = AssetListDestination.route) {
        AssetListRoute(
            onAssetClick = onAssetClick,
            onBack = onBack
        )
    }

    composable(
        route = AssetDetailDestination.route,
        arguments = listOf(navArgument("assetId") { type = NavType.StringType })
    ) { backStackEntry ->
        val assetId = backStackEntry.arguments?.getString("assetId") ?: ""
        AssetDetailRoute(
            assetId = assetId,
            onBack = onBack,
            onInspect = onStartInspection
        )
    }
}
