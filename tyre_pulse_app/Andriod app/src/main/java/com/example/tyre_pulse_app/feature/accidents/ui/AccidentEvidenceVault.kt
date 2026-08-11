package com.example.tyre_pulse_app.feature.accidents.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

/**
 * Agent 05: Accident Evidence Vault.
 * Handles Photos, Audio Statements, and Witness Logs.
 */
@Composable
fun AccidentEvidenceVault() {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Incident Evidence", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            EvidenceTypeCard("Photos", Icons.Default.CameraAlt, Modifier.weight(1f))
            EvidenceTypeCard("Audio", Icons.Default.Mic, Modifier.weight(1f))
        }
        
        Spacer(Modifier.height(24.dp))
        
        Text("Witness Statements", fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = "",
            onValueChange = {},
            label = { Text("Witness Name & Contact") },
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
fun EvidenceTypeCard(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier = Modifier) {
    Card(modifier = modifier.height(100.dp)) {
        Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(icon, contentDescription = null, tint = YellowPrimary)
            Text(title, style = MaterialTheme.typography.labelMedium)
        }
    }
}
