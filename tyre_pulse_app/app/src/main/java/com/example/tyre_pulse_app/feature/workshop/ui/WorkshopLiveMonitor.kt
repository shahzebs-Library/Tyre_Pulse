package com.example.tyre_pulse_app.feature.workshop.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Workshop bay monitor.
 *
 * WHAT THIS REPLACED, AND WHY NOTHING TOOK ITS PLACE. This screen rendered four
 * invented bays as if they were a live board:
 *
 *   Bay 01 - Mixer 2841 - In Progress
 *   Bay 02 - Pump 112   - Complete
 *   Bay 03 - N/A        - Idle
 *   Bay 04 - Truck T-09 - In Progress
 *
 * None of it came from anywhere. There is no bay in this system: no `workshop_bays`
 * table, no bay column on `work_orders`, and no bay API among the twenty-one
 * interfaces in `core/network/api`. A supervisor sending a vehicle to "Bay 02
 * because it just came free" would have been acting on a literal fiction, and the
 * board refreshed like a live one, so it never invited doubt.
 *
 * The fabricated grid is therefore DELETED rather than re-pointed. Re-pointing it at
 * work orders would have produced a jobs board wearing bay labels - a second
 * invention, and duplicated work that [WorkshopLiveScreen] already does honestly.
 *
 * WHEN BAYS BECOME REAL. This needs a bay register (an id, a site, and an occupancy
 * that something actually writes) plus an API over it. Until such a table exists
 * this screen must keep saying so. Do not restore the grid with sample rows.
 */
@Composable
fun WorkshopLiveMonitor() {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text(
            "Workshop Throughput",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(16.dp))

        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    Icons.Default.Info,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.outline,
                )
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Workshop bays are not tracked yet", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Nothing in this system records which bay a vehicle is in, " +
                            "so there is no bay occupancy to show. Job progress is on " +
                            "the workshop live board instead.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                }
            }
        }
    }
}
