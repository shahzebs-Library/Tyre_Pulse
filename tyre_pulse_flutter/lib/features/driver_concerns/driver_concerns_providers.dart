/// Riverpod wiring for Driver Concerns.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/features/driver_concerns/data/driver_concern_repository.dart'
    show keepConcernPhoto;
import 'package:tyre_pulse/features/handover/data/handover_photo_capture.dart';

export 'package:tyre_pulse/features/driver_concerns/data/driver_concern_repository.dart'
    show DriverConcernRepository, driverConcernRepositoryProvider;

/// Picks one evidence photo and returns its local path, or null when the user
/// cancelled. Reuses the handover capture (resized, kept until uploaded).
typedef ConcernPhotoPicker = Future<String?> Function({required bool camera});

final Provider<ConcernPhotoPicker> concernPhotoPickerProvider =
    Provider<ConcernPhotoPicker>((Ref ref) {
  final HandoverPhotoCapture capture = HandoverPhotoCapture();
  return ({required bool camera}) => capture.capture(
        sessionKey: 'driver-concern',
        source:
            camera ? HandoverPhotoSource.camera : HandoverPhotoSource.gallery,
      );
});

/// Copies a picked photo into the app documents folder (overridable in tests).
typedef ConcernPhotoKeeper = Future<String> Function(String pickedPath);

final Provider<ConcernPhotoKeeper> concernPhotoKeeperProvider =
    Provider<ConcernPhotoKeeper>((Ref ref) => keepConcernPhoto);
