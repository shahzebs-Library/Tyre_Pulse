library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/data/accident_repository.dart';

final accidentRemoteSourceProvider = Provider<AccidentRemoteSource>(
  (ref) => SupabaseAccidentRemoteSource(ref.watch(supabaseClientProvider)),
);

final accidentRepositoryProvider = Provider<AccidentRepository>(
  (ref) => SupabaseAccidentRepository(ref.watch(accidentRemoteSourceProvider)),
);

final accidentPhotoCaptureProvider = Provider<AccidentPhotoCapture>(
  (ref) => AccidentPhotoCapture(),
);
