package com.example.tyre_pulse_app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.example.tyre_pulse_app.core.authentication.TokenManager
import com.example.tyre_pulse_app.core.authentication.UserViewModel
import com.example.tyre_pulse_app.core.common.NetworkMonitor
import com.example.tyre_pulse_app.core.designsystem.component.AppBanner
import com.example.tyre_pulse_app.core.designsystem.theme.Tyre_pulse_appTheme
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import com.example.tyre_pulse_app.core.navigation.AuthDestination
import com.example.tyre_pulse_app.feature.assets.navigation.AssetListDestination
import com.example.tyre_pulse_app.feature.home.navigation.HomeDestination
import com.example.tyre_pulse_app.feature.notifications.navigation.NotificationsDestination
import com.example.tyre_pulse_app.feature.profile.navigation.ProfileDestination
import com.example.tyre_pulse_app.ui.navigation.TyrePulseNavHost
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var tokenManager: TokenManager

    @Inject
    lateinit var networkMonitor: NetworkMonitor

    private val userViewModel: UserViewModel by viewModels()

    @OptIn(ExperimentalMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val accessToken by tokenManager.accessToken.collectAsState(initial = null)
            val isAuthenticated = accessToken != null
            
            android.util.Log.d("TyrePulse", "Auth state: $isAuthenticated, Token: ${accessToken?.take(10)}...")

            val currentUser by userViewModel.currentUser.collectAsState()
            val currentWorkspace by userViewModel.currentWorkspace.collectAsState()
            val isOnline by networkMonitor.isOnline.collectAsState(initial = true)

            var showWorkspaceSwitcher by remember { mutableStateOf(false) }
            val isMaintenance by remember { mutableStateOf(false) }

            Tyre_pulse_appTheme(darkTheme = false) { // FORCING LIGHT MODE FOR VIEWING
                val navController = rememberNavController()
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentDestination = navBackStackEntry?.destination

                // Automatically navigate to Login if not authenticated
                LaunchedEffect(isAuthenticated) {
                    if (!isAuthenticated) {
                        navController.navigate(AuthDestination.route) {
                            popUpTo(0)
                        }
                    }
                }

                if (showWorkspaceSwitcher && currentUser != null) {
                    ModalBottomSheet(onDismissRequest = { showWorkspaceSwitcher = false }) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text("Switch Workspace", style = MaterialTheme.typography.titleLarge)
                            Spacer(Modifier.height(16.dp))
                            currentUser!!.availableWorkspaces.forEach { workspace ->
                                ListItem(
                                    headlineContent = { Text("${workspace.country.name} • ${workspace.site?.name ?: workspace.company.name}") },
                                    supportingContent = { Text(workspace.company.name) },
                                    modifier = Modifier.clickable {
                                        userViewModel.selectWorkspace(workspace)
                                        showWorkspaceSwitcher = false
                                    },
                                    trailingContent = {
                                        if (currentWorkspace?.country?.id == workspace.country.id && 
                                            currentWorkspace?.site?.id == workspace.site?.id) {
                                            Icon(Icons.Default.Check, contentDescription = "Selected")
                                        }
                                    }
                                )
                            }
                            Spacer(Modifier.height(32.dp))
                        }
                    }
                }

                Scaffold(
                    modifier = Modifier.fillMaxSize(),
                    topBar = {
                        Column {
                            AppBanner(
                                text = "OFFLINE MODE - Work will sync later",
                                icon = Icons.Default.WifiOff,
                                isVisible = !isOnline
                            )
                            AppBanner(
                                text = "Service in maintenance. Limited features.",
                                icon = Icons.Default.Info,
                                isVisible = isMaintenance,
                                backgroundColor = YellowPrimary
                            )
                        }
                    },
                    bottomBar = {
                        if (isAuthenticated && currentDestination?.route != AuthDestination.route) {
                            NavigationBar(
                                containerColor = MaterialTheme.colorScheme.surface,
                                tonalElevation = 8.dp
                            ) {
                                NavigationBarItem(
                                    icon = { Icon(Icons.Default.Home, contentDescription = null) },
                                    label = { Text(stringResource(R.string.home)) },
                                    selected = currentDestination?.hierarchy?.any { it.route == HomeDestination.route } == true,
                                    onClick = {
                                        navController.navigate(HomeDestination.route) {
                                            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                            launchSingleTop = true
                                            restoreState = true
                                        }
                                    }
                                )
                                NavigationBarItem(
                                    icon = { Icon(Icons.Default.DirectionsCar, contentDescription = null) },
                                    label = { Text(stringResource(R.string.assets)) },
                                    selected = currentDestination?.hierarchy?.any { it.route == AssetListDestination.route } == true,
                                    onClick = {
                                        navController.navigate(AssetListDestination.route) {
                                            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                            launchSingleTop = true
                                            restoreState = true
                                        }
                                    }
                                )
                                
                                NavigationBarItem(
                                    icon = { 
                                        Surface(
                                            modifier = Modifier.size(48.dp),
                                            shape = CircleShape,
                                            color = MaterialTheme.colorScheme.primary
                                        ) {
                                            Icon(
                                                Icons.Default.Add, 
                                                contentDescription = null,
                                                modifier = Modifier.padding(8.dp),
                                                tint = Color.Black
                                            )
                                        }
                                    },
                                    label = { Text(stringResource(R.string.inspect)) },
                                    selected = false,
                                    onClick = { 
                                        navController.navigate("checklist_library")
                                    }
                                )

                                NavigationBarItem(
                                    icon = { Icon(Icons.Default.Notifications, contentDescription = null) },
                                    label = { Text(stringResource(R.string.alerts)) },
                                    selected = currentDestination?.hierarchy?.any { it.route == NotificationsDestination.route } == true,
                                    onClick = {
                                        navController.navigate(NotificationsDestination.route) {
                                            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                            launchSingleTop = true
                                            restoreState = true
                                        }
                                    }
                                )
                                NavigationBarItem(
                                    icon = { Icon(Icons.Default.Menu, contentDescription = null) },
                                    label = { Text(stringResource(R.string.more)) },
                                    selected = currentDestination?.hierarchy?.any { it.route == ProfileDestination.route } == true,
                                    onClick = {
                                        navController.navigate(ProfileDestination.route) {
                                            popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                            launchSingleTop = true
                                            restoreState = true
                                        }
                                    }
                                )
                            }
                        }
                    }
                ) { innerPadding ->
                    TyrePulseNavHost(
                        navController = navController,
                        modifier = Modifier.padding(innerPadding),
                        isAuthenticated = isAuthenticated
                    )
                }
            }
        }
    }
}
