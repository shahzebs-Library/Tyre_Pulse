package com.example.tyre_pulse_app.feature.assets.ui
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Info
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.StatusGreen
import com.example.tyre_pulse_app.core.designsystem.theme.StatusOrange
import com.example.tyre_pulse_app.core.designsystem.theme.StatusRed
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.AssetStatus
import com.example.tyre_pulse_app.feature.maintenance.ui.DueBand
import com.example.tyre_pulse_app.feature.maintenance.ui.PmPlan
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Rendered wherever a figure has never been recorded.
 *
 * A dash, not a zero. "0 km" reads as a brand-new vehicle; "-" reads as nobody has
 * written it down, which is the truth.
 */
private const val NOT_RECORDED = "-"

@Composable
fun AssetDetailRoute(
    assetId: String,
    onBack: () -> Unit,
    onInspect: (String) -> Unit,
    onUpdateOdometer: (String) -> Unit,
    viewModel: AssetDetailViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    
    AssetDetailScreen(
        assetId = assetId,
        uiState = uiState,
        onBack = onBack,
        onInspect = onInspect,
        onUpdateOdometer = onUpdateOdometer
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssetDetailScreen(assetId: String, uiState: AssetDetailUiState, onBack: () -> Unit, onInspect: (String) -> Unit, onUpdateOdometer: (String) -> Unit) {
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Overview", "Tyres", "Maintenance", "History")

    val snackbarHostState = remember { SnackbarHostState() }
    var isRefreshing by remember { mutableStateOf(false) }
    
    if (isRefreshing) {
        LaunchedEffect(true) {
            delay(1000)
            isRefreshing = false
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            Column {
                TopAppBar(
                    title = { Text(assetId, fontWeight = FontWeight.Bold) },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                )
                SecondaryScrollableTabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = MaterialTheme.colorScheme.surface,
                    edgePadding = 16.dp,
                    divider = {}
                ) {
                    tabs.forEachIndexed { index, title ->
                        Tab(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            text = { Text(title, style = MaterialTheme.typography.labelLarge) }
                        )
                    }
                }
            }
        },
        bottomBar = {
            if (selectedTab == 0 || selectedTab == 1) {
                Surface(tonalElevation = 8.dp) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        // The odometer screen is a drill-down: it needs a real asset,
                        // and here we have one. It has no asset picker of its own,
                        // which is why it is not offered from the module hub.
                        OutlinedButton(
                            onClick = { onUpdateOdometer(assetId) },
                            modifier = Modifier.weight(1f).height(56.dp)
                        ) {
                            Text("Odometer", fontWeight = FontWeight.Bold)
                        }
                        Button(
                            onClick = { onInspect(assetId) },
                            modifier = Modifier.weight(1f).height(56.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black)
                        ) {
                            Text("Inspect Tyres", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true },
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                
        
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                when (selectedTab) {
                    0 -> AssetOverviewContent(uiState)
                    1 -> AssetTyreContent(uiState)
                    2 -> AssetMaintenanceContent(uiState)
                    3 -> AssetHistoryContent(uiState)
                }
            }
            
        }
    }
}

@Composable
fun AssetOverviewContent(uiState: AssetDetailUiState) {
    Column(modifier = Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        when {
            uiState.isLoading -> LoadingBlock()
            uiState.error != null -> ErrorBlock(uiState.error!!)
            uiState.asset == null -> EmptyBlock("This asset could not be found in the fleet register.")
            else -> {
                AssetHeaderSection(uiState.asset)
                MetricsGrid(uiState)
                AssetFactsCard(uiState)
            }
        }
    }
}

/**
 * The tyres recorded against this asset.
 *
 * WHY THERE IS NO VEHICLE DIAGRAM HERE ANY MORE. This tab used to render
 * `VehicleDiagram3D` fed by four hard-coded tyres - "SN-1001" Michelin, "SN-1003"
 * Bridgestone marked "Critical" - shown identically for every asset in the fleet.
 * A wheel painted red is a maintenance instruction, and that one was based on
 * nothing.
 *
 * The diagram is not simply re-pointed at the real rows because the two do not
 * speak the same language: `VehicleDiagram3D` matches wheels by FL / FR / RL1 /
 * RL2, while tyre_records records positions in the GCC convention the fitters use -
 * LHF1, RHCO, LHRI. Nothing in this app maps between them, and inventing a mapping
 * would put real tyres on the wrong wheels. A diagram where no position matched
 * would silently draw an empty vehicle and read as "no tyres fitted", which is
 * worse than showing none at all.
 *
 * So the real rows are listed with the position exactly as recorded. Condition is
 * absent on purpose: `tyre_records.risk_level` is NULL on all 11,205 rows, so
 * nothing here is measured well enough to colour.
 */
@Composable
fun AssetTyreContent(uiState: AssetDetailUiState) {
    Column(
        modifier = Modifier.padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Fitted Tyres", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

        when {
            uiState.tyresLoading -> LoadingBlock()
            uiState.tyresError != null -> ErrorBlock(uiState.tyresError!!)
            uiState.fittedTyres.isEmpty() ->
                EmptyBlock("No tyres are recorded as fitted to this asset.")
            else -> {
                NoteBlock(
                    "Tyre condition is not recorded in this fleet, so no wheel is shown as good or critical."
                )
                uiState.fittedTyres.forEach { tyre -> TyreRowCard(tyre) }
                if (uiState.tyresTruncated) {
                    NoteBlock("Showing the most recent records only. Older fitments may not be listed.")
                }
            }
        }
    }
}

/**
 * Preventive maintenance for this asset, from pm_programs.
 *
 * WHAT THIS REPLACED: a heading reading "Upcoming Service" with nothing beneath it
 * and no explanation, which reads as a screen that failed to load.
 */
@Composable
fun AssetMaintenanceContent(uiState: AssetDetailUiState) {
    Column(
        modifier = Modifier.padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Preventive Maintenance", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

        when {
            uiState.plansLoading -> LoadingBlock()
            uiState.plansError != null -> ErrorBlock(uiState.plansError!!)
            uiState.plans.isEmpty() ->
                EmptyBlock("No maintenance programme is set up for this asset.")
            else -> uiState.plans.forEach { plan -> PmPlanCard(plan) }
        }
    }
}

/**
 * The asset's tyre history - every fitment episode that has ended.
 *
 * WHAT THIS REPLACED: a heading reading "Full Audit Trail" over an empty column.
 * This is not the whole audit trail and does not claim to be; it is the record this
 * app can actually read, and the wording says so.
 */
@Composable
fun AssetHistoryContent(uiState: AssetDetailUiState) {
    Column(
        modifier = Modifier.padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Tyre History", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)

        when {
            uiState.tyresLoading -> LoadingBlock()
            uiState.tyresError != null -> ErrorBlock(uiState.tyresError!!)
            uiState.pastTyres.isEmpty() ->
                EmptyBlock("No removed tyres are recorded against this asset.")
            else -> {
                NoteBlock("Tyre fitments and removals recorded for this asset. Other work is not included.")
                uiState.pastTyres.forEach { tyre -> TyreRowCard(tyre) }
            }
        }
    }
}

@Composable
fun TyreRowCard(tyre: AssetTyreRow) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    tyre.position ?: "Position not recorded",
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.bodyLarge,
                )
                Spacer(Modifier.weight(1f))
                if (tyre.isFitted) StatusChip("Fitted", StatusGreen) else StatusChip("Removed", MaterialTheme.colorScheme.outline)
            }
            Text(
                tyre.serial ?: "Serial not recorded",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val spec = listOfNotNull(tyre.brand, tyre.size).joinToString(" - ")
            Text(
                spec.ifBlank { "Brand and size not recorded" },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
            DetailLine("Fitted", tyre.fittedOn ?: NOT_RECORDED)
            if (!tyre.isFitted) {
                DetailLine("Removed", tyre.removedOn ?: NOT_RECORDED)
                DetailLine("Reason", tyre.removalReason ?: NOT_RECORDED)
            }
            DetailLine("Distance run", tyre.totalKm?.let { "${it.toLong()} km" } ?: NOT_RECORDED)
        }
    }
}

