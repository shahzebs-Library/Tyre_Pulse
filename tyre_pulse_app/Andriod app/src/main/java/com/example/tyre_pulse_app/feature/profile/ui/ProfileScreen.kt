package com.example.tyre_pulse_app.feature.profile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.authentication.UserViewModel
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.designsystem.component.TPTopBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileRoute(
    onLogout: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToDiagnostics: () -> Unit,
    userViewModel: UserViewModel = hiltViewModel()
) {
    val user by userViewModel.currentUser.collectAsState()
    val currentWorkspace by userViewModel.currentWorkspace.collectAsState()

    Scaffold(
        topBar = {
            TPTopBar(title = "Profile")
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            user?.let {
                TPCard {
                    Column(modifier = Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.AccountCircle, contentDescription = null, modifier = Modifier.size(64.dp))
                        Spacer(Modifier.height(8.dp))
                        Text(text = it.name, style = MaterialTheme.typography.titleLarge)
                        Text(text = it.email, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                    }
                }
            }

            TPCard {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(text = "Active Workspace", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(12.dp))
                    currentWorkspace?.let {
                        Text(text = "Tenant: ${it.tenant.name}")
                        Text(text = "Company: ${it.company.name}")
                        Text(text = "Country: ${it.country.name}")
                        it.site?.let { site -> Text(text = "Site: ${site.name}") }
                    }
                }
            }

            TPCard {
                Column(modifier = Modifier.padding(16.dp)) {
                    ListItem(
                        headlineContent = { Text("Settings") },
                        leadingContent = { Icon(Icons.Default.Settings, contentDescription = null) },
                        trailingContent = { Icon(Icons.Default.ChevronRight, contentDescription = null) },
                        modifier = Modifier.clickable { onNavigateToSettings() }
                    )
                    HorizontalDivider()
                    ListItem(
                        headlineContent = { Text("Support & Diagnostics") },
                        leadingContent = { Icon(Icons.Default.Help, contentDescription = null) },
                        trailingContent = { Icon(Icons.Default.ChevronRight, contentDescription = null) },
                        modifier = Modifier.clickable { onNavigateToDiagnostics() }
                    )
                }
            }

            Button(
                onClick = onLogout,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
            ) {
                Icon(Icons.Default.Logout, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Logout")
            }
            
            Text(
                text = "Version 1.0.0 (1)",
                modifier = Modifier.align(Alignment.CenterHorizontally),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline
            )
        }
    }
}
