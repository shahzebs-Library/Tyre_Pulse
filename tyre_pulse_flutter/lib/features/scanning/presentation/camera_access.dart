/// Whether this build can offer a live camera scan surface, and if not, why.
///
/// # The dependency gap this file exists because of
///
/// No barcode/QR/camera plugin is declared in `pubspec.yaml`. Spec section
/// 64: a package is added deliberately, by whoever reviews the whole app's
/// dependency footprint, never to unblock one screen. So
/// [cameraAccessProvider]'s only implementation today can honestly produce
/// exactly one answer - [CameraUnavailableInThisBuild] - because that is
/// the complete truth about this build: there is no plugin here to ask a
/// permission question of.
///
/// [CameraAccessDenied] and [CameraAccessGranted] exist so the rest of this
/// feature - the sealed switch in the scanner screen's camera area, and its
/// test - are already correct for the day a scanning package IS added.
/// Wiring a real package's own permission handling in then becomes the
/// ONLY change needed: override [cameraAccessProvider] with an
/// implementation backed by it. Nothing downstream has to change shape,
/// including the [TpPermissionDeniedState] branch that today cannot be
/// reached in production but is fully built and testable.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether a live camera scan surface is available right now, and why not
/// when it is not.
@immutable
sealed class CameraAccess {
  const CameraAccess();
}

/// No scanning/camera plugin exists in this build.
///
/// A BUILD-TIME gap, never influenced by anything the person taps - and the
/// only value [cameraAccessProvider] can honestly produce today.
final class CameraUnavailableInThisBuild extends CameraAccess {
  const CameraUnavailableInThisBuild();
}

/// The OS or the person declined camera access.
///
/// [reason] must be concrete - "Camera access was declined in your device
/// settings", never a bare "Denied" - so `TpPermissionDeniedState`, which
/// REQUIRES a reason and has no constructor that omits one, always has
/// something specific to say.
final class CameraAccessDenied extends CameraAccess {
  const CameraAccessDenied({required this.reason});

  final String reason;
}

/// A live camera preview may be shown.
final class CameraAccessGranted extends CameraAccess {
  const CameraAccessGranted();
}

/// Reports [CameraAccess] for this build.
///
/// Always resolves to [CameraUnavailableInThisBuild] today - see the
/// library comment. Overriding this provider, in a test or once a real
/// camera package exists, is the only way [CameraAccessDenied] or
/// [CameraAccessGranted] is ever produced.
final Provider<CameraAccess> cameraAccessProvider = Provider<CameraAccess>(
  (ref) => const CameraUnavailableInThisBuild(),
);
