package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkOrderListScreen(onOrderClick: (String) -> Unit) {
    Scaffold(
        topBar = { TopAppBar(title = { Text("Work Orders", fontWeight = FontWeight.Bold) }) }
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp)) {
            // ... Categorized List stub
        }
    }
}
