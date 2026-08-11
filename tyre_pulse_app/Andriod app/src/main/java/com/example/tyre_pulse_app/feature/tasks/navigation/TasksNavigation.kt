package com.example.tyre_pulse_app.feature.tasks.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.tasks.ui.MyWorkRoute

object MyWorkDestination : NavigationDestination {
    override val route = "my_work_route"
    override val destination = "my_work_destination"
}

fun NavController.navigateToMyWork(navOptions: NavOptions? = null) {
    this.navigate(MyWorkDestination.route, navOptions)
}

fun NavGraphBuilder.myWorkScreen(
    onTaskClick: (String) -> Unit
) {
    composable(route = MyWorkDestination.route) {
        MyWorkRoute(onTaskClick = onTaskClick)
    }
}
