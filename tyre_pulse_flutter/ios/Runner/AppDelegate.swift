import Flutter
import LocalAuthentication
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(
      forPlugin: "TyrePulseDeviceSecurity"
    ) else {
      return
    }
    let channel = FlutterMethodChannel(
      name: "com.shahzebrahman.tyrepulse/device_security",
      binaryMessenger: registrar.messenger()
    )
    channel.setMethodCallHandler { call, result in
      guard call.method == "authenticate" else {
        result(FlutterMethodNotImplemented)
        return
      }

      let arguments = call.arguments as? [String: Any]
      let reason = (arguments?["reason"] as? String)?.trimmingCharacters(
        in: .whitespacesAndNewlines
      )
      let context = LAContext()
      var error: NSError?
      guard context.canEvaluatePolicy(
        .deviceOwnerAuthenticationWithBiometrics,
        error: &error
      ) else {
        let outcome = error?.code == LAError.biometryLockout.rawValue
          ? "lockedOut"
          : "unavailable"
        result(outcome)
        return
      }

      context.evaluatePolicy(
        .deviceOwnerAuthenticationWithBiometrics,
        localizedReason: reason?.isEmpty == false
          ? reason!
          : "Confirm your identity to sign in to Tyre Pulse"
      ) { authenticated, evaluationError in
        DispatchQueue.main.async {
          if authenticated {
            result("authenticated")
            return
          }
          guard let authError = evaluationError as? LAError else {
            result("failed")
            return
          }
          switch authError.code {
          case .userCancel, .appCancel, .systemCancel:
            result("cancelled")
          case .biometryLockout:
            result("lockedOut")
          case .biometryNotAvailable, .biometryNotEnrolled:
            result("unavailable")
          default:
            result("failed")
          }
        }
      }
    }
  }
}
