package com.example.tyre_pulse_app.feature.ai_engineer.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.AutoGraph
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiAnalyticsDashboard(
    onOpenCameraQC: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(title = { Text("AI Engineer QC Dashboard") })
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onOpenCameraQC) {
                Icon(Icons.Default.CameraAlt, contentDescription = "Run QC Check")
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
            ) {
                Column(Modifier.padding(16.dp)) {
                    Row {
                        Icon(Icons.Default.AutoGraph, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Predictive Maintenance", style = MaterialTheme.typography.titleLarge)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text("The AI Engine has predicted 2 assets will fail in the next 14 days based on engine hours and wear analysis.")
                }
            }
            
            Text("High Risk Assets", style = MaterialTheme.typography.titleMedium)
            
            ListItem(
                headlineContent = { Text("ASSET: CAT Excavator 320") },
                supportingContent = { Text("Predicted Failure: Hydraulic Cylinder Seal (15% Life Remaining)") },
                leadingContent = { Icon(Icons.Default.Warning, tint = Color.Red, contentDescription = null) },
                colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha=0.3f))
            )
            
            ListItem(
                headlineContent = { Text("ASSET: Concrete Mixer 5-Axle") },
                supportingContent = { Text("Predicted Failure: Drum Roller Bearing (Heavy Site Vibration Detected)") },
                leadingContent = { Icon(Icons.Default.Warning, tint = Color.Red, contentDescription = null) },
                colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha=0.3f))
            )
        }
    }
}
