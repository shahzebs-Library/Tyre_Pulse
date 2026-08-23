package com.example.tyre_pulse_app.feature.calendar.ui
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.StatusBlue
import com.example.tyre_pulse_app.core.designsystem.theme.StatusGreen
import com.example.tyre_pulse_app.core.designsystem.theme.StatusOrange
import com.example.tyre_pulse_app.core.designsystem.theme.StatusRed
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import com.example.tyre_pulse_app.feature.maintenance.ui.DueBand
import com.example.tyre_pulse_app.feature.maintenance.ui.MaintenanceUiState
import com.example.tyre_pulse_app.feature.maintenance.ui.MaintenanceViewModel
import com.example.tyre_pulse_app.feature.maintenance.ui.PmPlan

import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll

/**
 * The maintenance schedule.
 *
 * WHAT THIS REPLACED. The screen drew a strip of five hard-coded days - 20 to 24
 * May, with the 20th permanently highlighted whatever today's date was - and
 * beneath it two identical invented jobs, "Mixer 2841 - 100k Service, 09:00 AM,
 * Bay 02". Nothing on it moved, nothing on it was real, and a fitter reading it was
 * being handed a work list for a vehicle and a bay that may not exist.
 *
 * It now reads public.pm_programs through the SAME view model the Maintenance
 * module uses, so the two screens can never disagree about what is due. Programmes
 * arrive already sorted soonest-first with nulls last, and are grouped by their due
 * date rather than by a made-up calendar.
 *
 * THE DAY STRIP IS GONE ON PURPOSE. pm_programs records a due DATE and no time of
 * day, so a "09:00 AM / Bay 02" line cannot be reconstructed from anything. A
 * calendar grid would also imply the schedule is dense enough to fill days; it is
 * not, and an empty grid reads as a broken screen rather than an empty diary.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaintenanceCalendarScreen(
    viewModel: MaintenanceViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var isRefreshing by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    if (isRefreshing) {
        LaunchedEffect(true) {
            viewModel.load()
            isRefreshing = false
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = { TopAppBar(title = { Text("Calendar", fontWeight = FontWeight.Bold) }) }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true },
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                
        
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp)
            ) {
                Text("Maintenance Schedule", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(16.dp))

                when {
                    uiState.isLoading -> CalendarLoading()
                    uiState.error != null -> CalendarError(uiState.error!!)
                    uiState.plans.isEmpty() -> CalendarEmpty()
                    else -> ScheduleList(uiState)
                }
            }


        }
    }
}

/**
 * Programmes grouped by the day they fall due.
 *
 * Programmes carrying NO due date are kept and shown last under their own heading.
 * Dropping them would hide real work; sorting them in with a substituted date would
 * assert a due date nobody set.
 */
@Composable
private fun ScheduleList(uiState: MaintenanceUiState) {
    val dated = uiState.plans.filter { !it.nextDue.isNullOrBlank() }
    val undated = uiState.plans.filter { it.nextDue.isNullOrBlank() }

    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        if (uiState.overdue > 0 || uiState.dueSoon > 0) {
            Text(
                "${uiState.overdue} overdue, ${uiState.dueSoon} due within the next two weeks.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }

        dated.groupBy { it.nextDue!! }
            .toSortedMap()
            .forEach { (day, plans) ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(day, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    plans.forEach { ScheduleCard(it) }
                }
            }

        if (undated.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "No due date recorded",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.outline,
                )
                undated.forEach { ScheduleCard(it) }
            }
        }
    }
}

@Composable
private fun ScheduleCard(plan: PmPlan) {
    // A programme with no date is grey, never amber. Colouring it as due would put a
    // missing field at the top of somebody's work list.
    val tone = when (plan.band) {
        DueBand.OVERDUE -> StatusRed
        DueBand.DUE_SOON -> StatusOrange
        DueBand.OK -> StatusGreen
        DueBand.NO_DATE -> StatusBlue
    }
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.width(4.dp).height(44.dp).background(tone))
            Spacer(Modifier.width(12.dp))
            Column {
                Text(plan.name, fontWeight = FontWeight.Bold)
                Text(
                    plan.assetNo?.takeIf { it.isNotBlank() } ?: "No asset recorded",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                // The table records a due DATE and no time of day, so none is shown.
                val detail = listOfNotNull(
                    plan.daysToDue?.let { if (it < 0) "${-it} days overdue" else "in $it days" },
                    plan.site?.takeIf { it.isNotBlank() },
                ).joinToString(" - ")
                if (detail.isNotBlank()) {
                    Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                }
            }
        }
    }
}

@Composable
private fun CalendarLoading() {
    Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = YellowPrimary, strokeWidth = 3.dp)
    }
}

/** A failed read. Worded so it can never be mistaken for an empty schedule. */
@Composable
private fun CalendarError(message: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(
                    "Could not load the schedule",
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
                Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
    }
}

/** Genuinely nothing scheduled - the opposite statement from the error above. */
@Composable
private fun CalendarEmpty() {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Info, contentDescription = null, tint = MaterialTheme.colorScheme.outline)
            Spacer(Modifier.width(12.dp))
            Text(
                "No active maintenance programmes are scheduled.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
