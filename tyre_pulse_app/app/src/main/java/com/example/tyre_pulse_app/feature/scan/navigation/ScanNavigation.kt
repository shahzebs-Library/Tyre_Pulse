package com.example.tyre_pulse_app.feature.scan.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.scan.ui.ScanRoute

object ScanDestination : NavigationDestination {
    override val route = "scan_route"
    override val destination = "scan_destination"
}

fun NavController.navigateToScan(navOptions: NavOptions? = null) {
    this.navigate(ScanDestination.route, navOptions)
}

fun NavGraphBuilder.scanScreen(
    onBack: () -> Unit,
    onNavigateToInspection: (String, String?) -> Unit,
    onNavigateToTyreChange: (String, String?) -> Unit,
    onNavigateToAssetDetail: (String) -> Unit,
    onNavigateToTyreHistory: (String) -> Unit,
    onNavigateToSearch: (String) -> Unit
) {
    composable(route = ScanDestination.route) {
        ScanRoute(
            onBack = onBack,
            onNavigateToInspection = onNavigateToInspection,
            onNavigateToTyreChange = onNavigateToTyreChange,
            onNavigateToAssetDetail = onNavigateToAssetDetail,
            onNavigateToTyreHistory = onNavigateToTyreHistory,
            onNavigateToSearch = onNavigateToSearch
        )
    }
}
