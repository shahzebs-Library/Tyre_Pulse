package com.example.tyre_pulse_app.feature.assets.navigation

import androidx.navigation.*
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.assets.ui.AssetListRoute

object AssetListDestination : NavigationDestination {
    override val route = "asset_list_route"
    override val destination = "asset_list_destination"
}

// AssetDetailDestination and navigateToAssetDetail are gone with the duplicate
// registration they belonged to. Neither was referenced outside this file, and with
// the detail route now owned by TyrePulseNavHost as a literal, a typed helper here
// pointed at a destination this file no longer registers - which the navigation
// checker correctly reported as a crash risk.
fun NavController.navigateToAssetList(navOptions: NavOptions? = null) {
    this.navigate(AssetListDestination.route, navOptions)
}

/**
 * The asset LIST only.
 *
 * IT ALSO REGISTERED `asset_detail_route/{assetId}`, AND SO DOES TyrePulseNavHost -
 * the same route declared twice in one graph. Compose Navigation keys destinations by
 * route, so the later registration silently replaced this one and this copy never ran.
 * That is why it went unnoticed: it compiled, and its behaviour was simply discarded.
 *
 * It surfaced when `AssetDetailRoute` gained an `onUpdateOdometer` parameter. The
 * NavHost copy was updated, this dead one was not, and the compiler reported the
 * missing argument here - in the copy that never executed.
 *
 * The detail registration is removed rather than repaired: the NavHost owns that route
 * and passes the full set of callbacks. `onStartInspection` and `onTyreClick` went
 * with it - both existed only to feed the duplicate, and `onTyreClick` was never
 * referenced at all, in either copy.
 */
fun NavGraphBuilder.assetsScreen(
    onAssetClick: (String) -> Unit,
    onBack: () -> Unit
) {
    composable(route = AssetListDestination.route) {
        AssetListRoute(
            onAssetClick = onAssetClick,
            onBack = onBack
        )
    }
}
