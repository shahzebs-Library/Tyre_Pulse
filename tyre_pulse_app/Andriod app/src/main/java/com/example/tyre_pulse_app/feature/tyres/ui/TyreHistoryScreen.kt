package com.example.tyre_pulse_app.feature.tyres.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

@Composable
fun TyreHistoryScreen(tyreId: String) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Tyre Lifecycle History", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Serial: $tyreId", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        
        Spacer(Modifier.height(24.dp))
        
        LazyColumn(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            items(listOf(
                "Installed" to "Mixer 2841 - FL",
                "Inspected" to "Condition: Good, Tread: 8mm",
                "Repaired" to "Puncture repair - Bay 02",
                "Purchased" to "New Bridgestone - Qiddiya Store"
            )) { (event, detail) ->
                TimelineItem(event, detail)
            }
        }
    }
}

@Composable
fun TimelineItem(event: String, detail: String) {
    Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(modifier = Modifier.size(12.dp).clip(CircleShape).background(YellowPrimary))
            Box(modifier = Modifier.width(2.dp).weight(1f).background(Color.Gray.copy(alpha = 0.3f)))
        }
        Spacer(Modifier.width(16.dp))
        Column(modifier = Modifier.padding(bottom = 24.dp)) {
            Text(event, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge)
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
        }
    }
}
