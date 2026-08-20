package com.example.tyre_pulse_app.feature.settings.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.datastore.AppLanguage
import com.example.tyre_pulse_app.core.designsystem.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsRoute(
    onBack: () -> Unit
) {
    var darkMode by remember { mutableStateOf(false) }
    var notificationsEnabled by remember { mutableStateOf(true) }
    var offlineSync by remember { mutableStateOf(true) }
    var selectedLanguage by remember { mutableStateOf(AppLanguage.ENGLISH) }
    var showLanguagePicker by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings", fontWeight = FontWeight.ExtraBold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Appearance
            item { SectionHeader("APPEARANCE") }
            item {
                SettingsTile(
                    icon = Icons.Default.DarkMode,
                    title = "Dark Mode",
                    subtitle = "Enable OLED-optimised dark theme",
                    iconTint = MaterialTheme.colorScheme.primary
                ) {
                    Switch(checked = darkMode, onCheckedChange = { darkMode = it })
                }
            }

            // Language & Region
            item { SectionHeader("LANGUAGE & REGION") }
            item {
                SettingsTile(
                    icon = Icons.Default.Language,
                    title = "Display Language",
                    subtitle = " ()" +
                        if (selectedLanguage.isRtl) " · RTL" else "",
                    iconTint = StatusBlue,
                    onClick = { showLanguagePicker = true }
                ) {
                    Icon(Icons.Default.ChevronRight, null,
                        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f))
                }
            }

            // Language picker (inline)
            if (showLanguagePicker) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                    ) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Select Language", fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.titleSmall,
                                modifier = Modifier.padding(bottom = 8.dp))
                            AppLanguage.entries.forEach { lang ->
                                val isSelected = lang == selectedLanguage
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = 0.1f) else Color.Transparent)
                                        .border(
                                            if (isSelected) 1.dp else 0.dp,
                                            if (isSelected) MaterialTheme.colorScheme.primary.copy(alpha = 0.3f) else Color.Transparent,
                                            RoundedCornerShape(10.dp)
                                        )
                                        .clickable {
                                            selectedLanguage = lang
                                            showLanguagePicker = false
                                        }
                                        .padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Column {
                                        Text(lang.nativeName, fontWeight = FontWeight.Bold,
                                            style = MaterialTheme.typography.bodyMedium,
                                            textAlign = if (lang.isRtl) TextAlign.End else TextAlign.Start)
                                        Text(lang.displayName + if (lang.isRtl) " (RTL)" else "",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                                    }
                                    if (isSelected) {
                                        Icon(Icons.Default.CheckCircle, null,
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(20.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // RTL preview note
            if (selectedLanguage.isRtl) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = StatusBlue.copy(alpha = 0.08f)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Info, null, tint = StatusBlue, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                if (selectedLanguage == AppLanguage.ARABIC)
                                    "سيتم تطبيق تخطيط RTL عند إعادة تشغيل التطبيق"
                                else
                                    "RTL layout will apply on next app restart",
                                style = MaterialTheme.typography.bodySmall,
                                color = StatusBlue
                            )
                        }
                    }
                }
            }

            // Notifications
            item { SectionHeader("NOTIFICATIONS") }
            item {
                SettingsTile(
                    icon = Icons.Default.Notifications,
                    title = "Push Notifications",
                    subtitle = "Maintenance alerts, tyre warnings, job updates",
                    iconTint = YellowPrimary
                ) {
                    Switch(checked = notificationsEnabled, onCheckedChange = { notificationsEnabled = it })
                }
            }
            item {
                SettingsTile(
                    icon = Icons.Default.Warning,
                    title = "Critical Tyre Alerts",
                    subtitle = "Notify when tread depth < 2mm",
                    iconTint = StatusRed
                ) {
                    Switch(checked = true, onCheckedChange = {})
                }
            }

            // Data & Sync
            item { SectionHeader("DATA & SYNC") }
            item {
                SettingsTile(
                    icon = Icons.Default.CloudSync,
                    title = "Background Sync",
                    subtitle = "Sync offline records automatically on connection",
                    iconTint = StatusGreen
                ) {
                    Switch(checked = offlineSync, onCheckedChange = { offlineSync = it })
                }
            }
            item {
                SettingsTile(
                    icon = Icons.Default.Storage,
                    title = "Local Storage",
                    subtitle = "Encrypted with AES-256 (SQLCipher)",
                    iconTint = MaterialTheme.colorScheme.primary,
                    onClick = {}
                ) {
                    Text("48 MB", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                }
            }

            // About
            item { SectionHeader("ABOUT") }
            item {
                SettingsTile(
                    icon = Icons.Default.Info,
                    title = "App Version",
                    subtitle = "TyrePulse Native (com.shahzebrahman.tyrepulse.native)",
                    iconTint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
                ) {
                    Text("1.0.0-beta", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f))
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.ExtraBold,
        letterSpacing = 1.5.sp,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 16.dp, bottom = 4.dp)
    )
}

@Composable
private fun SettingsTile(
    icon: ImageVector,
    title: String,
    subtitle: String,
    iconTint: Color = Color.Gray,
    onClick: (() -> Unit)? = null,
    trailing: @Composable () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(iconTint.copy(alpha = 0.1f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                Text(subtitle, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f), maxLines = 2)
            }
            Spacer(Modifier.width(8.dp))
            trailing()
        }
    }
}
