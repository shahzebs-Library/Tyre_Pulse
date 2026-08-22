package com.example.tyre_pulse_app.feature.accidents.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.accidents.ui.AccidentListRoute

import androidx.navigation.NavType
import androidx.navigation.navArgument

object AccidentListDestination : NavigationDestination {
    override val route = "accident_list_route"
    override val destination = "accident_list_destination"
}

object AccidentReportDestination : NavigationDestination {
    override val route = "accident_report_route"
    override val destination = "accident_report_destination"
}

object AccidentCaseDestination : NavigationDestination {
    override val route = "accident_case_route/{caseId}"
    override val destination = "accident_case_destination"
    fun createRoute(caseId: String) = "accident_case_route/$caseId"
}

fun NavController.navigateToAccidentList(navOptions: NavOptions? = null) {
    this.navigate(AccidentListDestination.route, navOptions)
}

fun NavController.navigateToAccidentCase(caseId: String) {
    this.navigate(AccidentCaseDestination.createRoute(caseId))
}

fun NavGraphBuilder.accidentsGraph(
    onNavigateBack: () -> Unit,
    onNavigateToReport: () -> Unit,
    onCaseClick: (String) -> Unit
) {
    composable(route = AccidentListDestination.route) {
        com.example.tyre_pulse_app.feature.accidents.ui.AccidentsScreen(
            onNavigateBack = onNavigateBack,
            onNavigateToReport = onNavigateToReport,
            onCaseClick = onCaseClick
        )
    }

    composable(route = AccidentReportDestination.route) {
        com.example.tyre_pulse_app.feature.accidents.ui.ReportAccidentScreen(
            onNavigateBack = onNavigateBack
        )
    }

    composable(
        route = AccidentCaseDestination.route,
        arguments = listOf(navArgument("caseId") { type = NavType.StringType })
    ) { backStackEntry ->
        val caseId = backStackEntry.arguments?.getString("caseId") ?: ""
        com.example.tyre_pulse_app.feature.accidents.ui.AccidentCaseScreen(
            caseId = caseId,
            onBack = onNavigateBack
        )
    }
}
