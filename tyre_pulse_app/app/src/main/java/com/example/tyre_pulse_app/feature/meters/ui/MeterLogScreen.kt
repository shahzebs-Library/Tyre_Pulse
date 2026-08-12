package com.example.tyre_pulse_app.feature.meters.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeterLogRoute(
    onBack: () -> Unit,
    viewModel: MeterLogViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Meter Logs", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            Text("Update Odometer & Engine Hours", style = MaterialTheme.typography.titleMedium)

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Speed, contentDescription = null, tint = StatusBlue)
                        Spacer(Modifier.width(8.dp))
                        Text("Current Odometer: ${uiState.currentKm} KM", fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(
                        value = uiState.newKm,
                        onValueChange = viewModel::onKmChanged,
                        label = { Text("New Odometer Reading") },
                        isError = uiState.kmError != null,
                        supportingText = uiState.kmError?.let { { Text(it) } },
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
                    )
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Timer, contentDescription = null, tint = StatusOrange)
                        Spacer(Modifier.width(8.dp))
                        Text("Current Hours: ${uiState.currentHours} Hrs", fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(16.dp))
                    OutlinedTextField(
                        value = uiState.newHours,
                        onValueChange = viewModel::onHoursChanged,
                        label = { Text("New Hour Reading") },
                        isError = uiState.hoursError != null,
                        supportingText = uiState.hoursError?.let { { Text(it) } },
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number)
                    )
                }
            }

            Button(
                onClick = { /* TODO: Submit */ },
                modifier = Modifier.fillMaxWidth().height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                shape = RoundedCornerShape(12.dp),
                enabled = uiState.kmError == null && uiState.hoursError == null && (uiState.newKm.isNotEmpty() || uiState.newHours.isNotEmpty())
            ) {
                Text("Update Readings", fontWeight = FontWeight.Bold)
            }
        }
    }
}
