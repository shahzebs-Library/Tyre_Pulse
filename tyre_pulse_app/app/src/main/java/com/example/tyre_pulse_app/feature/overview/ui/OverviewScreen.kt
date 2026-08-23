package com.example.tyre_pulse_app.feature.overview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.feature.overview.model.BreakdownRow
import com.example.tyre_pulse_app.feature.overview.model.CountryScope
import com.example.tyre_pulse_app.feature.overview.model.OverviewPeriod
import com.example.tyre_pulse_app.feature.overview.model.OverviewSnapshot
import com.example.tyre_pulse_app.feature.overview.model.RiskCoverage
import com.example.tyre_pulse_app.feature.overview.model.SpendFigure
import com.example.tyre_pulse_app.feature.overview.model.compactNumber
import com.example.tyre_pulse_app.feature.overview.model.formatMoney

/**
 * Fleet Overview - the period view of the tyre register.
 *
 * Reads one server-aggregated row (`get_mobile_analytics`); see
 * [OverviewViewModel] for why it does not page `tyre_records` onto the device,
 * and for how this screen is kept distinct from Fleet Analytics.
 *
 * TWO HONESTY RULES THIS SCREEN IS BUILT AROUND:
 *
 * 1. `tyre_records.risk_level` is not populated on any row, so the at-risk count
 *    is UNMEASURED. It renders as a dash and says the field is not recorded. A 0
 *    there would assert that no tyre in the fleet needs attention.
 *
 * 2. Costs are held in SAR, AED and EGP. With no country scoped, this screen
 *    renders NO money at all - not the headline, not a site row, not a brand row -
 *    and says why. A blended total is not an amount of money.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OverviewRoute(
    onBack: () -> Unit,
    viewModel: OverviewViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snapshot = uiState.snapshot

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Fleet Overview", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.load() }) {
                        Icon(Icons.Default.Sync, contentDescription = "Reload")
                    }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = uiState.isLoading,
            onRefresh = { viewModel.load() },
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    ScopeCard(
                        period = uiState.period,
                        country = uiState.country,
                        site = uiState.site,
                        siteOptions = snapshot?.siteOptions.orEmpty(),
                        windowLabel = uiState.windowLabel,
                        showClear = uiState.hasFilters,
                        onPeriod = viewModel::setPeriod,
                        onCountry = viewModel::setCountry,
                        onSite = viewModel::setSite,
                        onClear = viewModel::clearFilters,
                    )
                }

                // "We could not load it" and "there is nothing here" are opposite
                // statements. The error keeps whatever figures last loaded on
                // screen and labels them as stale rather than blanking them.
                uiState.error?.let { message ->
                    item {
                        Notice(
                            icon = Icons.Default.ErrorOutline,
                            tone = MaterialTheme.colorScheme.error,
                            title = "Could not load the fleet overview",
                            body = if (snapshot == null) message
                            else "$message\n\nThe figures below are the last ones that loaded and may be out of date.",
                        )
                    }
                }

                if (snapshot == null) {
                    if (uiState.isLoading) {
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(220.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    CircularProgressIndicator()
                                    Spacer(Modifier.height(12.dp))
                                    Text(
                                        "Reading the fleet summary",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.outline,
                                    )
                                }
                            }
                        }
                    }
                    return@LazyColumn
                }

                if (snapshot.isEmpty) {
                    item {
                        Notice(
                            icon = Icons.Default.Inbox,
                            tone = MaterialTheme.colorScheme.outline,
                            title = "No tyre records in this scope",
                            body = "The register holds nothing for this period, country " +
                                "and site. This is a real result, not a failed read - " +
                                "widen the window to see more.",
                            actionLabel = if (uiState.period != OverviewPeriod.ALL_TIME) {
                                "Show all time"
                            } else {
                                null
                            },
                            onAction = { viewModel.setPeriod(OverviewPeriod.ALL_TIME) },
                        )
                    }
                    return@LazyColumn
                }

                item { KpiGrid(snapshot) }
                item { SpendCard(snapshot.spend, uiState.windowLabel) }
                item { RiskCard(snapshot.risk) }

                item {
                    BreakdownCard(
                        icon = Icons.Default.LocationOn,
                        title = "Where the tyres went",
                        emptyBody = "No site is recorded against the tyre records in this scope.",
                        rows = snapshot.topSites,
                    )
                }
                item {
                    BreakdownCard(
                        icon = Icons.Default.Category,
                        title = "Which brands",
                        emptyBody = "No brand is recorded against the tyre records in this scope.",
                        rows = snapshot.topBrands,
                    )
                }

                item { FooterNote(snapshot.generatedAt) }
            }
        }
    }
}

/* ---------------------------------------------------------------------------- */
/* Scope                                                                        */
/* ---------------------------------------------------------------------------- */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ScopeCard(
    period: OverviewPeriod,
    country: CountryScope,
    site: String?,
    siteOptions: List<String>,
    windowLabel: String,
    showClear: Boolean,
    onPeriod: (OverviewPeriod) -> Unit,
    onCountry: (CountryScope) -> Unit,
    onSite: (String?) -> Unit,
    onClear: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Period",
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.weight(1f),
                )
                if (showClear) {
                    TextButton(onClick = onClear) { Text("Reset") }
                }
            }
            ChipRow {
                OverviewPeriod.entries.forEach { option ->
                    FilterChip(
                        selected = option == period,
                        onClick = { onPeriod(option) },
                        label = { Text(option.label) },
                    )
                    Spacer(Modifier.width(8.dp))
                }
            }
            // Named in words so a figure read off this screen can be repeated
            // later without guessing which months it covered.
            Text(
                windowLabel,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )

            Text("Country", style = MaterialTheme.typography.labelLarge)
            ChipRow {
                CountryScope.options.forEach { option ->
                    FilterChip(
                        selected = option == country,
                        onClick = { onCountry(option) },
                        label = { Text(option.label) },
                    )
                    Spacer(Modifier.width(8.dp))
                }
            }
            Text(
                "Money is shown only for a single country, in that country's own currency.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )

            // Offered only when the server actually returned sites for this scope.
            // A picker built from a guessed list would offer choices that match
            // nothing and read as missing data.
            if (siteOptions.isNotEmpty()) {
                Text("Site", style = MaterialTheme.typography.labelLarge)
                ChipRow {
                    FilterChip(
                        selected = site == null,
                        onClick = { onSite(null) },
                        label = { Text("All sites") },
                    )
                    Spacer(Modifier.width(8.dp))
                    siteOptions.forEach { option ->
                        FilterChip(
                            selected = site == option,
                            onClick = { onSite(if (site == option) null else option) },
                            label = { Text(option) },
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun ChipRow(content: @Composable () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        content()
    }
}

/* ---------------------------------------------------------------------------- */
/* KPIs                                                                         */
/* ---------------------------------------------------------------------------- */

@Composable
private fun KpiGrid(snapshot: OverviewSnapshot) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            KpiTile(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.Inventory,
                label = "Tyre records",
                value = compactNumber(snapshot.tyreRecords),
            )
            KpiTile(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.DirectionsCar,
                label = "Vehicles",
                value = compactNumber(snapshot.vehicles),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // THE ONE THAT MATTERS. risk_level is not populated on any tyre
            // record, so there is no count to give. A dash plus "Not recorded"
            // says we did not measure it; a 0 would say the fleet is clean.
            val highRisk = snapshot.risk.highRisk
            KpiTile(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.Warning,
                label = "At-risk tyres",
                value = highRisk?.let { compactNumber(it) } ?: "-",
                note = if (highRisk == null) "Not recorded" else null,
            )
            KpiTile(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.Receipt,
                label = "Tyre spend",
                value = when (val spend = snapshot.spend) {
                    is SpendFigure.Amount -> formatMoney(spend.value, spend.currency)
                    else -> "-"
                },
                note = when (snapshot.spend) {
                    is SpendFigure.AcrossCountries -> "Pick a country"
                    is SpendFigure.NotRecorded -> "Not recorded"
                    else -> null
                },
            )
        }
    }
}

@Composable
private fun KpiTile(
    modifier: Modifier = Modifier,
    icon: ImageVector,
    label: String,
    value: String,
    note: String? = null,
) {
    Card(modifier = modifier) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    label,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                value,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                // A dash is not a figure, so it must not be styled like one.
                color = if (note == null) {
                    MaterialTheme.colorScheme.onSurface
                } else {
                    MaterialTheme.colorScheme.outline
                },
            )
            note?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}

/* ---------------------------------------------------------------------------- */
/* Spend                                                                        */
/* ---------------------------------------------------------------------------- */

@Composable
private fun SpendCard(spend: SpendFigure, windowLabel: String) {
    when (spend) {
        is SpendFigure.Amount -> Notice(
            icon = Icons.Default.Receipt,
            tone = MaterialTheme.colorScheme.primary,
            title = "${formatMoney(spend.value, spend.currency)} in ${spend.country}",
            body = "Tyre spend recorded for $windowLabel, in ${spend.country}'s own " +
                "currency. Only this country is included - figures from other " +
                "countries are held in different currencies and are never added to it.",
        )

        // Withheld on purpose. The reason is stated in full, because a missing
        // number with no explanation reads as a broken screen.
        is SpendFigure.AcrossCountries -> Notice(
            icon = Icons.Default.Info,
            tone = MaterialTheme.colorScheme.outline,
            title = "Spend is not shown across countries",
            body = "Tyre costs are recorded in SAR, AED and EGP. Adding them " +
                "together would produce a number that is not an amount of money, " +
                "so no total is shown. Choose a single country above to see its " +
                "spend in its own currency.",
        )

        is SpendFigure.NotRecorded -> Notice(
            icon = Icons.Default.Info,
            tone = MaterialTheme.colorScheme.outline,
            title = "No tyre cost recorded for ${spend.country}",
            body = "The tyre records in this scope carry no price, so there is " +
                "nothing to total. This is a gap in the records, not a spend of zero.",
        )
    }
}

/* ---------------------------------------------------------------------------- */
/* Risk                                                                         */
/* ---------------------------------------------------------------------------- */

@Composable
private fun RiskCard(risk: RiskCoverage) {
    if (!risk.isMeasured) {
        Notice(
            icon = Icons.Default.Warning,
            tone = MaterialTheme.colorScheme.error,
            title = "Tyre risk is not being recorded",
            body = "None of the ${compactNumber(risk.total)} tyre records in this " +
                "scope carries a risk rating - the risk_level field is not " +
                "populated in the register, so there is no at-risk count to give. " +
                "Read this as unmeasured, not as a fleet with no risk.",
        )
        return
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SectionTitle(Icons.Default.Warning, "Risk bands")
            val max = risk.bands.maxOfOrNull { it.count } ?: 1
            risk.bands.forEach { band ->
                BarRow(
                    label = band.label,
                    countLabel = compactNumber(band.count),
                    fraction = band.count.toFloat() / max.toFloat(),
                    color = riskColor(band.label),
                    trailing = null,
                )
            }
            // Partial coverage has to be stated, or the bands read as the whole fleet.
            if (risk.unrated > 0) {
                HorizontalDivider()
                Text(
                    "${compactNumber(risk.unrated)} of ${compactNumber(risk.total)} " +
                        "tyre records carry no rating and are in none of these bands" +
                        (risk.ratedPercent?.let { " (${it}% rated)." } ?: "."),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}

@Composable
private fun riskColor(label: String): Color = when (label.trim().lowercase()) {
    "critical", "severe", "urgent" -> MaterialTheme.colorScheme.error
    "high" -> MaterialTheme.colorScheme.error
    "medium", "warning" -> MaterialTheme.colorScheme.tertiary
    "low", "good" -> MaterialTheme.colorScheme.primary
    else -> MaterialTheme.colorScheme.outline
}

/* ---------------------------------------------------------------------------- */
/* Breakdowns                                                                   */
/* ---------------------------------------------------------------------------- */

@Composable
private fun BreakdownCard(
    icon: ImageVector,
    title: String,
    emptyBody: String,
    rows: List<BreakdownRow>,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SectionTitle(icon, title)
            if (rows.isEmpty()) {
                Text(
                    emptyBody,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
                return@Column
            }
            val max = rows.maxOfOrNull { it.count } ?: 1
            rows.forEach { row ->
                BarRow(
                    label = row.label,
                    countLabel = compactNumber(row.count),
                    fraction = row.count.toFloat() / max.toFloat(),
                    color = MaterialTheme.colorScheme.primary,
                    // Cost is null whenever no country is scoped, so a bar can
                    // never carry a blended amount.
                    trailing = row.cost?.let { compactNumber(it) },
                )
            }
        }
    }
}

@Composable
private fun BarRow(
    label: String,
    countLabel: String,
    fraction: Float,
    color: Color,
    trailing: String?,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                label,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
                maxLines = 1,
            )
            trailing?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                )
                Spacer(Modifier.width(10.dp))
            }
            Text(countLabel, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(4.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction.coerceIn(0f, 1f))
                    .height(8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(color),
            )
        }
    }
}

/* ---------------------------------------------------------------------------- */
/* Shared pieces                                                                */
/* ---------------------------------------------------------------------------- */

@Composable
private fun SectionTitle(icon: ImageVector, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Notice(
    icon: ImageVector,
    tone: Color,
    title: String,
    body: String,
    actionLabel: String? = null,
    onAction: () -> Unit = {},
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(16.dp)) {
            Icon(icon, contentDescription = null, tint = tone, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Bold, color = tone)
                Spacer(Modifier.height(4.dp))
                Text(
                    body,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
                if (actionLabel != null) {
                    TextButton(
                        onClick = onAction,
                        contentPadding = PaddingValues(0.dp),
                    ) {
                        Text(actionLabel)
                    }
                }
            }
        }
    }
}

@Composable
private fun FooterNote(generatedAt: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            "Every figure here is aggregated on the server from the tyre register. " +
                "Live risk bands and inspection activity are on Fleet Analytics; " +
                "this screen answers the period question - what was fitted, where, " +
                "on which brand, and what it cost.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        generatedAt?.let {
            Text(
                "Server generated $it",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}
