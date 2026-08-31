/// Whether this build can offer a live camera scan surface, and if not, why.
///
/// The production scanner package owns the operating-system permission prompt.
/// This seam remains useful for deterministic widget tests and for builds that
/// intentionally disable camera support.
///
/// [CameraAccessDenied] and [CameraUnavailableInThisBuild] are explicit
/// override values rather than guesses made from platform names.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether a live camera scan surface is available right now, and why not
/// when it is not.
@immutable
sealed class CameraAccess {
  const CameraAccess();
}

/// This build intentionally has no camera surface.
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
/// Production enables the camera. Tests can override this with a deterministic
/// denied or unavailable state without starting a platform camera channel.
final Provider<CameraAccess> cameraAccessProvider = Provider<CameraAccess>(
  (ref) => const CameraAccessGranted(),
);
