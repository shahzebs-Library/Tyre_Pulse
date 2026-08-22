package com.example.tyre_pulse_app.feature.checklists.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

data class ChecklistItem(val id: Int, val title: String, var isChecked: Boolean = false)


@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HousekeepingChecklistScreen(
    tenantLogoUrl: String = "https://via.placeholder.com/150x50.png?text=Company+Logo",
    onBack: () -> Unit,
    onSubmit: () -> Unit
) {
    val currentTime = LocalTime.now()
    val isDayShift = currentTime.hour in 6..18
    val shiftName = if (isDayShift) "Day Shift" else "Night Shift"

    val pmvChecklist = remember {
        mutableStateListOf(
            ChecklistItem(1, "Check Engine Oil Level"),
            ChecklistItem(2, "Inspect Hydraulic Hoses for Leaks"),
            ChecklistItem(3, "Verify Headlights and Blinkers are Functional"),
            ChecklistItem(4, "Check Tyre Pressure (Cold)"),
            ChecklistItem(5, if (isDayShift) "Clean Cabin and Wash Exterior" else "Test High-Beam Lights and Reflectors")
        )
    }

    var signaturePath by remember { mutableStateOf(Path()) }
    var hasSigned by remember { mutableStateOf(false) }

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
            TopAppBar(
                title = { Text("PMV Housekeeping") },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { if (hasSigned) onSubmit() },
                containerColor = if (hasSigned) MaterialTheme.colorScheme.primary else Color.Gray,
                content = { Text("Submit Checklist") }
            )
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { isRefreshing = true },
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                
        
        ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    AsyncImage(
                        model = tenantLogoUrl,
                        contentDescription = "Company Logo",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .height(50.dp)
                            .width(150.dp)
                            .background(Color.White)
                    )
                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            text = shiftName,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = if (isDayShift) Color(0xFFF59E0B) else Color(0xFF3B82F6)
                        )
                        Text(
                            text = currentTime.format(DateTimeFormatter.ofPattern("HH:mm")),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
                Divider(modifier = Modifier.padding(vertical = 16.dp))
            }

            item {
                Text("Pre-Operational Checks", style = MaterialTheme.typography.titleMedium)
            }

            items(pmvChecklist) { item ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Checkbox(
                        checked = item.isChecked,
                        onCheckedChange = {
                            val index = pmvChecklist.indexOf(item)
                            pmvChecklist[index] = item.copy(isChecked = it)
                        }
                    )
                    Text(item.title, style = MaterialTheme.typography.bodyLarge)
                }
            }

            item {
                Divider(modifier = Modifier.padding(vertical = 16.dp))
                Text("Supervisor Signature", style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(8.dp))
                
                // Digital Signature Canvas
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(200.dp)
                        .background(Color.White)
                        .pointerInput(Unit) {
                            detectDragGestures(
                                onDragStart = { offset ->
                                    val newPath = Path().apply {
                                        addPath(signaturePath)
                                        moveTo(offset.x, offset.y)
                                    }
                                    signaturePath = newPath
                                    hasSigned = true
                                },
                                onDrag = { change, dragAmount ->
                                    change.consume()
                                    val newPath = Path().apply {
                                        addPath(signaturePath)
                                        lineTo(change.position.x, change.position.y)
                                    }
                                    signaturePath = newPath
                                }
                            )
                        }
                ) {
                    Canvas(modifier = Modifier.fillMaxSize()) {
                        drawPath(
                            path = signaturePath,
                            color = Color.Black,
                            style = Stroke(
                                width = 5f,
                                cap = StrokeCap.Round,
                                join = StrokeJoin.Round
                            )
                        )
                    }
                    if (!hasSigned) {
                        Text(
                            text = "Sign Here",
                            color = Color.LightGray,
                            modifier = Modifier.align(Alignment.Center)
                        )
                    }
                }
                
                TextButton(onClick = { 
                    signaturePath = Path()
                    hasSigned = false
                }) {
                    Text("Clear Signature")
                }
                
                
                Spacer(modifier = Modifier.height(80.dp))
            }
        }
        
        }
    }
}