@Composable
fun PmPlanCard(plan: PmPlan) {
    val (label, tone) = when (plan.band) {
        DueBand.OVERDUE -> "Overdue" to StatusRed
        DueBand.DUE_SOON -> "Due soon" to StatusOrange
        DueBand.OK -> "Scheduled" to StatusGreen
        // A programme with no date is not "due now" and must never be coloured as if
        // it were. It reads as unknown, which is what it is.
        DueBand.NO_DATE -> "No due date recorded" to MaterialTheme.colorScheme.outline
    }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(plan.name, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.weight(1f))
                StatusChip(label, tone)
            }
            DetailLine("Next due", plan.nextDue ?: NOT_RECORDED)
            DetailLine(
                "Days to due",
                plan.daysToDue?.let { if (it < 0) "${-it} days overdue" else "$it days" } ?: NOT_RECORDED,
            )
            plan.nextDueMeter?.let {
                DetailLine("Due at meter", "${it.toLong()} ${plan.meterSource ?: ""}".trim())
            }
            DetailLine("Site", plan.site ?: NOT_RECORDED)
        }
    }
}

@Composable
fun DetailLine(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.outline)
        Spacer(Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun LoadingBlock() {
    Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = YellowPrimary, strokeWidth = 3.dp)
    }
}

/** A failure. Deliberately worded and coloured differently from "nothing recorded". */
@Composable
fun ErrorBlock(message: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
            Spacer(Modifier.width(12.dp))
            Column {
                Text("Could not load this", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onErrorContainer)
                Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
    }
}

