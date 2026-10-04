/// Riverpod wiring for "Sign in on a computer".
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/qr_login/data/qr_login_repository.dart';

final Provider<QrLoginRepository> qrLoginRepositoryProvider =
    Provider<QrLoginRepository>(
  (ref) => SupabaseQrLoginRepository.fromClient(
    ref.watch(supabaseClientProvider),
  ),
);

/// The signed-in person's full name for the confirm sheet, or null when the
/// profile carries none (the sheet then says "your account" - a name is
/// never invented). Its own provider so a widget test needs no auth stack.
final Provider<String?> qrLoginPersonNameProvider = Provider<String?>((ref) {
  final String? name = ref.watch(authControllerProvider).profile?.fullName;
  final String trimmed = (name ?? '').trim();
  return trimmed.isEmpty ? null : trimmed;
});
