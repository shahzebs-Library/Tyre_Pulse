package com.example.tyre_pulse_app.feature.inspections.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.common.TyreLayoutEngine
import com.example.tyre_pulse_app.core.common.TyreSlot
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.Inspection

@Composable
fun VehicleTyreLayout(
    asset: Asset,
    inspection: Inspection?,
    onTyreClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    // Ported layout logic
    val positions = asset.tyres?.map { it.position } ?: listOf("FL", "FR", "RL", "RR")
    val layout = TyreLayoutEngine.buildLayout(asset.type, positions)
    
    val screenWidth = LocalConfiguration.current.screenWidthDp.dp - 32.dp
    val scale = screenWidth.value / 200f // 200 is the logical width in the engine

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height((layout.viewH * scale).dp),
        contentAlignment = Alignment.TopStart
    ) {
        // Draw Chassis
        Box(
            modifier = Modifier
                .offset(
                    x = (80 * scale).dp,
                    y = (layout.chassisTop * scale).dp
                )
                .size(
                    width = (40 * scale).dp,
                    height = ((layout.chassisBot - layout.chassisTop) * scale).dp
                )
                .background(
                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f),
                    shape = RoundedCornerShape(4.dp)
                )
        )

        // Draw Axle Beams
        layout.axleYs.forEach { y ->
            Box(
                modifier = Modifier
                    .offset(
                        x = (40 * scale).dp,
                        y = (y * scale - 1).dp
                    )
                    .size(width = (120 * scale).dp, height = 2.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant)
            )
        }

        // Draw Tyres
        layout.slots.forEach { slot ->
            TyreNode(
                slot = slot,
                scale = scale,
                inspection = inspection,
                onClick = { onTyreClick(slot.id) }
            )
        }
    }
}

@Composable
private fun TyreNode(
    slot: TyreSlot,
    scale: Float,
    inspection: Inspection?,
    onClick: () -> Unit
) {
    val reading = inspection?.tyreReadings?.find { it.position == slot.id }
    val isInspected = reading != null
    
    val statusColor = when (reading?.condition?.lowercase()) {
        "good" -> Color(0xFF4CAF50)
        "wear", "warning" -> Color(0xFFFF9800)
        "damage", "critical", "puncture" -> Color(0xFFF44336)
        else -> if (isInspected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline
    }

    Box(
        modifier = Modifier
            .offset(
                x = (slot.x * scale).dp,
                y = (slot.y * scale).dp
            )
            .size(
                width = (slot.w * scale).dp,
                height = (slot.h * scale).dp
            )
            .clip(RoundedCornerShape(4.dp))
            .background(if (isInspected) statusColor.copy(alpha = 0.2f) else MaterialTheme.colorScheme.surface)
            .border(
                width = 2.dp,
                color = if (isInspected) statusColor else MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(4.dp)
            )
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = slot.label,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                fontSize = 10.sp,
                color = if (isInspected) statusColor else MaterialTheme.colorScheme.onSurface
            )
            if (reading?.pressure != null) {
                Text(
                    text = "${reading.pressure}",
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 8.sp,
                    color = statusColor
                )
            }
        }
    }
}
