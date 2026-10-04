/// Riverpod wiring for "Report a problem".
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/problem_report/data/device_context_reader.dart';
import 'package:tyre_pulse/features/problem_report/data/problem_report_repository.dart';

final Provider<ProblemReportRepository> problemReportRepositoryProvider =
    Provider<ProblemReportRepository>(
  (ref) => SupabaseProblemReportRepository.fromClient(
    ref.watch(supabaseClientProvider),
  ),
);

final Provider<DeviceContextReader> deviceContextReaderProvider =
    Provider<DeviceContextReader>((ref) => DeviceInfoPlusContextReader());

/// Read once per app run; the device does not change.
final FutureProvider<DeviceDescription> deviceDescriptionProvider =
    FutureProvider<DeviceDescription>(
  (ref) => ref.watch(deviceContextReaderProvider).read(),
);
