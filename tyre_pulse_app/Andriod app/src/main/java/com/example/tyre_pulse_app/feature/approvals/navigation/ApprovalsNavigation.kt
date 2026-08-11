package com.example.tyre_pulse_app.feature.approvals.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.approvals.ui.ApprovalDetailsRoute
import com.example.tyre_pulse_app.feature.approvals.ui.ApprovalsRoute

object ApprovalsDestination : NavigationDestination {
    override val route = "approvals_route"
    override val destination = "approvals_destination"
}

object ApprovalDetailsDestination : NavigationDestination {
    override val route = "approval_details_route/{approvalId}"
    override val destination = "approval_details_destination"
    fun createRoute(approvalId: String) = "approval_details_route/$approvalId"
}

fun NavController.navigateToApprovals(navOptions: NavOptions? = null) {
    this.navigate(ApprovalsDestination.route, navOptions)
}

fun NavController.navigateToApprovalDetails(approvalId: String) {
    this.navigate(ApprovalDetailsDestination.createRoute(approvalId))
}

fun NavGraphBuilder.approvalsScreen(
    onApprovalClick: (String) -> Unit,
    onBack: () -> Unit
) {
    composable(route = ApprovalsDestination.route) {
        ApprovalsRoute(onApprovalClick = onApprovalClick)
    }
    
    composable(
        route = ApprovalDetailsDestination.route,
        arguments = listOf(navArgument("approvalId") { type = NavType.StringType })
    ) {
        ApprovalDetailsRoute(onBack = onBack)
    }
}