/** Nothing has been recorded. A real answer, not a failure. */
@Composable
fun EmptyBlock(message: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Info, contentDescription = null, tint = MaterialTheme.colorScheme.outline)
            Spacer(Modifier.width(12.dp))
            Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun NoteBlock(message: String) {
    Text(
        message,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.outline,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * WHAT THIS REPLACED. This card printed "Mixer 2841" / "Mercedes-Benz Actros 4141"
 * / "Active" for EVERY asset in the fleet, whichever one had been opened. It now
 * shows the asset that was actually loaded, and says so when a field is empty.
 */
@Composable
fun AssetHeaderSection(asset: Asset) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(64.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant))
            Spacer(Modifier.width(16.dp))
            Column {
                Text(asset.assetNumber, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                val makeModel = listOfNotNull(
                    asset.make?.takeIf { it.isNotBlank() },
                    asset.model?.takeIf { it.isNotBlank() },
                ).joinToString(" ")
                Text(
                    makeModel.ifBlank { asset.type?.takeIf { it.isNotBlank() } ?: "Make and model not recorded" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
                StatusChip(asset.status.name, statusTone(asset.status))
            }
        }
    }
}

private fun statusTone(status: AssetStatus): Color = when (status) {
    AssetStatus.ACTIVE -> StatusGreen
    AssetStatus.MAINTENANCE -> StatusOrange
    AssetStatus.OUT_OF_SERVICE, AssetStatus.ACCIDENT -> StatusRed
}

@Composable
fun AssetFactsCard(uiState: AssetDetailUiState) {
    val asset = uiState.asset ?: return
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Register", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            DetailLine("Registration", asset.plateNumber ?: NOT_RECORDED)
            DetailLine("Type", asset.type ?: NOT_RECORDED)
            DetailLine("Category", asset.category ?: NOT_RECORDED)
            DetailLine("Site", asset.site ?: NOT_RECORDED)
            DetailLine("Last inspected", asset.latestInspectionDate?.take(10) ?: NOT_RECORDED)
        }
    }
}

@Composable
fun StatusChip(text: String, color: Color) {
    Surface(
        color = color.copy(alpha = 0.1f),
        shape = RoundedCornerShape(4.dp),
        modifier = Modifier.padding(top = 4.dp)
    ) {
        Text(text, color = color, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

/**
 * Odometer and hour meter.
 *
 * WHAT THIS REPLACED: "125,420 KM" and "3,640 Hrs", hard-coded and shown for every
 * asset in the fleet.
 *
 * The odometer prefers the register's own figure and falls back to the newest row
 * in odometer_logs, which is where the mobile meter-log screen writes. Where
 * neither exists the tile reads "-", never 0: a zero would say this machine has
 * never turned a wheel.
 */
@Composable
fun MetricsGrid(uiState: AssetDetailUiState) {
    val asset = uiState.asset
    val km = asset?.currentKm?.toDouble() ?: uiState.latestOdometerKm
    val hours = asset?.hourMeter

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricCard("Odometer", km?.let { "${it.toLong()} km" } ?: NOT_RECORDED, Modifier.weight(1f))
            MetricCard("Hours", hours?.let { "$it hrs" } ?: NOT_RECORDED, Modifier.weight(1f))
        }
        uiState.latestOdometerDate?.let {
            NoteBlock("Last meter reading recorded $it.")
        }
    }
}

@Composable
fun MetricCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            Text(value, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
        }
    }
}
