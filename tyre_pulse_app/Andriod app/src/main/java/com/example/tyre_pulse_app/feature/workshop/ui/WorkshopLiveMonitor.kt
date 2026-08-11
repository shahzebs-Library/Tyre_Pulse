package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.theme.StatusGreen
import com.example.tyre_pulse_app.core.designsystem.theme.StatusOrange

/**
 * Agent 04: Workshop Live Monitor (Web Merge).
 * High-density bay tracking for large tablet displays.
 */
@Composable
fun WorkshopLiveMonitor() {
    val bays = listOf(
        BayStatus("Bay 01", "Mixer 2841", "In Progress", StatusOrange),
        BayStatus("Bay 02", "Pump 112", "Complete", StatusGreen),
        BayStatus("Bay 03", "N/A", "Idle", Color.Gray),
        BayStatus("Bay 04", "Truck T-09", "In Progress", StatusOrange)
    )

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Workshop Throughput", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(bays) { bay ->
                BayCard(bay)
            }
        }
    }
}

data class BayStatus(val name: String, val asset: String, val status: String, val color: Color)

@Composable
fun BayCard(bay: BayStatus) {
    Card(modifier = Modifier.height(140.dp)) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
            Text(bay.name, style = MaterialTheme.typography.labelSmall)
            Spacer(Modifier.height(8.dp))
            Text(bay.asset, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(bay.color.copy(alpha = 0.2f))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Text(bay.status, color = bay.color, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            }
        }
    }
}
