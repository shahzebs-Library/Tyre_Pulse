package com.example.tyre_pulse_app.feature.checklists.ui

import android.view.HapticFeedbackConstants
import androidx.compose.animation.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.*
import com.example.tyre_pulse_app.core.model.ChecklistField
import com.example.tyre_pulse_app.feature.checklists.logic.ChecklistEngine

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChecklistRunnerRoute(
    onBack: () -> Unit,
    viewModel: ChecklistViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val view = LocalView.current
    
    val done = uiState.template?.let { tpl ->
        tpl.fields.filter { it.type != "section" && ChecklistEngine.isFieldVisible(it, uiState.answers) }
            .count { uiState.answers[it.id]?.isNotBlank() == true }
    } ?: 0
    val total = uiState.template?.let { tpl ->
        tpl.fields.count { it.type != "section" && ChecklistEngine.isFieldVisible(it, uiState.answers) }
    } ?: 0
    
    val pct = if (total > 0) (done.toFloat() / total.toFloat()) else 0f
    
    var activeField by remember { mutableStateOf<ChecklistField?>(null) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            OperationalHeader(
                title = uiState.template?.name ?: "Inspection",
                done = done,
                total = total,
                pct = pct,
                onBack = onBack
            )
        },
        bottomBar = {
            if (pct == 1f) {
                Surface(
                    color = MaterialTheme.colorScheme.background,
                    tonalElevation = 8.dp,
                    modifier = Modifier.padding(20.dp).navigationBarsPadding()
                ) {
                    Button(
                        onClick = { 
                            view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                            viewModel.submit() 
                        },
                        modifier = Modifier.fillMaxWidth().height(64.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary),
                        shape = RoundedCornerShape(20.dp)
                    ) {
                        Icon(Icons.Default.CloudDone, contentDescription = null)
                        Spacer(Modifier.width(12.dp))
                        Text("SUBMIT COMPLETED INSPECTION", fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp)
                    }
                }
            }
        }
    ) { padding ->
        val visibleFields = uiState.template?.fields?.filter { ChecklistEngine.isFieldVisible(it, uiState.answers) } ?: emptyList()

        LazyColumn(
            state = listState,
            modifier = Modifier.padding(padding).fillMaxSize().background(MaterialTheme.colorScheme.background),
            contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            items(visibleFields, key = { it.id }) { field ->
                if (field.type == "section") {
                    AdvancedSectionHeader(field.label)
                } else {
                    AdvancedChecklistTile(
                        field = field,
                        value = uiState.answers[field.id],
                        onClick = { 
                            view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                            activeField = field 
                        }
                    )
                }
            }
            
            item { Spacer(Modifier.height(100.dp)) }
        }

        if (activeField != null) {
            ModalBottomSheet(
                onDismissRequest = { activeField = null },
                sheetState = sheetState,
                containerColor = MaterialTheme.colorScheme.surface,
                dragHandle = { BottomSheetDefaults.DragHandle(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f)) }
            ) {
                AdvancedRecorder(
                    field = activeField!!,
                    value = uiState.answers[activeField!!.id],
                    onSave = { 
                        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                        viewModel.updateAnswer(activeField!!.id, it)
                        activeField = null 
                    }
                )
            }
        }
    }
}

@Composable
fun OperationalHeader(title: String, done: Int, total: Int, pct: Float, onBack: () -> Unit) {
    Column(modifier = Modifier.background(MaterialTheme.colorScheme.background).statusBarsPadding()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(8.dp)) {
                Text("$done/$total", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
            }
        }
        
        Box(modifier = Modifier.fillMaxWidth().height(4.dp).background(MaterialTheme.colorScheme.outline.copy(alpha = 0.1f))) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(pct)
                    .fillMaxHeight()
                    .background(if (pct == 1f) StatusGreen else MaterialTheme.colorScheme.primary)
            )
        }
    }
}

