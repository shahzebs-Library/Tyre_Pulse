package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DigitalInvoiceScreen(
    jobId: String? = "WO-9021",
    onClose: () -> Unit
) {
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(title = { Text("Invoice Generated") })
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                Icons.Default.CheckCircle,
                contentDescription = "Success",
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(100.dp)
            )
            Spacer(Modifier.height(24.dp))
            Text(
                text = "Job Complete!",
                style = MaterialTheme.typography.headlineMedium
            )
            Spacer(Modifier.height(16.dp))
            Card(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Receipt, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Invoice Sent to Accounting", style = MaterialTheme.typography.titleMedium)
                    }
                    Divider(Modifier.padding(vertical = 8.dp))
                    Text("Job ID: $jobId")
                    Text("Labor Hours: 3.5 hrs")
                    Text("Parts Deducted: 2 items")
                    Spacer(Modifier.height(16.dp))
                    Text("Total Cost: $450.00", style = MaterialTheme.typography.titleLarge)
                }
            }
            Spacer(Modifier.height(48.dp))
            Button(
                onClick = onClose,
                modifier = Modifier.fillMaxWidth().height(56.dp)
            ) {
                Text("Return to Dashboard")
            }
        }
    }
}
