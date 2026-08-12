package com.example.tyre_pulse_app.feature.admin.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun UserSessionScreen() {
    val users = listOf("John Technician" to "Active", "Ahmed Supervisor" to "Active", "Mike Ross" to "Offline")
    
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("User Sessions", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(users) { (name, status) ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Person, contentDescription = null)
                        Spacer(Modifier.width(16.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(name, fontWeight = FontWeight.Bold)
                            Text(status, style = MaterialTheme.typography.bodySmall)
                        }
                        Button(onClick = { /* Force Logout */ }) { Text("Kick") }
                    }
                }
            }
        }
    }
}
