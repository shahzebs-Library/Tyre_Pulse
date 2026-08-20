package com.example.tyre_pulse_app.core.designsystem.component

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.designsystem.theme.*

/**
 * TyrePositionData — represents a single tyre slot on the vehicle diagram.
 *
 * @param code       E.g. "FL", "FR", "RL1", "RL2", "RR1", "RR2", "SPR"
 * @param label      Human readable label — "Front Left", "Rear Left Inner"
 * @param hasTyre    Whether a tyre is currently fitted here
 * @param treadDepth Current tread depth in mm (null = unknown)
 * @param isSelected Currently selected for replacement
 */
data class TyrePositionData(
    val code: String,
    val label: String,
    val hasTyre: Boolean = true,
    val treadDepth: Double? = null,
    val isSelected: Boolean = false
) {
    val condition: TyreCondition get() = when {
        treadDepth == null -> TyreCondition.UNKNOWN
        treadDepth <= 2.0  -> TyreCondition.CRITICAL
        treadDepth <= 3.5  -> TyreCondition.WARNING
        else               -> TyreCondition.GOOD
    }
}

enum class TyreCondition(val color: Color) {
    GOOD(Color(0xFF10B981)),
    WARNING(Color(0xFFF59E0B)),
    CRITICAL(Color(0xFFEF4444)),
    UNKNOWN(Color(0xFF64748B))
}

/**
 * Interactive axle position picker — shows a 2D top-view of the vehicle
 * with colour-coded tyre slots. Tap a slot to select the tyre for replacement.
 *
 * Supports: 4-wheel (van/car), 6-wheel (single rear axle truck), 10-wheel (mixer).
 */
@Composable
fun AxlePositionPicker(
    positions: List<TyrePositionData>,
    onPositionSelected: (TyrePositionData) -> Unit,
    modifier: Modifier = Modifier,
    vehicleLabel: String = "Vehicle"
) {
    val axleGroups = mapPositionsToAxles(positions)

    Column(modifier = modifier.fillMaxWidth()) {
        // Header
        Text(
            "Tap a tyre position to select",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            modifier = Modifier.padding(bottom = 12.dp)
        )

        // Vehicle body outline
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(20.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.2f), RoundedCornerShape(20.dp))
                .padding(vertical = 24.dp, horizontal = 16.dp)
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Vehicle label
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)
                ) {
                    Text(
                        vehicleLabel,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }

                // Render each axle row
                axleGroups.forEach { (axleName, left, right) ->
                    AxleRow(
                        axleName = axleName,
                        leftPositions = left,
                        rightPositions = right,
                        onPositionSelected = onPositionSelected
                    )
                }

                // Spare if present
                positions.firstOrNull { it.code == "SPR" }?.let { spare ->
                    Spacer(Modifier.height(4.dp))
                    TyreSlot(spare, onPositionSelected, label = "Spare")
                }
            }
        }

        // Legend
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TyreCondition.values().forEach { cond ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(cond.color))
                    Spacer(Modifier.width(4.dp))
                    Text(cond.name.lowercase().replaceFirstChar { it.uppercase() },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
                }
            }
        }
    }
}

@Composable
private fun AxleRow(
    axleName: String,
    leftPositions: List<TyrePositionData>,
    rightPositions: List<TyrePositionData>,
    onPositionSelected: (TyrePositionData) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Left tyres (reverse order — outermost first)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            leftPositions.reversed().forEach { pos ->
                TyreSlot(pos, onPositionSelected)
            }
        }

        // Axle bar
        Box(
            modifier = Modifier
                .weight(1f)
                .height(6.dp)
                .padding(horizontal = 6.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
        )

        // Right tyres
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            rightPositions.forEach { pos ->
                TyreSlot(pos, onPositionSelected)
            }
        }
    }
}

@Composable
private fun TyreSlot(
    position: TyrePositionData,
    onPositionSelected: (TyrePositionData) -> Unit,
    label: String? = null
) {
    val pulseAnim = rememberInfiniteTransition(label = "pulse")
    val scale by pulseAnim.animateFloat(
        initialValue = 1f, targetValue = 1.08f,
        animationSpec = infiniteRepeatable(tween(700, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "scale"
    )

    val slotColor = if (!position.hasTyre) Color.Transparent
    else position.condition.color

    val borderColor = when {
        position.isSelected -> MaterialTheme.colorScheme.primary
        position.condition == TyreCondition.CRITICAL -> slotColor
        else -> slotColor.copy(alpha = 0.5f)
    }

    val modifier = Modifier
        .size(width = 28.dp, height = 44.dp)
        .clip(RoundedCornerShape(6.dp))
        .border(
            width = if (position.isSelected) 2.5.dp else 1.5.dp,
            color = borderColor,
            shape = RoundedCornerShape(6.dp)
        )
        .background(slotColor.copy(alpha = if (position.isSelected) 0.35f else 0.15f))
        .clickable(enabled = position.hasTyre) { onPositionSelected(position) }

    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        if (position.isSelected) {
            Icon(Icons.Default.Check, null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(14.dp))
        } else if (position.hasTyre) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    position.code.take(2),
                    fontSize = 7.sp,
                    fontWeight = FontWeight.Bold,
                    color = slotColor,
                    textAlign = TextAlign.Center
                )
                position.treadDepth?.let { depth ->
                    Text(
                        "%.1f".format(depth),
                        fontSize = 7.sp,
                        color = slotColor.copy(alpha = 0.8f),
                        textAlign = TextAlign.Center
                    )
                }
            }
        } else {
            Text("—", fontSize = 10.sp, color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
        }
    }
}

// Maps flat position list into axle rows for the vehicle diagram
private data class AxleGroup(val name: String, val left: List<TyrePositionData>, val right: List<TyrePositionData>)

private fun mapPositionsToAxles(positions: List<TyrePositionData>): List<AxleGroup> {
    val result = mutableListOf<AxleGroup>()

    // Steer axle (front)
    val steerL = positions.filter { it.code == "FL" }
    val steerR = positions.filter { it.code == "FR" }
    if (steerL.isNotEmpty() || steerR.isNotEmpty()) {
        result.add(AxleGroup("STEER", steerL, steerR))
    }

    // Middle axle (if present on triaxle/tandem)
    val midL = positions.filter { it.code.startsWith("ML") }
    val midR = positions.filter { it.code.startsWith("MR") }
    if (midL.isNotEmpty() || midR.isNotEmpty()) {
        result.add(AxleGroup("MID", midL, midR))
    }

    // Drive axle 1 — RL / RR (or RL1/RR1 for dual)
    val drive1L = positions.filter { it.code == "RL" || it.code == "RL1" || it.code == "RL2" }
    val drive1R = positions.filter { it.code == "RR" || it.code == "RR1" || it.code == "RR2" }
    if (drive1L.isNotEmpty() || drive1R.isNotEmpty()) {
        result.add(AxleGroup("DRIVE 1", drive1L, drive1R))
    }

    // Drive axle 2 (triaxle / trailer)
    val drive2L = positions.filter { it.code == "RL3" || it.code == "RL4" }
    val drive2R = positions.filter { it.code == "RR3" || it.code == "RR4" }
    if (drive2L.isNotEmpty() || drive2R.isNotEmpty()) {
        result.add(AxleGroup("DRIVE 2", drive2L, drive2R))
    }

    // Pusher / tag axle
    val pushL = positions.filter { it.code.startsWith("PL") }
    val pushR = positions.filter { it.code.startsWith("PR") }
    if (pushL.isNotEmpty() || pushR.isNotEmpty()) {
        result.add(AxleGroup("PUSHER", pushL, pushR))
    }

    return result
}
