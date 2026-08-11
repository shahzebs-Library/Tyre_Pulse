package com.example.tyre_pulse_app.feature.checklists.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.model.ChecklistField
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

/**
 * Agent 01: Universal Checklist Engine.
 * Dynamically renders ANY checklist template from the web builder.
 */
@Composable
fun UniversalChecklistRunner(
    title: String,
    fields: List<ChecklistField>,
    onComplete: (Map<String, Any>) -> Unit
) {
    val answers = remember { mutableStateMapOf<String, Any>() }

    Column(modifier = Modifier.fillMaxSize()) {
        Text(title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(16.dp), fontWeight = FontWeight.ExtraBold)
        
        LazyColumn(
            modifier = Modifier.weight(1f).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            items(fields) { field ->
                ChecklistItem(
                    field = field,
                    currentValue = answers[field.id],
                    onValueChange = { answers[field.id] = it }
                )
            }
        }
        
        Button(
            onClick = { onComplete(answers) },
            modifier = Modifier.fillMaxWidth().padding(16.dp).height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary)
        ) {
            Text("Submit Results", fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun ChecklistItem(field: ChecklistField, currentValue: Any?, onValueChange: (Any) -> Unit) {
    Column {
        Text(field.label, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        when (field.type) {
            "boolean" -> Switch(checked = currentValue as? Boolean ?: false, onCheckedChange = onValueChange)
            "text" -> OutlinedTextField(value = currentValue as? String ?: "", onValueChange = onValueChange, modifier = Modifier.fillMaxWidth())
            "photo" -> Button(onClick = { /* Launch Camera */ }) { Text("Capture Evidence") }
        }
    }
}
