package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

@Composable
fun WorkshopHomeScreen(
    onViewOrders: () -> Unit,
    onViewTeam: () -> Unit,
    onViewCalendar: () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Workshop Operations", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(24.dp))
        
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            WorkshopActionCard("Work Orders", Icons.Default.List, Modifier.weight(1f), onClick = onViewOrders)
            WorkshopActionCard("Live Team", Icons.Default.People, Modifier.weight(1f), onClick = onViewTeam)
        }
        
        Spacer(Modifier.height(16.dp))
        
        WorkshopActionCard("Maintenance Calendar", Icons.Default.Build, Modifier.fillMaxWidth(), onClick = onViewCalendar)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkshopActionCard(title: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = modifier.height(120.dp)) {
        Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, contentDescription = null, tint = YellowPrimary, modifier = Modifier.size(32.dp))
            Spacer(Modifier.height(8.dp))
            Text(title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
        }
    }
}
