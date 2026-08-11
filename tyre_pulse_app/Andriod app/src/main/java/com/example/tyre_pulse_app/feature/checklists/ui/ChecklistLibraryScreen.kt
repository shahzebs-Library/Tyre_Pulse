package com.example.tyre_pulse_app.feature.checklists.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

@Composable
fun ChecklistLibraryScreen(
    onStartChecklist: (String) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Checklist Library", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(24.dp))
        
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(listOf(
                "driver-dvir" to "Driver Daily Inspection (DVIR)",
                "shift-handover" to "Shift Handover Checklist",
                "post-maint" to "Post-Maintenance Verification",
                "gate-pass" to "Vehicle Gate Pass / Release"
            )) { (id, name) ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Assignment, contentDescription = null, tint = YellowPrimary)
                        Spacer(Modifier.width(16.dp))
                        Text(name, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Button(onClick = { onStartChecklist(id) }) { Text("Start") }
                    }
                }
            }
        }
    }
}
