package com.example.tyre_pulse_app.feature.settings.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.component.TPTopBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsRoute(
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
            item {
                ListItem(
                    headlineContent = { Text("Notification Preferences") },
                    supportingContent = { Text("Manage push alerts and reminders") },
                    trailingContent = { Switch(checked = true, onCheckedChange = {}) }
                )
                HorizontalDivider()
            }
            item {
                ListItem(
                    headlineContent = { Text("Dark Mode") },
                    supportingContent = { Text("System default") },
                    trailingContent = { Switch(checked = false, onCheckedChange = {}) }
                )
                HorizontalDivider()
            }
            item {
                ListItem(
                    headlineContent = { Text("Language") },
                    supportingContent = { Text("English") }
                )
            }
        }
    }
}
