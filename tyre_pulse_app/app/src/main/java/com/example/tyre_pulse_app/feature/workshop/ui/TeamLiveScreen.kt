package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.theme.*

@Composable
fun TeamLiveScreen() {
    Column(modifier = Modifier.fillMaxSize().background(OLED_Black).padding(20.dp)) {
        Text("TEAM PRODUCTIVITY LIVE", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold, color = YellowPrimary)
        Spacer(Modifier.height(24.dp))

        LazyVerticalGrid(columns = GridCells.Fixed(2), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            items(listOf("John T.", "Ahmed S.", "Musa B.", "Kevin L.")) { tech ->
                TechnicianStatusCard(tech)
            }
        }
    }
}

@Composable
fun TechnicianStatusCard(name: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = OLED_Card),
        shape = RoundedCornerShape(20.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(12.dp).clip(CircleShape).background(StatusGreen))
                Spacer(Modifier.width(8.dp))
                Text(name, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            Text("ACTIVE: Mixer 2841", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.6f))
            Text("ELAPSED: 45m", fontWeight = FontWeight.ExtraBold, color = YellowPrimary)
        }
    }
}
