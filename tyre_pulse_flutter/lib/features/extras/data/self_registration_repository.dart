/// Self-registration: the pre-auth registration switch and the sign-up call.
///
/// Mirrors the web `handleSignup` in `src/pages/Login.jsx`, the one live
/// self-registration path:
/// - `get_public_config` (V286, anon-safe) is read BEFORE the form is shown
///   and again right before the account is created, so a switch flipped off
///   after the screen opened still blocks the sign-up. `registration_open` or
///   the legacy `allow_signups` set to `'false'` closes registration.
/// - Supabase Auth needs an email; people register with a username and an
///   employee id, so a synthetic non-routable address is minted from the
///   username. Login by username or employee id resolves back to it.
/// - Metadata carries ONLY `username`, `full_name` and `employee_id`. The
///   client never sends a role, site, organisation or country: the
///   `handle_new_user` trigger decides all of them (a pending `Reporter`,
///   approved only when `require_approval` is explicitly off).
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// The switch as the server reported it.
final class RegistrationPolicy {
  const RegistrationPolicy({required this.open, required this.minPassword});

  /// False only when the server explicitly said closed.
  final bool open;

  /// `password_min_length`, never below the 6-character floor, default 8.
  final int minPassword;
}

/// How a sign-up attempt ended.
enum SelfRegistrationResult {
  /// The account exists and waits for an administrator.
  created,

  /// Registration was closed at the moment of the attempt.
  closed,

  /// The username or employee id is already taken.
  taken,

  /// No connection.
  offline,

  /// Anything else.
  failed,
}

/// Minimum password length when the server gives no policy.
const int kDefaultMinPassword = 8;

/// The floor no configuration may go below.
const int kPasswordFloor = 6;

/// Allowed username characters, matching the web form.
final RegExp kUsernamePattern = RegExp(r'^[a-zA-Z0-9._-]+$');

/// The synthetic address minted from [username], exactly as the web does.
String syntheticEmailFor(String username) {
  String slug = username
      .trim()
      .toLowerCase()
      .replaceAll(RegExp('[^a-z0-9]+'), '.')
      .replaceAll(RegExp(r'^\.+|\.+$'), '');
  if (slug.isEmpty) slug = 'user';
  return '$slug@users.tyrepulse.app';
}

/// Reads a policy from a `get_public_config` body. A missing or unreadable
/// body is treated as open with the default length: the server re-checks on
/// sign-up, so failing open here only costs the person a clear message later.
RegistrationPolicy policyFromConfig(Object? body) {
  if (body is! Map) {
    return const RegistrationPolicy(
      open: true,
      minPassword: kDefaultMinPassword,
    );
  }
  bool closed(Object? value) =>
      value?.toString().trim().toLowerCase() == 'false';
  final bool open =
      !closed(body['registration_open']) && !closed(body['allow_signups']);
  final int? configured =
      int.tryParse((body['password_min_length'] ?? '').toString().trim());
  final int min = configured == null
      ? kDefaultMinPassword
      : (configured < kPasswordFloor ? kPasswordFloor : configured);
  return RegistrationPolicy(open: open, minPassword: min);
}

/// Boundary the screen talks to.
abstract interface class SelfRegistrationRepository {
  /// Null when the policy could not be read at all (offline).
  Future<RegistrationPolicy?> loadPolicy();

  Future<SelfRegistrationResult> register({
    required String username,
    required String employeeId,
    required String password,
    String? fullName,
  });
}

/// Production implementation.
final class SupabaseSelfRegistrationRepository
    implements SelfRegistrationRepository {
  SupabaseSelfRegistrationRepository(this._client);

  final SupabaseClient _client;

  static const Duration _timeout = Duration(seconds: 15);

  @override
  Future<RegistrationPolicy?> loadPolicy() async {
    try {
      final Object? body = await _client
          .rpc<Object?>(SupabaseRpcs.getPublicConfig)
          .timeout(_timeout);
      return policyFromConfig(body);
    } on Object {
      return null;
    }
  }

  @override
  Future<SelfRegistrationResult> register({
    required String username,
    required String employeeId,
    required String password,
    String? fullName,
  }) async {
    final RegistrationPolicy? policy = await loadPolicy();
    if (policy == null) return SelfRegistrationResult.offline;
    if (!policy.open) return SelfRegistrationResult.closed;
    final String name = (fullName ?? '').trim();
    try {
      await _client.auth.signUp(
        email: syntheticEmailFor(username),
        password: password,
        data: <String, Object?>{
          'username': username.trim(),
          'full_name': name.isEmpty ? null : name,
          'employee_id': employeeId.trim(),
        },
      ).timeout(_timeout);
      return SelfRegistrationResult.created;
    } on AuthException catch (error) {
      return classifySignUpError(error.message);
    } on Object catch (error) {
      final String text = error.toString().toLowerCase();
      if (text.contains('socket') ||
          text.contains('clientexception') ||
          text.contains('timeout')) {
        return SelfRegistrationResult.offline;
      }
      return SelfRegistrationResult.failed;
    }
  }
}

/// A sign-up error message mapped to a result. The pattern matches the web,
/// which reads a duplicate username through the synthetic email collision.
SelfRegistrationResult classifySignUpError(String message) {
  final bool taken = RegExp(
    'already registered|already been registered|duplicate|already exists|'
    'database error',
    caseSensitive: false,
  ).hasMatch(message);
  return taken ? SelfRegistrationResult.taken : SelfRegistrationResult.failed;
}
