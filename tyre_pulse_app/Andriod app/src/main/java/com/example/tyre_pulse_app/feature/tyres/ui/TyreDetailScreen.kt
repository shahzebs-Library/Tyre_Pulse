package com.example.tyre_pulse_app.feature.tyres.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.SwapHoriz
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
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.designsystem.component.TPStatusChip
import com.example.tyre_pulse_app.core.model.Tyre
import com.example.tyre_pulse_app.core.model.TyreHistoryEvent
import com.example.tyre_pulse_app.core.model.TyreStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TyreDetailRoute(
    onBack: () -> Unit,
    onReplaceTyre: (String) -> Unit,
    viewModel: TyreDetailViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(uiState.tyre?.serialNumber ?: "Tyre Details") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        floatingActionButton = {
            if (uiState.tyre?.status == TyreStatus.FITTED) {
                ExtendedFloatingActionButton(
                    onClick = { onReplaceTyre(uiState.tyre!!.id) },
                    icon = { Icon(Icons.Default.SwapHoriz, contentDescription = null) },
                    text = { Text("Request Replacement") }
                )
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (uiState.isLoading) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else if (uiState.tyre != null) {
                TyreDetailContent(tyre = uiState.tyre!!, history = uiState.history)
            }
        }
    }
}

@Composable
private fun TyreDetailContent(tyre: Tyre, history: List<TyreHistoryEvent>) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        TyreIdentitySection(tyre)
        TyreStatusSection(tyre)
        TyreHistorySection(history)
    }
}

@Composable
private fun TyreIdentitySection(tyre: Tyre) {
    TPCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "Identity", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.height(12.dp))
            InfoRow(label = "Serial Number", value = tyre.serialNumber)
            InfoRow(label = "Brand", value = tyre.brand)
            InfoRow(label = "Pattern", value = tyre.pattern ?: "N/A")
            InfoRow(label = "Size", value = tyre.size ?: "N/A")
            tyre.barcode?.let { InfoRow(label = "Barcode", value = it) }
        }
    }
}

@Composable
private fun TyreStatusSection(tyre: Tyre) {
    TPCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(text = "Current Status", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(text = "Status", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                TPStatusChip(label = tyre.status.name, statusColor = MaterialTheme.colorScheme.primary)
            }
            Spacer(modifier = Modifier.height(8.dp))
            if (tyre.status == TyreStatus.FITTED) {
                InfoRow(label = "Current Asset", value = tyre.currentAssetNumber ?: "-")
                InfoRow(label = "Position", value = tyre.position ?: "-")
                InfoRow(label = "Installation KM", value = tyre.installationKm?.toString() ?: "-")
            }
        }
    }
}

@Composable
private fun TyreHistorySection(history: List<TyreHistoryEvent>) {
    TPCard {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.History, contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(8.dp))
                Text(text = "Event History", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            }
            Spacer(modifier = Modifier.height(12.dp))
            if (history.isEmpty()) {
                Text(text = "No history events recorded", style = MaterialTheme.typography.bodyMedium)
            } else {
                history.forEach { event ->
                    TyreHistoryItem(event)
                    if (event != history.last()) HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                }
            }
        }
    }
}

@Composable
private fun TyreHistoryItem(event: TyreHistoryEvent) {
    Column {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(text = event.type, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            Text(text = event.date, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        }
        Text(text = event.userName ?: "System", style = MaterialTheme.typography.bodySmall)
        event.assetNumber?.let {
            Text(text = "Asset: $it | Pos: ${event.position ?: "N/A"}", style = MaterialTheme.typography.bodySmall)
        }
        event.reason?.let {
            Text(text = "Reason: $it", style = MaterialTheme.typography.bodySmall, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(text = label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline, modifier = Modifier.weight(1f))
        Text(text = value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
    }
}
