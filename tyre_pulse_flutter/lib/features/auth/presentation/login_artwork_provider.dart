/// Riverpod state for the login artwork chosen by an administrator.
///
/// Starts on each country's own landmark so the first frame never waits,
/// then applies the device cache, then the live server value (saving it for
/// the next offline start). Failures keep whatever is already showing.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/auth/data/login_artwork_repository.dart';
import 'package:tyre_pulse/features/auth/domain/login_artwork.dart';

/// Overridable boundary for tests.
final Provider<LoginArtworkRepository> loginArtworkRepositoryProvider =
    Provider<LoginArtworkRepository>((Ref ref) {
  return SupabaseLoginArtworkRepository(
    client: () => ref.read(supabaseClientProvider),
  );
});

/// The resolved per-country artwork.
final NotifierProvider<LoginArtworkController, LoginArtworkChoice>
    loginArtworkProvider =
    NotifierProvider<LoginArtworkController, LoginArtworkChoice>(
  LoginArtworkController.new,
);

final class LoginArtworkController extends Notifier<LoginArtworkChoice> {
  bool _remoteApplied = false;

  @override
  LoginArtworkChoice build() {
    _remoteApplied = false;
    Future<void>.microtask(_load);
    return LoginArtworkChoice.defaults;
  }

  Future<void> _load() async {
    try {
      final LoginArtworkRepository repo =
          ref.read(loginArtworkRepositoryProvider);
      final LoginArtworkChoice? cached = await repo.readCached();
      if (!ref.mounted) return;
      if (cached != null && !_remoteApplied) state = cached;
    } on Object {
      // No cache available: keep the landmarks and still try the server.
    }
    await refresh();
  }

  /// Re-reads the server value (e.g. when the login screen reopens).
  /// Never throws: a failure keeps the picture already showing.
  Future<void> refresh() async {
    try {
      if (!ref.mounted) return;
      final LoginArtworkRepository repo =
          ref.read(loginArtworkRepositoryProvider);
      final LoginArtworkChoice? remote = await repo.fetchRemote();
      if (!ref.mounted || remote == null) return;
      _remoteApplied = true;
      state = remote;
      await repo.saveCached(remote);
    } on Object {
      // Presentation only; the login form keeps working.
    }
  }
}
