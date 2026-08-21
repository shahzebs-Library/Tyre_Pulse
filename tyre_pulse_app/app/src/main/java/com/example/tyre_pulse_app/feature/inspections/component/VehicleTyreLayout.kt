package com.example.tyre_pulse_app.feature.inspections.component

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.common.TyreLayoutEngine
import com.example.tyre_pulse_app.core.model.Asset
import com.example.tyre_pulse_app.core.model.Inspection
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawCanterBody
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawGenericBody
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawPickupBody
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawTyre

@Composable
fun VehicleTyreLayout(
    asset: Asset,
    inspection: Inspection?,
    selectedPosition: String?,
    onTyreClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val layout = TyreLayoutEngine.buildLayout(asset.type, asset.assetNumber)
    
    val screenWidth = LocalConfiguration.current.screenWidthDp.dp - 32.dp
    // Scale everything relative to the 200px base width from React Native
    val scale = screenWidth.value / 200f 

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height((layout.viewH * scale).dp)
            .padding(16.dp),
        contentAlignment = Alignment.TopCenter
    ) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures { tapOffset ->
                        // Detect hits on the slots
                        for (slot in layout.slots) {
                            val x = slot.x * scale
                            val y = slot.y * scale
                            val w = slot.w * scale
                            val h = slot.h * scale
                            if (tapOffset.x in x..(x + w) && tapOffset.y in y..(y + h)) {
                                onTyreClick(slot.id)
                                break
                            }
                        }
                    }
                }
        ) {
            // Draw exact vehicle body based on bodyKey
            when (layout.bodyKey) {
                "PickupBody" -> drawPickupBody(scale)
                "CanterBody" -> drawCanterBody(scale)
                // Implement others later, fallback to generic
                else -> drawGenericBody(scale)
            }

            // Draw exact high-fidelity tyres over the slots
            layout.slots.forEach { slot ->
                val reading = inspection?.tyreReadings?.find { it.position == slot.id }
                val isSelected = selectedPosition == slot.id
                
                // Determine risk from reading condition
                val risk = when (reading?.condition) {
                    "Good" -> "good"
                    "Cuts", "Crack", "Chunking" -> "warning"
                    "Bulge", "Puncture", "Sidewall Damage" -> "critical"
                    else -> "none"
                }

                drawTyre(
                    x = slot.x * scale,
                    y = slot.y * scale,
                    w = slot.w * scale,
                    h = slot.h * scale,
                    label = slot.label,
                    risk = risk,
                    isSelected = isSelected,
                    isRecorded = reading != null,
                    isOutstanding = reading == null,
                    scale = scale
                )
            }
        }
    }
}
