package com.example.tyre_pulse_app.feature.odometer.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OdometerUpdateScreen(
    vehicleId: String = "V-1024",
    previousOdometer: Int = 124500, // Mocked previous value
    onBack: () -> Unit,
    onSubmit: (Int) -> Unit
) {
    var newOdometerStr by remember { mutableStateOf("") }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var photoUri by remember { mutableStateOf<Uri?>(null) }

    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicturePreview()
    ) { bitmap ->
        // In a real app we'd save to FileProvider, skipping for prototype
    }

    val validateAndSubmit = {
        val newOdo = newOdometerStr.toIntOrNull()
        if (newOdo == null) {
            errorMessage = "Please enter a valid number"
        } else if (newOdo <= previousOdometer) {
            errorMessage = "New reading must be strictly greater than $previousOdometer km"
        } else if (newOdo > previousOdometer + 50000) {
            errorMessage = "Value seems unusually high. Please double check."
        } else {
            errorMessage = null
            onSubmit(newOdo)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Update Odometer") },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            
            // Vehicle Info Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Vehicle ID: $vehicleId", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Last Recorded Odometer:", style = MaterialTheme.typography.bodyMedium)
                    Text("$previousOdometer km", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
                }
            }

            // Input Field
            OutlinedTextField(
                value = newOdometerStr,
                onValueChange = { 
                    newOdometerStr = it
                    errorMessage = null 
                },
                label = { Text("New Odometer Reading (km)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                isError = errorMessage != null,
                supportingText = {
                    if (errorMessage != null) {
                        Text(errorMessage!!, color = MaterialTheme.colorScheme.error)
                    }
                }
            )
            
            // Optional Evidence
            Button(
                onClick = { cameraLauncher.launch(null) },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary)
            ) {
                Icon(Icons.Default.CameraAlt, contentDescription = "Camera")
                Spacer(Modifier.width(8.dp))
                Text("Take Photo Proof (Optional)")
            }

            Spacer(Modifier.weight(1f))

            // Submit
            Button(
                onClick = validateAndSubmit,
                modifier = Modifier.fillMaxWidth().height(56.dp)
            ) {
                Text("Submit Reading", style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}
