package com.tyrepulse.inspector.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    vm: HomeViewModel,
    onSignedOut: () -> Unit,
) {
    val state by vm.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = { TopAppBar(title = { Text("TyrePulse Inspector") }) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when {
                state.loading -> {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(top = 48.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) { CircularProgressIndicator() }
                }

                !state.apiConfigured -> {
                    InfoCard(
                        title = "API not configured",
                        body = "Set tyrepulse.apiBaseUrl in local.properties to point at the " +
                            "TyrePulse Go API (e.g. http://10.0.2.2:8080 from the emulator). " +
                            "Until then, sign-in works but profile data can't be loaded.",
                    )
                }

                state.error != null -> {
                    InfoCard(title = "Couldn't load profile", body = state.error!!)
                    Button(onClick = vm::load) { Text("Retry") }
                }

                state.profile != null -> {
                    val p = state.profile!!
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(p.fullName ?: p.username ?: p.email ?: p.id,
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold)
                            Text("Role: ${p.role}", color = MaterialTheme.colorScheme.secondary)
                            p.site?.let { Text("Site: $it") }
                            p.country?.takeIf { it.isNotEmpty() }?.let { Text("Country: ${it.joinToString()}") }
                            Text("Status: ${if (p.approved && !p.locked) "Active" else "Restricted"}")
                        }
                    }
                    Text(
                        "This screen is served by the Go API (GET /api/v1/me) — the first " +
                            "native → backend round-trip. Inspection capture and offline sync " +
                            "land as those modules are cut over.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }

            OutlinedButton(
                onClick = { vm.signOut(onSignedOut) },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            ) { Text("Sign Out") }
        }
    }
}

@Composable
private fun InfoCard(title: String, body: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(body, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
