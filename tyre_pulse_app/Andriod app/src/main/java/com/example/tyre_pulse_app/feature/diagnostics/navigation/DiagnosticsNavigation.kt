package com.example.tyre_pulse_app.feature.diagnostics.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.diagnostics.ui.DiagnosticsRoute

object DiagnosticsDestination : NavigationDestination {
    override val route = "diagnostics_route"
    override val destination = "diagnostics_destination"
}

fun NavController.navigateToDiagnostics(navOptions: NavOptions? = null) {
    this.navigate(DiagnosticsDestination.route, navOptions)
}

fun NavGraphBuilder.diagnosticsScreen(onBack: () -> Unit) {
    composable(route = DiagnosticsDestination.route) {
        DiagnosticsRoute(onBack = onBack)
    }
}
