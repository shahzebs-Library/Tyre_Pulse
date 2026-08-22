package com.example.tyre_pulse_app.feature.ai.ui

import androidx.compose.material3.pulltorefresh.PullToRefreshContainer
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.tyre_pulse_app.core.designsystem.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

data class ChatMessage(val text: String, val isUser: Boolean, val timestamp: Long = System.currentTimeMillis())

private val suggestions = listOf(
    "Which tyres need replacing in the next 30 days?",
    "What is our cost-per-KM for Bridgestone?",
    "Show me critical tyres on Mixer fleet",
    "Predict next month's tyre budget"
)



@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FleetAiChatScreen() {
    var messages by remember {
        mutableStateOf(listOf(
            ChatMessage("Hello! I'm your Fleet AI assistant. Ask me anything about your tyres, fleet health, or maintenance predictions.", false)
        ))
    }
    var input by remember { mutableStateOf("") }
    var isTyping by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    
    val pullToRefreshState = rememberPullToRefreshState()
    val snackbarHostState = remember { SnackbarHostState() }

    if (pullToRefreshState.isRefreshing) {
        LaunchedEffect(true) {
            pullToRefreshState.endRefresh()
        }
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return
        val userMsg = ChatMessage(text, true)
        messages = messages + userMsg
        input = ""
        isTyping = true

        scope.launch {
            delay(1200)
            val aiResponse = generateAiResponse(text)
            messages = messages + ChatMessage(aiResponse, false)
            isTyping = false
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier.size(36.dp).clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary),
                            contentAlignment = Alignment.Center
                        ) { Icon(Icons.Default.SmartToy, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text("Fleet AI", fontWeight = FontWeight.ExtraBold,
                                style = MaterialTheme.typography.titleMedium)
                            Text("Powered by Gemini", style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary)
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { messages = messages.take(1) }) {
                        Icon(Icons.Default.RestartAlt, "Clear chat")
                    }
                }
            )
        },
        bottomBar = {
            Column {
                // Suggestion chips (only when no conversation)
                if (messages.size <= 1) {
                    LazyColumn(modifier = Modifier.heightIn(max = 120.dp)) {
                        items(suggestions) { s ->
                            SuggestionChip(
                                onClick = { sendMessage(s) },
                                label = { Text(s, style = MaterialTheme.typography.bodySmall) },
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp).fillMaxWidth(),
                                icon = { Icon(Icons.Default.Lightbulb, null, tint = YellowPrimary, modifier = Modifier.size(16.dp)) }
                            )
                        }
                    }
                }
                // Input bar
                Row(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = input,
                        onValueChange = { input = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("Ask about your fleet...") },
                        shape = RoundedCornerShape(24.dp),
                        singleLine = true
                    )
                    Spacer(Modifier.width(8.dp))
                    FloatingActionButton(
                        onClick = { sendMessage(input) },
                        containerColor = if (input.isBlank()) MaterialTheme.colorScheme.surfaceVariant
                            else MaterialTheme.colorScheme.primary,
                        contentColor = Color.White,
                        modifier = Modifier.size(48.dp)
                    ) {
                        Icon(Icons.Default.Send, "Send")
                    }
                }
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .nestedScroll(pullToRefreshState.nestedScrollConnection)
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(messages) { msg -> ChatBubble(msg) }
                if (isTyping) {
                    item { TypingIndicator() }
                }
            }
            
            PullToRefreshContainer(
                state = pullToRefreshState,
                modifier = Modifier.align(Alignment.TopCenter)
            )
        }
    }
}

@Composable
private fun ChatBubble(msg: ChatMessage) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (msg.isUser) Arrangement.End else Arrangement.Start
    ) {
        if (!msg.isUser) {
            Box(
                modifier = Modifier.size(32.dp).clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center
            ) { Icon(Icons.Default.SmartToy, null, tint = Color.White, modifier = Modifier.size(18.dp)) }
            Spacer(Modifier.width(8.dp))
        }
        Surface(
            shape = RoundedCornerShape(
                topStart = if (msg.isUser) 18.dp else 4.dp,
                topEnd = if (msg.isUser) 4.dp else 18.dp,
                bottomStart = 18.dp, bottomEnd = 18.dp
            ),
            color = if (msg.isUser) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.widthIn(max = 280.dp)
        ) {
            Text(
                text = msg.text,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = if (msg.isUser) Color.White else MaterialTheme.colorScheme.onSurface
            )
        }
    }
}

@Composable
private fun TypingIndicator() {
    val infiniteTransition = rememberInfiniteTransition(label = "typing")
    Row(modifier = Modifier.padding(start = 40.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
            Row(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                repeat(3) { i ->
                    val offset by infiniteTransition.animateFloat(
                        initialValue = 0f, targetValue = -6f,
                        animationSpec = infiniteRepeatable(
                            tween(400, delayMillis = i * 120, easing = FastOutSlowInEasing),
                            RepeatMode.Reverse
                        ), label = "dot"
                    )
                    Box(
                        modifier = Modifier.size(8.dp).clip(CircleShape)
                            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f))
                            .offset(y = offset.dp)
                    )
                }
            }
        }
    }
}

private fun generateAiResponse(input: String): String {
    val lower = input.lowercase()
    return when {
        "replac" in lower || "30 day" in lower ->
            "Based on current wear rates, 12 tyres are predicted to reach end-of-life within 30 days:\n• Mixer 2841 — FL, FR (tread < 2mm)\n• Truck 104 — RL1, RL2 (80% worn)\n• Trailer 502 — 4 drive axle tyres (critical)\n\nEstimated replacement budget: AED 18,400."
        "cost" in lower || "bridgestone" in lower ->
            "Your Bridgestone cost-per-KM analysis:\n• Average: AED 0.042/km\n• Best performing model: R22.5 (AED 0.038/km)\n• Vs fleet average: 12% better than Goodyear\n\nRecommendation: Increase Bridgestone allocation on highway routes."
        "critical" in lower || "mixer" in lower ->
            "Critical tyres on Mixer fleet:\n🔴 Mixer 2841 — FL (tread: 1.8mm, REPLACE NOW)\n🟡 Mixer 3012 — RR1 (tread: 2.2mm, due in 2 weeks)\n🟡 Mixer 2901 — RL2 (pressure low: 85 PSI)\n\nI recommend scheduling maintenance for Mixer 2841 today."
        "budget" in lower || "predict" in lower ->
            "Next month tyre budget prediction:\n\nBased on 6-month wear trend analysis:\n• Estimated replacements: 18-22 tyres\n• Predicted cost: AED 24,000–32,000\n• High-risk vehicles: 4 mixers, 2 trucks\n\nConfidence: 87%. I recommend pre-ordering 15 R22.5 tyres now."
        else ->
            "I analysed your fleet data. Here's a quick summary:\n• Total fleet: 47 vehicles\n• Tyres monitored: 312\n• Health: 68% good, 22% warning, 10% critical\n• Last 30 days: 247 inspections completed\n\nAsk me about specific vehicles, brands, or maintenance predictions!"
    }
}
