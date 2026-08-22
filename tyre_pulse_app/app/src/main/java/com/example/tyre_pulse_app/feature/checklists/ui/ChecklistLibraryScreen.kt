package com.example.tyre_pulse_app.feature.checklists.ui

import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.launch
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.designsystem.theme.*

data class TemplateSummary(
    val id: String,
    val name: String,
    val category: String,
    val isScored: Boolean = false,
    val duration: String = "5-10 min"
)



@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChecklistLibraryScreen(
    onStartChecklist: (String) -> Unit
) {
    val templates = listOf(
        TemplateSummary("dvir_1", "Driver Daily Inspection (DVIR)", "OPERATIONS", true),
        TemplateSummary("handover_1", "Shift Handover Checklist", "SAFETY", false),
        TemplateSummary("post_maint_1", "Post-Maintenance Verification", "MAINTENANCE", true),
        TemplateSummary("gate_pass_1", "Vehicle Gate Pass / Release", "LOGISTICS", false)
    )
    
    var isRefreshing by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    if (isRefreshing) {
        LaunchedEffect(true) {
            isRefreshing = false
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = OLED_Black,
        topBar = {
            TopAppBar(
                title = { Text("Checklist Library", fontWeight = FontWeight.ExtraBold) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = OLED_Black)
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true },
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                
        
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                contentPadding = PaddingValues(top = 12.dp, bottom = 32.dp)
            ) {
                item {
                    Text(
                        text = "AVAILABLE TEMPLATES",
                        style = MaterialTheme.typography.labelMedium,
                        color = YellowPrimary,
                        letterSpacing = 1.5.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
    
                items(templates) { template ->
                    TemplateCard(template) { onStartChecklist(template.id) }
                }
            }
            
            
        }
    }
}

@Composable
fun TemplateCard(template: TemplateSummary, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable { onClick() },
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = OLED_Card),
        border = androidx.compose.foundation.BorderStroke(0.5.dp, Color.White.copy(alpha = 0.05f))
    ) {
        Row(modifier = Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(YellowPrimary.copy(alpha = 0.1f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Assignment, contentDescription = null, tint = YellowPrimary)
            }
            
            Spacer(Modifier.width(20.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(template.category, style = MaterialTheme.typography.labelSmall, color = YellowPrimary, fontWeight = FontWeight.Bold)
                Text(template.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    Icon(Icons.Default.Timer, contentDescription = null, tint = TextSecondary, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(template.duration, style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                    
                    if (template.isScored) {
                        Spacer(Modifier.width(12.dp))
                        Surface(color = StatusGreen.copy(alpha = 0.1f), shape = CircleShape) {
                            Text("SCORED", color = StatusGreen, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp), fontWeight = FontWeight.ExtraBold)
                        }
                    }
                }
            }
            
            Button(
                onClick = onClick,
                colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                shape = RoundedCornerShape(12.dp),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Text("START", fontWeight = FontWeight.ExtraBold, fontSize = 12.sp)
            }
        }
    }
}
