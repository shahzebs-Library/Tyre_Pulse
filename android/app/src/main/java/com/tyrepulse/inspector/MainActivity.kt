package com.tyrepulse.inspector

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.tyrepulse.inspector.navigation.AppNavGraph
import com.tyrepulse.inspector.ui.theme.TyrePulseTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as TyrePulseApp).container
        setContent {
            TyrePulseTheme {
                AppNavGraph(container = container)
            }
        }
    }
}
