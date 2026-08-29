package com.shahzebrahman.tyrepulse

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterFragmentActivity() {
    private val channelName = "com.shahzebrahman.tyrepulse/device_security"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                if (call.method != "authenticate") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }

                val availability = BiometricManager.from(this).canAuthenticate(
                    BiometricManager.Authenticators.BIOMETRIC_STRONG,
                )
                if (availability != BiometricManager.BIOMETRIC_SUCCESS) {
                    result.success("unavailable")
                    return@setMethodCallHandler
                }

                val prompt = BiometricPrompt(
                    this,
                    ContextCompat.getMainExecutor(this),
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(
                            authenticationResult: BiometricPrompt.AuthenticationResult,
                        ) {
                            result.success("authenticated")
                        }

                        override fun onAuthenticationError(
                            errorCode: Int,
                            errString: CharSequence,
                        ) {
                            val outcome = when (errorCode) {
                                BiometricPrompt.ERROR_CANCELED,
                                BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                                BiometricPrompt.ERROR_USER_CANCELED -> "cancelled"
                                BiometricPrompt.ERROR_LOCKOUT,
                                BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "lockedOut"
                                BiometricPrompt.ERROR_HW_NOT_PRESENT,
                                BiometricPrompt.ERROR_HW_UNAVAILABLE,
                                BiometricPrompt.ERROR_NO_BIOMETRICS -> "unavailable"
                                else -> "failed"
                            }
                            result.success(outcome)
                        }
                    },
                )
                val reason = call.argument<String>("reason")
                    ?.takeIf { it.isNotBlank() }
                    ?: "Confirm your identity to sign in to Tyre Pulse"
                prompt.authenticate(
                    BiometricPrompt.PromptInfo.Builder()
                        .setTitle("Tyre Pulse")
                        .setSubtitle(reason)
                        .setNegativeButtonText("Cancel")
                        .setAllowedAuthenticators(
                            BiometricManager.Authenticators.BIOMETRIC_STRONG,
                        )
                        .build(),
                )
            }
    }
}
