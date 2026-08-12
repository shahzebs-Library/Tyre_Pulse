package com.example.tyre_pulse_app.feature.inspections.component

import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.common.TyreLayoutEngine
import com.example.tyre_pulse_app.core.common.TyreSlot
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.Inspection
import com.example.tyre_pulse_app.core.designsystem.theme.*

@Composable
fun VehicleTyreLayout(
    asset: Asset,
    inspection: Inspection?,
    selectedPosition: String?,
    onTyreClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val layout = TyreLayoutEngine.buildLayout(asset.type, asset.assetNumber)
    
    val screenWidth = LocalConfiguration.current.screenWidthDp.dp - 64.dp
    val scale = screenWidth.value / 200f 

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height((layout.viewH * scale).dp)
            .padding(16.dp),
        contentAlignment = Alignment.TopStart
    ) {
        // Draw exact vehicle body based on bodyKey
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawVehicleBody(layout.bodyKey, scale)
        }

        // Exact Slot Mapping from Expo
        layout.slots.forEach { slot ->
            val reading = inspection?.tyreReadings?.find { it.position == slot.id }
            val isSelected = selectedPosition == slot.id
            
            Box(
                modifier = Modifier
                    .offset(x = (slot.x * scale).dp, y = (slot.y * scale).dp)
                    .size(width = (slot.w * scale).dp, height = (slot.h * scale).dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (isSelected) YellowPrimary.copy(alpha = 0.3f) else OLED_Card)
                    .border(
                        width = if (isSelected) 3.dp else 1.dp,
                        color = if (isSelected) YellowPrimary else Color.White.copy(alpha = 0.1f),
                        shape = RoundedCornerShape(6.dp)
                    )
                    .clickable { onTyreClick(slot.id) },
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = slot.label,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = (8 * scale).sp,
                    color = if (reading != null) StatusGreen else Color.White
                )
            }
        }
    }
}

private fun DrawScope.drawVehicleBody(bodyKey: String, scale: Float) {
    val center = 100f * scale
    // Simple Chassis drawing for now, could be expanded to full SVG paths later
    drawRect(
        color = Color.White.copy(alpha = 0.05f),
        topLeft = Offset(center - (25f * scale), 20f * scale),
        size = Size(50f * scale, 280f * scale)
    )
}
