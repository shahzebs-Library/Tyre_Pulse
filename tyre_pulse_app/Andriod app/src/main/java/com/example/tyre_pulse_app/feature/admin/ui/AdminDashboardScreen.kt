package com.example.tyre_pulse_app.feature.admin.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminDashboardScreen() {
    Scaffold(
        topBar = { TopAppBar(title = { Text("Admin Console", fontWeight = FontWeight.Bold) }) }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).padding(16.dp)) {
            Text("System Oversight", style = MaterialTheme.typography.titleMedium)
            // ... Metrics and settings navigation
        }
    }
}
