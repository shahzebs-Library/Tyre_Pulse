/// Riverpod wiring for the Fleet Supervisor team screens.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/features/handover/data/handover_photo_capture.dart';

export 'package:tyre_pulse/features/fleet_supervisor/data/fleet_team_repository.dart'
    show FleetTeamRepository, fleetTeamRepositoryProvider, FleetOfflineFailure;

/// Picks one evidence photo and returns its local path, or null when the user
/// cancelled. Reuses the handover capture, which resizes to 1600 px at
/// quality 50 and keeps the file until it is uploaded.
typedef FleetPhotoPicker = Future<String?> Function({required bool camera});

final Provider<FleetPhotoPicker> fleetPhotoPickerProvider =
    Provider<FleetPhotoPicker>((Ref ref) {
  final HandoverPhotoCapture capture = HandoverPhotoCapture();
  return ({required bool camera}) => capture.capture(
        sessionKey: 'fleet-charge',
        source:
            camera ? HandoverPhotoSource.camera : HandoverPhotoSource.gallery,
      );
});
