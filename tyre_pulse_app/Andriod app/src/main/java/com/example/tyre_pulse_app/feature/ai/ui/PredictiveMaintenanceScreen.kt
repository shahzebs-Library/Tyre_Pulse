package com.example.tyre_pulse_app.feature.ai.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.theme.StatusOrange
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

@Composable
fun PredictiveMaintenanceScreen() {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = YellowPrimary)
            Spacer(Modifier.width(12.dp))
            Text("AI Maintenance Predictor", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
        
        Spacer(Modifier.height(24.dp))
        
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("High Risk Tyres (AI Predicted)", fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(16.dp))
                
                repeat(3) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column {
                            Text("Mixer 2841 - Rear Left", style = MaterialTheme.typography.bodyLarge)
                            Text("Est. Failure: 12 days", style = MaterialTheme.typography.bodySmall, color = StatusOrange)
                        }
                        Text("92% Risk", fontWeight = FontWeight.ExtraBold, color = StatusOrange)
                    }
                    Divider()
                }
            }
        }
    }
}
