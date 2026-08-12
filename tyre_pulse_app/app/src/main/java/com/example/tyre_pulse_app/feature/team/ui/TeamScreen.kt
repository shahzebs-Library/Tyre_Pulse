package com.example.tyre_pulse_app.feature.team.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Group
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamRoute(viewModel: TeamViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Team Management", fontWeight = FontWeight.Bold) }) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                Text("Live Technician Status", style = MaterialTheme.typography.titleMedium, color = com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary)
            }
            items(uiState.members) { tech ->
                TechnicianCard(tech)
            }
        }
    }
}

@Composable
fun TechnicianCard(tech: TechnicianStatus) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(40.dp).clip(CircleShape).background(Color(tech.color).copy(alpha = 0.1f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Group, contentDescription = null, tint = Color(tech.color))
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(tech.name, fontWeight = FontWeight.Bold)
                Text(tech.status, style = MaterialTheme.typography.bodySmall, color = Color(tech.color))
            }
            if (tech.activeJob != "N/A") {
                Column(horizontalAlignment = Alignment.End) {
                    Text("Working on", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                    Text(tech.activeJob, fontWeight = FontWeight.ExtraBold)
                }
            }
        }
    }
}
