package com.example.tyre_pulse_app.feature.inspections.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InspectionDetailScreen(
    assetId: String, 
    onBack: () -> Unit,
    onTyreClick: (String) -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Inspect Asset #$assetId", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).padding(16.dp)) {
            Text("Select a tyre to record readings", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(20.dp))
            // High-fidelity map usually goes here
            Button(onClick = { onTyreClick("FL") }) {
                Text("Inspect Front Left")
            }
        }
    }
}
