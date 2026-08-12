package com.example.tyre_pulse_app.feature.auth.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.example.tyre_pulse_app.core.designsystem.theme.YellowPrimary

@Composable
fun LoginRoute(
    onLoginSuccess: () -> Unit,
    viewModel: LoginViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    if (uiState.isSuccess) {
        LaunchedEffect(Unit) { onLoginSuccess() }
    }

    LoginScreen(
        uiState = uiState,
        onIdentifierChanged = viewModel::onIdentifierChanged,
        onPasswordChanged = viewModel::onPasswordChanged,
        onLoginClick = viewModel::login
    )
}

@Composable
fun LoginScreen(
    uiState: LoginUiState,
    onIdentifierChanged: (String) -> Unit,
    onPasswordChanged: (String) -> Unit,
    onLoginClick: () -> Unit
) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier.fillMaxSize().padding(24.dp).navigationBarsPadding().imePadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(modifier = Modifier.size(100.dp).background(YellowPrimary, RoundedCornerShape(20.dp)), contentAlignment = Alignment.Center) {
                Text("TP", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.ExtraBold, color = Color.Black)
            }
            
            Spacer(Modifier.height(40.dp))
            
            Text("Tyre Pulse", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.ExtraBold, color = YellowPrimary)
            Text("Enterprise Tyre Management", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
            
            Spacer(Modifier.height(48.dp))
            
            OutlinedTextField(
                value = uiState.identifier,
                onValueChange = onIdentifierChanged,
                label = { Text("Username or Employee ID") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                singleLine = true
            )
            
            Spacer(Modifier.height(16.dp))
            
            OutlinedTextField(
                value = uiState.password,
                onValueChange = onPasswordChanged,
                label = { Text("Password") },
                modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(),
                shape = RoundedCornerShape(12.dp),
                singleLine = true
            )
            
            Spacer(Modifier.height(32.dp))
            
            Button(
                onClick = onLoginClick,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = YellowPrimary, contentColor = Color.Black),
                shape = RoundedCornerShape(12.dp),
                enabled = !uiState.isLoading
            ) {
                if (uiState.isLoading) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp), color = Color.Black, strokeWidth = 2.dp)
                } else {
                    Text("SIGN IN", fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                }
            }
            
            if (uiState.error != null) {
                Spacer(Modifier.height(16.dp))
                Text(text = uiState.error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
