package com.tyrepulse.inspector.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.tyrepulse.inspector.AppContainer
import com.tyrepulse.inspector.feature.home.HomeScreen
import com.tyrepulse.inspector.feature.home.HomeViewModel
import com.tyrepulse.inspector.feature.login.LoginScreen
import com.tyrepulse.inspector.feature.login.LoginViewModel

object Routes {
    const val LOGIN = "login"
    const val HOME = "home"
}

/**
 * Top-level navigation. The start destination follows the persisted session:
 * a signed-in user lands on Home, otherwise on Login. ViewModels are built from
 * the AppContainer (manual DI) via a small factory.
 */
@Composable
fun AppNavGraph(container: AppContainer) {
    val navController = rememberNavController()
    val signedIn by container.authRepository.isSignedIn.collectAsStateWithLifecycle(initialValue = false)
    val start = if (signedIn) Routes.HOME else Routes.LOGIN

    NavHost(navController = navController, startDestination = start) {
        composable(Routes.LOGIN) {
            val vm = viewModel { LoginViewModel(container.authRepository) }
            LoginScreen(
                vm = vm,
                onSignedIn = {
                    navController.navigate(Routes.HOME) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                },
            )
        }
        composable(Routes.HOME) {
            val vm = viewModel { HomeViewModel(container.apiClient, container.authRepository) }
            HomeScreen(
                vm = vm,
                onSignedOut = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(Routes.HOME) { inclusive = true }
                    }
                },
            )
        }
    }
}
