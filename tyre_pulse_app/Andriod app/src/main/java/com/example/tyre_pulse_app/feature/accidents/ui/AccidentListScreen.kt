package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.authentication.UserViewModel
import com.example.tyre_pulse_app.core.designsystem.component.TPCard
import com.example.tyre_pulse_app.core.designsystem.component.TPStatusChip
import com.example.tyre_pulse_app.core.designsystem.component.TPTopBar
import com.example.tyre_pulse_app.core.model.Accident
import com.example.tyre_pulse_app.core.model.AccidentStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccidentListRoute(
    onAccidentClick: (String) -> Unit,
    onReportAccident: () -> Unit,
    viewModel: AccidentListViewModel = hiltViewModel(),
    userViewModel: UserViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentWorkspace by userViewModel.currentWorkspace.collectAsState()

    Scaffold(
        topBar = {
            TPTopBar(
                title = "Accidents",
                currentWorkspace = currentWorkspace
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onReportAccident) {
                Icon(Icons.Default.Add, contentDescription = "Report Accident")
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (uiState.isLoading && uiState.accidents.isEmpty()) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(uiState.accidents, key = { it.id }) { accident ->
                        AccidentItem(accident = accident, onClick = { onAccidentClick(accident.id ?: "") })
                    }
                    if (uiState.accidents.isEmpty() && !uiState.isLoading) {
                        item {
                            Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Icon(Icons.Default.Warning, contentDescription = null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.outline)
                                    Spacer(Modifier.height(8.dp))
                                    Text("No accidents recorded")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AccidentItem(accident: Accident, onClick: () -> Unit) {
    TPCard(onClick = onClick) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(text = accident.accidentNumber ?: "Unassigned", style = MaterialTheme.typography.titleMedium)
                val statusColor = when (accident.status) {
                    AccidentStatus.CLOSED -> Color(0xFF2E7D32)
                    AccidentStatus.REPORTED, AccidentStatus.UNDER_REVIEW -> MaterialTheme.colorScheme.error
                    else -> Color(0xFFEF6C00)
                }
                TPStatusChip(label = accident.status.name, statusColor = statusColor)
            }
            Spacer(Modifier.height(8.dp))
            Text(text = "Asset: ${accident.assetNumber}", style = MaterialTheme.typography.bodyMedium)
            Text(text = accident.location ?: "Site unknown", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            Spacer(Modifier.height(4.dp))
            Text(text = accident.date, style = MaterialTheme.typography.labelSmall)
        }
    }
}
