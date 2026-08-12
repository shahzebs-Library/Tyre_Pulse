package com.example.tyre_pulse_app.feature.notifications.navigation

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import androidx.navigation.compose.composable
import com.example.tyre_pulse_app.core.navigation.NavigationDestination
import com.example.tyre_pulse_app.feature.notifications.ui.NotificationsRoute

object NotificationsDestination : NavigationDestination {
    override val route = "notifications_route"
    override val destination = "notifications_destination"
}

fun NavController.navigateToNotifications(navOptions: NavOptions? = null) {
    this.navigate(NotificationsDestination.route, navOptions)
}

fun NavGraphBuilder.notificationsScreen(
    onNotificationClick: (String) -> Unit
) {
    composable(route = NotificationsDestination.route) {
        NotificationsRoute(onNotificationClick = onNotificationClick)
    }
}
