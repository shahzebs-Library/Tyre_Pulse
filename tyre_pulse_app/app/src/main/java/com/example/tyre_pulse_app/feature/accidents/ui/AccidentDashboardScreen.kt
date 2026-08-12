package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.theme.StatusRed
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

@Composable
fun AccidentDashboardScreen(
    onReportAccident: () -> Unit,
    onCaseClick: (String) -> Unit
) {
    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = onReportAccident, containerColor = YellowPrimary) {
                Icon(Icons.Default.Add, contentDescription = "Report Accident", tint = Color.Black)
            }
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp)) {
            Text("Accident Center", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(16.dp))
            
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(listOf("ACC-2025-001", "ACC-2025-004")) { id ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(modifier = Modifier.size(8.dp).background(StatusRed))
                            Spacer(Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Case: $id", fontWeight = FontWeight.Bold)
                                Text("Status: Under Investigation", style = MaterialTheme.typography.bodySmall)
                            }
                            TextButton(onClick = { onCaseClick(id) }) { Text("Details") }
                        }
                    }
                }
            }
        }
    }
}
