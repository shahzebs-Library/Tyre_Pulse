/// Loading the `profiles` row for a signed-in user, with an offline fallback.
///
/// # Verification, per AGENTS.md rule 3 and spec section 62
///
/// `profiles` is `SupabaseTables.profiles`. Every column selected below is one
/// [WorkspaceProfile.fromRow] actually reads - `id`, `role`, `country`,
/// `sites`, `org_id`, `organisation_id`, `is_super_admin`, `approved`,
/// `locked`, `site`, `full_name` - cross-checked against that factory's own
/// body in `lib/core/workspace/workspace_context.dart` and against the
/// production column list in `mobile/contexts/AuthContext.tsx`'s `fetchProfile`
/// (`id,full_name,username,role,email,employee_id,site,country,approved,
/// locked,is_super_admin,created_at`). This selection intentionally omits
/// `username`, `email`, `employee_id` and `created_at`: nothing in this lane
/// reads them, and AGENTS.md rule 4 ("never hard-code a column list wider than
/// what is used") is best honoured by asking for exactly what is consumed.
///
/// `country` and `sites` are `text[]`, decoded by [WorkspaceProfile.fromRow]
/// via [CountryScope]/[SiteScope] - never treated as a scalar. That exact
/// column-type mistake is the one AGENTS.md names as the reason the Kotlin
/// rebuild broke login for most users.
library;

import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/auth/auth_lifecycle.dart';
import 'package:tyre_pulse/core/auth/profile_cache.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

/// The exact columns [WorkspaceProfile.fromRow] reads. Kept as one constant so
/// the query and the decoder cannot silently drift apart.
const String _profileColumns =
    'id, role, country, sites, org_id, organisation_id, is_super_admin, '
    'approved, locked, site, full_name';

/// The result of one profile fetch attempt.
sealed class ProfileFetchOutcome {
  const ProfileFetchOutcome();
}

/// A usable profile was obtained, either live or from the offline cache.
final class ProfileFetchSucceeded extends ProfileFetchOutcome {
  const ProfileFetchSucceeded(this.profile, {this.stale = false});

  final WorkspaceProfile profile;

  /// True when [profile] came from the offline cache rather than a live read,
  /// because the server could not be reached. Access is unchanged either way -
  /// every read still needs a live session and still passes RLS - this exists
  /// only so a screen may show a quiet "working offline" hint.
  final bool stale;
}

/// No usable profile could be obtained: the live read failed and there was
/// nothing usable in the offline cache either.
final class ProfileFetchFailed extends ProfileFetchOutcome {
  const ProfileFetchFailed(this.error);

  final AppError error;
}

/// The narrow surface [AuthController] needs to load a profile.
abstract interface class ProfileRepository {
  /// Fetches the `profiles` row for [userId]. Never throws.
  Future<ProfileFetchOutcome> fetchProfile(String userId);
}

/// The real implementation: PostgREST, backed by [ProfileCache] when the live
/// read fails.
final class SupabaseProfileRepository implements ProfileRepository {
  SupabaseProfileRepository(this._client, this._cache);

  final SupabaseClient _client;
  final ProfileCache _cache;

  @override
  Future<ProfileFetchOutcome> fetchProfile(String userId) async {
    final AppError liveError;
    try {
      final Map<String, dynamic> row = await _client
          .from(SupabaseTables.profiles)
          .select(_profileColumns)
          .eq('id', userId)
          .single()
          .timeout(profileLoadTimeout);
      final WorkspaceProfile profile = WorkspaceProfile.fromRow(row);
      unawaited(_cache.save(userId, row));
      return ProfileFetchSucceeded(profile);
    } on AppError catch (error) {
      // WorkspaceProfile.fromRow threw - a row with no usable id. Treated
      // exactly like a read failure: fall back to the cache, then fail.
      liveError = error;
    } on Object catch (error) {
      liveError = mapSupabaseError(error);
    }

    // The live read failed. This is normally a dead network - the everyday
    // case for this app: an inspector opens it in a yard with no bars. Failing
    // closed here would lock them out of the app entirely, including the
    // offline inspections already queued on their own phone - the one thing
    // they most need to reach. So fall back to the last profile this device
    // itself verified for THIS user id.
    final Map<String, Object?>? cachedRow = await _cache.load(userId);
    if (cachedRow != null) {
      try {
        return ProfileFetchSucceeded(
          WorkspaceProfile.fromRow(cachedRow),
          stale: true,
        );
      } on AppError {
        // A cached row that no longer decodes (schema moved on since it was
        // written) is not usable either. Fall through to reporting the live
        // failure - the honest answer, not a crash over a stale cache.
      }
    }

    return ProfileFetchFailed(liveError);
  }
}