@Composable
fun AdvancedChecklistTile(field: ChecklistField, value: String?, onClick: () -> Unit) {
    val isAnswered = !value.isNullOrBlank()
    val color = if (isAnswered) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline

    Surface(
        modifier = Modifier.fillMaxWidth().clickable { onClick() },
        color = if (isAnswered) MaterialTheme.colorScheme.primary.copy(alpha = 0.05f) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
        shape = RoundedCornerShape(24.dp),
        border = androidx.compose.foundation.BorderStroke(
            width = if (isAnswered) 2.dp else 1.dp,
            color = if (isAnswered) MaterialTheme.colorScheme.primary.copy(alpha = 0.4f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.1f)
        )
    ) {
        Row(modifier = Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(48.dp).clip(CircleShape).background(if (isAnswered) MaterialTheme.colorScheme.primary.copy(alpha = 0.1f) else MaterialTheme.colorScheme.outline.copy(alpha = 0.05f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = getFieldIcon(field.type), 
                    contentDescription = null, 
                    tint = if (isAnswered) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                    modifier = Modifier.size(24.dp)
                )
            }
            
            Spacer(Modifier.width(16.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(field.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                if (isAnswered) {
                    Text(value!!.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp)
                }
            }

            if (isAnswered) {
                Icon(Icons.Default.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            } else {
                Icon(Icons.Default.AddCircleOutline, contentDescription = null, tint = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
            }
        }
    }
}

@Composable
fun AdvancedRecorder(field: ChecklistField, value: String?, onSave: (String) -> Unit) {
    Column(modifier = Modifier.padding(24.dp).navigationBarsPadding()) {
        Text("RECORDING DATA", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Spacer(Modifier.height(12.dp))
        Text(field.label, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
        
        Spacer(Modifier.height(32.dp))

        when (field.type) {
            "boolean" -> {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    LargeEnterpriseButton("PASS / OK", Icons.Default.Check, StatusGreen, modifier = Modifier.weight(1f)) { onSave("true") }
                    LargeEnterpriseButton("FAIL / DEFECT", Icons.Default.Warning, StatusRed, modifier = Modifier.weight(1f)) { onSave("false") }
                }
            }
            "select" -> {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    field.options?.forEach { option ->
                        Button(
                            onClick = { onSave(option) },
                            modifier = Modifier.fillMaxWidth().height(60.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                            Text(option, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
            }
            "number" -> {
                var text by remember { mutableStateOf(value ?: "") }
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.fillMaxWidth(),
                    textStyle = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary),
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MaterialTheme.colorScheme.primary)
                )
                Spacer(Modifier.height(24.dp))
                Button(onClick = { onSave(text) }, modifier = Modifier.fillMaxWidth().height(60.dp)) {
                    Text("SAVE READING", fontWeight = FontWeight.ExtraBold)
                }
            }
            "photo" -> {
                var photoPath by remember { mutableStateOf(value ?: "") }
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    if (photoPath.isNotBlank()) {
                        Surface(
                            modifier = Modifier.size(150.dp),
                            shape = RoundedCornerShape(16.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.CameraAlt, contentDescription = null, modifier = Modifier.size(48.dp))
                                Text("Photo Captured", style = MaterialTheme.typography.bodySmall, modifier = Modifier.align(Alignment.BottomCenter).padding(8.dp))
                            }
                        }
                    } else {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(150.dp)
                                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
                                .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.2f), RoundedCornerShape(16.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text("No photo captured", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = {
                            photoPath = "file:///durable_photos/captured_${System.currentTimeMillis()}.jpg"
                        },
                        modifier = Modifier.fillMaxWidth().height(60.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                    ) {
                        Icon(Icons.Default.CameraAlt, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (photoPath.isBlank()) "CAPTURE PHOTO" else "RETAKE PHOTO", fontWeight = FontWeight.Bold)
                    }
                    if (photoPath.isNotBlank()) {
                        Spacer(Modifier.height(12.dp))
                        Button(
                            onClick = { onSave(photoPath) },
                            modifier = Modifier.fillMaxWidth().height(60.dp)
                        ) {
                            Text("SAVE PHOTO", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
            "signature" -> {
                val path = remember { Path() }
                var drawTrigger by remember { mutableStateOf(0) }
                var isDrawing by remember { mutableStateOf(false) }

                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp)
                            .background(Color.White, RoundedCornerShape(16.dp))
                            .border(2.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.3f), RoundedCornerShape(16.dp))
                            .pointerInput(Unit) {
                                detectDragGestures(
                                    onDragStart = { offset ->
                                        path.moveTo(offset.x, offset.y)
                                        isDrawing = true
                                    },
                                    onDrag = { change, dragAmount ->
                                        change.consume()
                                        path.lineTo(change.position.x, change.position.y)
                                        drawTrigger++
                                    }
                                )
                            }
                    ) {
                        Canvas(modifier = Modifier.fillMaxSize()) {
                            val dummy = drawTrigger
                            drawPath(
                                path = path,
                                color = Color.Black,
                                style = Stroke(width = 6f, cap = StrokeCap.Round, join = StrokeJoin.Round)
                            )
                        }
                        if (!isDrawing) {
                            Text(
                                "Draw signature here using your finger",
                                style = MaterialTheme.typography.bodyMedium,
                                color = Color.Gray,
                                modifier = Modifier.align(Alignment.Center)
                            )
                        }
                    }

                    Spacer(Modifier.height(16.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                path.reset()
                                isDrawing = false
                                drawTrigger++
                            },
                            modifier = Modifier.weight(1f).height(60.dp)
                        ) {
                            Text("CLEAR")
                        }
                        Button(
                            onClick = {
                                if (isDrawing) {
                                    onSave("signature_data_url_mock_${System.currentTimeMillis()}")
                                }
                            },
                            enabled = isDrawing,
                            modifier = Modifier.weight(1f).height(60.dp)
                        ) {
                            Text("CONFIRM")
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
fun LargeEnterpriseButton(label: String, icon: ImageVector, color: Color, modifier: Modifier, onClick: () -> Unit) {
    Surface(
        modifier = modifier.height(140.dp).clickable { onClick() },
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        shape = RoundedCornerShape(28.dp),
        border = androidx.compose.foundation.BorderStroke(2.dp, color.copy(alpha = 0.3f))
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(40.dp))
            Spacer(Modifier.height(16.dp))
            Text(label, fontWeight = FontWeight.ExtraBold, color = color, letterSpacing = 1.sp, fontSize = 14.sp)
        }
    }
}

@Composable
fun AdvancedSectionHeader(title: String) {
    Column(modifier = Modifier.padding(top = 16.dp, bottom = 8.dp)) {
        Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.ExtraBold, letterSpacing = 2.sp)
        Spacer(Modifier.height(4.dp))
        Box(modifier = Modifier.fillMaxWidth().height(2.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)))
    }
}

private fun getFieldIcon(type: String): ImageVector = when(type) {
    "boolean" -> Icons.Default.Rule
    "number" -> Icons.Default.Speed
    "photo" -> Icons.Default.CameraAlt
    "select" -> Icons.Default.List
    "signature" -> Icons.Default.Gesture
    else -> Icons.Default.EditNote
}
