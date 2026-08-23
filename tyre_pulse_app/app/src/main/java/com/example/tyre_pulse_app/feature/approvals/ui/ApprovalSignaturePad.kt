package com.example.tyre_pulse_app.feature.approvals.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.example.tyre_pulse_app.core.designsystem.component.SignatureSvg

/**
 * Capture the approver's own mark for a sign-off.
 *
 * WHY THIS EXISTS. `decide_checklist_approval` REFUSES to approve without a
 * signature - it raises "A signature is required to sign off this checklist." -
 * and `decide_inspection_approval` stores one on the record. Without a pad the
 * native app could not approve a checklist at all.
 *
 * IT MUST NEVER PRODUCE A PLACEHOLDER. The checklist runner used to save the
 * literal string "signature_data_url_mock_<timestamp>" on a record whose whole
 * purpose is to attest that a named person checked something.
 * [SignatureSvg.fromStrokes] returns null when nothing was drawn, and this
 * reports that null upward unchanged - an empty signature is never dressed up as
 * a real one.
 *
 * The capture mirrors the checklist runner's, so both screens store the same
 * shape and one signature renders in the web app and in PDF reports alike.
 */
@Composable
fun ApprovalSignaturePad(
    onSignatureChange: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    // The on-screen Path cannot be serialised, so the points are captured as
    // they are drawn.
    val path = remember { Path() }
    val strokes = remember { mutableStateListOf<MutableList<Offset>>() }
    var drawTrigger by remember { mutableIntStateOf(0) }
    var hasDrawn by remember { mutableStateOf(false) }
    var padSize by remember { mutableStateOf(IntSize.Zero) }

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Your signature",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            TextButton(
                onClick = {
                    path.reset()
                    strokes.clear()
                    hasDrawn = false
                    drawTrigger++
                    onSignatureChange(null)
                },
                enabled = hasDrawn,
            ) {
                Text("Clear")
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(160.dp)
                .background(Color.White, RoundedCornerShape(12.dp))
                .border(
                    1.dp,
                    MaterialTheme.colorScheme.outlineVariant,
                    RoundedCornerShape(12.dp),
                )
                .onSizeChanged { padSize = it }
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            path.moveTo(offset.x, offset.y)
                            strokes.add(mutableListOf(offset))
                            hasDrawn = true
                        },
                        onDrag = { change, _ ->
                            change.consume()
                            path.lineTo(change.position.x, change.position.y)
                            strokes.lastOrNull()?.add(change.position)
                            drawTrigger++
                        },
                        onDragEnd = {
                            // Publish only what was actually drawn. A null here
                            // means "not signed", and the caller keeps Approve
                            // disabled rather than sending an empty mark.
                            onSignatureChange(
                                SignatureSvg.fromStrokes(
                                    strokes = strokes,
                                    width = padSize.width,
                                    height = padSize.height,
                                )
                            )
                        },
                    )
                }
        ) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                // Reading the counter is what makes the Canvas redraw as the
                // mutable Path is extended; the Path itself is not observable.
                @Suppress("UNUSED_VARIABLE")
                val redrawOn = drawTrigger
                drawPath(
                    path = path,
                    color = Color.Black,
                    style = Stroke(width = 6f, cap = StrokeCap.Round, join = StrokeJoin.Round),
                )
            }
            if (!hasDrawn) {
                Text(
                    text = "Sign here with your finger",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.Gray,
                    modifier = Modifier.align(Alignment.Center),
                )
            }
        }

        Spacer(Modifier.height(8.dp))
        Text(
            text = "A signature is stored with the decision. It is required to " +
                "approve a checklist.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 2.dp),
        )
    }
}
