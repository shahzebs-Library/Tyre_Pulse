package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActiveJobExecutionScreen(
    scannedPartId: String? = null,
    onBack: () -> Unit,
    onCompleteJob: () -> Unit,
    onScanPart: () -> Unit
) {
    val deductedParts = remember { mutableStateListOf<String>() }
    
    LaunchedEffect(scannedPartId) {
        if (!scannedPartId.isNullOrEmpty() && !deductedParts.contains(scannedPartId)) {
            deductedParts.add(scannedPartId)
            // Trigger background WorkManager to sync inventory deduction
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Active Job: WO-9021") })
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onScanPart) {
                Icon(Icons.Default.QrCodeScanner, contentDescription = "Scan Part")
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
            Text("Vehicle: CAT Excavator 320", style = MaterialTheme.typography.titleLarge)
            Text("Issue: Hydraulic Leak on Boom Cylinder")
            
            Divider()
            
            Text("Parts Deducted (Auto-synced):", style = MaterialTheme.typography.titleMedium)
            if (deductedParts.isEmpty()) {
                Text("Tap the scan button to deduct spare parts from inventory.")
            } else {
                deductedParts.forEach { part ->
                    ListItem(
                        headlineContent = { Text("Part: $part") },
                        leadingContent = { Icon(Icons.Default.Build, null) }
                    )
                }
            }
            
            Spacer(Modifier.weight(1f))
            
            Button(
                onClick = onCompleteJob,
                modifier = Modifier.fillMaxWidth().height(56.dp)
            ) {
                Text("Complete & Generate Invoice")
            }
        }
    }
}
