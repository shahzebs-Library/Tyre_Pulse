package com.example.tyre_pulse_app.feature.ai.ui
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue

import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.*


/**
 * Starter prompts.
 *
 * The previous four each demanded a specific figure about THIS fleet - "cost-per-KM
 * for Bridgestone", "critical tyres on Mixer fleet" - which the assistant has no
 * records to answer. They existed to trigger the hard-coded replies that have now
 * been deleted, so leaving them would invite the model to invent the same numbers.
 * These ask for guidance instead, which is what it can honestly give.
 */
private val suggestions = listOf(
    "What causes uneven tyre wear on a mixer?",
    "How do I read a DOT code on a tyre?",
    "What tread depth is legally too low?",
    "Steps for a safe roadside wheel change"
)



@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FleetAiChatScreen(viewModel: FleetAiChatViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val messages = uiState.messages
    val isTyping = uiState.isSending

    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val snackbarHostState = remember { SnackbarHostState() }

    // Follow the conversation as it grows. This used to be done inside the fake
    // response coroutine; keyed on the count it now also follows a real reply that
    // arrives whenever the network returns it.
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return
        viewModel.send(text)
        input = ""
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
                            Text("Not connected to fleet records", style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary)
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.clear() }) {
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
            
            
        }
    }
}

@Composable
private fun ChatBubble(msg: ChatUiMessage) {
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
            // A refusal must not be mistakable for an answer. A failed call used to be
            // impossible here (the replies were local constants), so there was no
            // failure tone at all; now that the call is real, one is required.
            color = when {
                msg.isUser -> MaterialTheme.colorScheme.primary
                msg.isError -> MaterialTheme.colorScheme.errorContainer
                else -> MaterialTheme.colorScheme.surfaceVariant
            },
            modifier = Modifier.widthIn(max = 280.dp)
        ) {
            Text(
                text = msg.text,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                style = MaterialTheme.typography.bodyMedium,
                // Matched to the surface chosen above, or an error bubble renders
                // onSurface text on an errorContainer ground and can fail contrast.
                color = when {
                    msg.isUser -> Color.White
                    msg.isError -> MaterialTheme.colorScheme.onErrorContainer
                    else -> MaterialTheme.colorScheme.onSurface
                }
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
