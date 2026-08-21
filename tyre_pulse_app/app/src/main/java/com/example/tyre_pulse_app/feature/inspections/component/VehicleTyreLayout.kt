package com.example.tyre_pulse_app.feature.inspections.component

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawPickupL300Body
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawPickupIsuzuBody
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawSkidLoaderBody
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawForkliftBody
import com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawConcretePump4AxleBody

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

    val infiniteTransition = rememberInfiniteTransition(label = "vehicle_animations")
    val blinkPhase by infiniteTransition.animateFloat(
        initialValue = 0.2f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(400, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "blinker_alpha"
    )
    
    val drumRotationPhase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "drum_rotation"
    )

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
                "pickup" -> drawPickupBody(scale, blinkPhase)
                "pickupL300" -> drawPickupL300Body(scale, blinkPhase)
                "pickupIsuzu" -> drawPickupIsuzuBody(scale, blinkPhase)
                "canter", "bus", "tata", "ashokLeyland" -> drawCanterBody(scale, blinkPhase)
                "triMixer" -> com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawTriMixerBody(scale, blinkPhase, drumRotationPhase)
                "concretePump" -> com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawConcretePumpBody(scale, blinkPhase)
                "concretePump4Axle" -> drawConcretePump4AxleBody(scale, blinkPhase)
                "wheelLoader" -> com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawWheelLoaderBody(scale, blinkPhase)
                "skidLoader" -> drawSkidLoaderBody(scale, blinkPhase)
                "forklift" -> drawForkliftBody(scale, blinkPhase)
                "trailer" -> com.example.tyre_pulse_app.feature.inspections.component.VehicleTyreDrawings.drawTrailerBody(scale, blinkPhase)
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
