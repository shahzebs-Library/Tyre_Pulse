package com.example.tyre_pulse_app.feature.tyres.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TyreReplacementScreen(tyreId: String, onBack: () -> Unit) {
    var step by remember { mutableStateOf(1) }
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Tyre Replacement", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp)) {
            Text("Step $step of 2", style = MaterialTheme.typography.labelSmall)
            
            if (step == 1) {
                RemovalStep(tyreId) { step = 2 }
            } else {
                InstallationStep { onBack() }
            }
        }
    }
}

@Composable
fun RemovalStep(tyreId: String, onNext: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Remove Tyre: $tyreId", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = "Wear & Tear",
            onValueChange = {},
            label = { Text("Removal Reason") },
            modifier = Modifier.fillMaxWidth()
        )
        Button(onClick = onNext, modifier = Modifier.fillMaxWidth().height(56.dp)) {
            Text("Confirm Removal")
        }
    }
}

@Composable
fun InstallationStep(onFinish: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Install New Tyre", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = "",
            onValueChange = {},
            label = { Text("New Serial Number") },
            modifier = Modifier.fillMaxWidth()
        )
        Button(
            onClick = onFinish,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black)
        ) {
            Text("Complete Installation")
        }
    }
}
