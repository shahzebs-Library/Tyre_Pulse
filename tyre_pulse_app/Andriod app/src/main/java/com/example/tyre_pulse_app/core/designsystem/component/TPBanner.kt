package com.example.tyre_pulse_app.core.designsystem.component

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.designsystem.theme.StatusOrange
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

/**
 * Agent 49: Operational Messaging.
 * Communicates system status (Offline, Maintenance, Syncing) clearly to the user.
 */
@Composable
fun AppBanner(
    text: String,
    icon: ImageVector,
    isVisible: Boolean,
    backgroundColor: Color = StatusOrange
) {
    AnimatedVisibility(visible = isVisible) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = backgroundColor
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(icon, contentDescription = null, tint = Color.Black, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(12.dp))
                Text(
                    text = text,
                    style = MaterialTheme.typography.labelMedium,
                    color = Color.Black,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}
