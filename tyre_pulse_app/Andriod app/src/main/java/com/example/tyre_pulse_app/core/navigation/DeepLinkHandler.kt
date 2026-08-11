package com.example.tyre_pulse_app.core.navigation

import android.content.Intent
import androidx.navigation.NavController
import androidx.navigation.NavDeepLinkBuilder
import com.example.tyre_pulse_app.MainActivity
import com.example.tyre_pulse_app.feature.approvals.navigation.ApprovalsDestination
import com.example.tyre_pulse_app.feature.approvals.navigation.ApprovalDetailsDestination

/**
 * Agent 03: Logic to build a synthetic back-stack for deep links.
 */
object DeepLinkHandler {
    fun handleIntent(intent: Intent, navController: NavController) {
        val data = intent.data ?: return
        
        if (data.path?.contains("approval") == true) {
            val approvalId = data.lastPathSegment ?: return
            
            // Build stack: Home -> Approvals -> Approval Details
            navController.navigate(ApprovalsDestination.route)
            navController.navigate(ApprovalDetailsDestination.createRoute(approvalId))
        }
    }
}
