package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
fun AccidentReportRoute(
    onBack: () -> Unit,
    viewModel: AccidentReportViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Report Accident", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Step ${uiState.currentStep} of 4", style = MaterialTheme.typography.labelSmall)
            
            when (uiState.currentStep) {
                1 -> {
                    Text("Basic Information", style = MaterialTheme.typography.titleMedium)
                    OutlinedTextField(
                        value = uiState.assetNo,
                        onValueChange = { viewModel.updateField(assetNo = it) },
                        label = { Text("Asset Number") },
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = uiState.description,
                        onValueChange = { viewModel.updateField(desc = it) },
                        label = { Text("Short Description") },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                2 -> {
                    Text("Location & Context", style = MaterialTheme.typography.titleMedium)
                    // ... Location Picker stub
                }
            }

            Spacer(Modifier.weight(1f))
            
            Button(
                onClick = { viewModel.nextStep() },
                modifier = Modifier.fillMaxWidth().height(56.dp)
            ) {
                Text("Continue")
            }
        }
    }
}
