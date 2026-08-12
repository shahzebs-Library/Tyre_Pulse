package com.example.tyre_pulse_app.core.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavHostController
import androidx.navigation.compose.rememberNavController

/**
 * Contract for preserving state across navigation.
 */
class TyrePulseNavigationState(
    val navController: NavHostController
) {
    fun navigateBack() {
        navController.popBackStack()
    }

    fun navigateToDetail(route: String) {
        navController.navigate(route) {
            // Standard detail navigation
            launchSingleTop = true
            restoreState = true
        }
    }

    fun navigateToRoot(route: String) {
        navController.navigate(route) {
            popUpTo(navController.graph.startDestinationId) {
                saveState = true
            }
            launchSingleTop = true
            restoreState = true
        }
    }
}

@Composable
fun rememberTyrePulseNavigationState(
    navController: NavHostController = rememberNavController()
): TyrePulseNavigationState = remember(navController) {
    TyrePulseNavigationState(navController)
}
