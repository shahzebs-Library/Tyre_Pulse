package com.example.tyre_pulse_app.feature.admin.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * The admin hub.
 *
 * WHAT THIS REPLACED. The whole screen was a title, "System Oversight", and the
 * comment `// ... Metrics and settings navigation`. It was never registered as a
 * route, so nobody ever saw the stub - which is also why it stayed a stub.
 *
 * It is a hub rather than a dashboard on purpose: there are real admin screens
 * (people, sites, workshop activity) that were built and equally unreachable, and a
 * hub that opens them is worth more than a page of counts. No KPI tiles are invented
 * here to make it look substantial.
 *
 * ALSO DELETED WITH THIS CHANGE: SuperAdminScreen. Its entire content was two
 * switches hard-coded to `checked = false` with `onCheckedChange = {}` - labelled
 * "Global Sync Pause" and "Force Maintenance Mode", so an operator could believe they
 * had paused the fleet's sync - beside an "API Latency 142ms" and "Error Rate 0.02%"
 * that were string literals. Nothing in it was real, and system-wide overrides belong
 * in the web console that actually owns system_config, not on a phone.
 */
private data class AdminEntry(
    val title: String,
    val description: String,
    val icon: ImageVector,
    val route: String,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminDashboardScreen(
    onBack: () -> Unit,
    onOpen: (String) -> Unit,
) {
    // Icons taken from the set already used elsewhere in this app: an icon name that
    // does not resolve is a build failure found only in CI, and CI is the only
    // compiler available here.
    val entries = listOf(
        AdminEntry(
            "People",
            "Everyone on the account and their recorded role",
            Icons.Default.Group,
            "admin_users_route",
        ),
        AdminEntry(
            "Sites",
            "Sites the fleet register knows, with asset counts",
            Icons.Default.LocationOn,
            "admin_sites_route",
        ),
        AdminEntry(
            "Workshop activity",
            "Who is on shift and what was last recorded",
            Icons.Default.Settings,
            "team_live_route",
        ),
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Admin", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                // Said plainly rather than implied by an absence. These screens read
                // what the account is allowed to read - row visibility is enforced by
                // the database, not by hiding controls here.
                Text(
                    "You see only what your account is permitted to read.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
            items(entries) { entry ->
                Card(
                    modifier = Modifier.fillMaxWidth().clickable { onOpen(entry.route) }
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(entry.icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(16.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(entry.title, fontWeight = FontWeight.Bold)
                            Text(
                                entry.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.outline,
                            )
                        }
                        Icon(
                            Icons.Default.ChevronRight,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.outline,
                        )
                    }
                }
            }
        }
    }
}
