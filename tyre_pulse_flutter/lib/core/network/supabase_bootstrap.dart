/// Starts the Supabase client once, before `runApp`.
///
/// # Why this file exists
///
/// There is no application server (`AGENTS.md` rule 3): every remote call in
/// this codebase is PostgREST on a real table, a Postgres RPC, or a Supabase
/// Edge Function, and all three run through one `SupabaseClient`. That client
/// does not exist until `Supabase.initialize` completes, so this function is
/// the one place startup ordering is enforced - nothing that reads
/// `supabaseClientProvider` (`supabase_client_provider.dart`) may run before
/// this does.
///
/// # Not called from anywhere yet
///
/// The composition root (`lib/main.dart`) wires this before `runApp` in a
/// later integration pass that also wires the storage, auth and sync lanes'
/// `ProviderScope` overrides in one place - deliberately, so several
/// concurrently-written lanes are not racing edits to that single file.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/app/config/app_config.dart';
import 'package:tyre_pulse/core/network/supabase_local_storage_adapter.dart';
import 'package:tyre_pulse/core/storage/secure_key_value_store.dart';

/// The in-flight or completed initialization, so a second call is a safe
/// no-op rather than whatever `Supabase.initialize` itself does when invoked
/// twice.
///
/// That re-entrancy behaviour is UNVERIFIED without the SDK installed - see
/// the "UNVERIFIED" section of `supabase_local_storage_adapter.dart`'s
/// library comment for why this project cannot check it here. Owning
/// idempotency at THIS level, entirely in code this project controls, means
/// it does not matter what the SDK does on a second call, because there
/// never is one.
Future<void>? _initialization;

/// Starts the Supabase client, backed by [localStorage] for session
/// persistence.
///
/// Safe to call more than once: a second call, whether it arrives while the
/// first is still running or after it already succeeded, returns the SAME
/// future rather than starting a second client. A call made after a FAILED
/// attempt starts a fresh one, so a transient startup failure - no network on
/// first launch, for example - does not permanently wedge every later retry.
Future<void> initializeSupabase({
  required AppConfig config,
  required SecureKeyValueStore localStorage,
}) {
  return _initialization ??= _initialize(config, localStorage);
}

Future<void> _initialize(
  AppConfig config,
  SecureKeyValueStore localStorage,
) async {
  try {
    await Supabase.initialize(
      url: config.supabaseUrl,
      anonKey: config.supabaseAnonKey,
      localStorage: SupabaseLocalStorageAdapter(localStorage),
    );
  } on Object {
    // A failed attempt must not permanently block a later retry - the next
    // call to `initializeSupabase` should try again, not replay this one
    // failure forever.
    _initialization = null;
    rethrow;
  }
}
