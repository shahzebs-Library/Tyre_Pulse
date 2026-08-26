/// Changing the active workspace.
///
/// Spec section 8 lists five obligations. Artifact 04 section 5.7 makes each
/// one concrete, and one of them is an obligation to do NOTHING:
///
/// 1. Rebuild the context and RE-FETCH the profile. `country` and `sites` are
///    server-owned and can change under the user (V227 pushes permission and
///    profile changes to an open session).
/// 2. Drop every scoped query cache. A cached `vehicle_fleet` page from country
///    A is not a subset of country B, it is a DIFFERENT FLEET WITH COLLIDING
///    KEYS. V376 measured this on 216,792 live rows: 1,300 asset codes carry
///    spend, 221 exist in two countries, 57 bill concurrently in two or more
///    months. `GN103` is a CATERPILLAR generator in KSA and a Sany one in UAE.
///    An asset is identified by (country, asset_no), never by `asset_no` alone.
/// 3. Refresh the affected local cache.
/// 4. **Do NOT touch the outbound command queue.** A queued observation was
///    recorded in the workspace it was captured in and must sync with the
///    country it was stamped with, not the one now selected. There is no queue
///    method on [WorkspaceDependencies] at all, so this file cannot rewrite a
///    queued row even by mistake.
/// 5. Re-derive currency and locale from the new country, never from a default.
///
/// # Why an offline switch is refused
///
/// Step 1 is not optional, so a switch cannot complete while the profile is
/// unreachable. Switching into a country whose scope cannot be confirmed would
/// build a client filter that silently returns nothing, and "no rows" reads to
/// a field user as "the data is gone", not as "you are offline". Refusing, with
/// a sentence, is the honest outcome. Work already captured stays queued and
/// unaffected either way.
///
/// # Why the scope is validated AFTER the reload, not before
///
/// The scope can GROW as well as shrink under the user. Validating against the
/// context in hand would refuse a switch to a country the administrator granted
/// thirty seconds ago, and the reload happens anyway.
library;

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

/// What the user asked for.
final class WorkspaceSelection {
  const WorkspaceSelection({this.country, this.sites = const <String>[]});

  /// Everything the profile permits: no country filter, no site filter.
  const WorkspaceSelection.everythingInScope()
    : country = null,
      sites = const <String>[];

  /// The single country to work in, or null for "everything in scope".
  final String? country;

  /// The sites to narrow to. Empty means every site the profile permits.
  final List<String> sites;

  @override
  String toString() {
    const String all = 'all in scope';
    final String countryText = country ?? all;
    final String siteText = sites.isEmpty ? all : sites.join(', ');
    return 'WorkspaceSelection(country: $countryText, sites: $siteText)';
  }
}

/// What changed, handed to the cache layer so it can invalidate precisely.
final class WorkspaceChange {
  const WorkspaceChange({required this.previous, required this.next});

  final WorkspaceContext previous;
  final WorkspaceContext next;

  bool get countryChanged => previous.activeCountry != next.activeCountry;

  bool get siteSelectionChanged =>
      !_sameStringLists(previous.activeSites, next.activeSites);

  bool get roleChanged => previous.role != next.role;

  bool get countryScopeChanged => previous.countryScope != next.countryScope;

  bool get siteScopeChanged => previous.siteScope != next.siteScope;

  /// True when anything that bounds a query changed. A cache layer that only
  /// wants one signal should use this one.
  bool get affectsScopedReads =>
      countryChanged ||
      siteSelectionChanged ||
      countryScopeChanged ||
      siteScopeChanged;

  @override
  String toString() {
    const String all = 'all in scope';
    final String from = previous.activeCountry ?? all;
    final String to = next.activeCountry ?? all;
    return 'WorkspaceChange($from -> $to, '
        'sites ${previous.activeSites} -> ${next.activeSites})';
  }
}

bool _sameStringLists(List<String> a, List<String> b) {
  if (identical(a, b)) {
    return true;
  }
  if (a.length != b.length) {
    return false;
  }
  for (int i = 0; i < a.length; i++) {
    if (a[i] != b[i]) {
      return false;
    }
  }
  return true;
}

/// The narrow surface a workspace change needs from layers this file does not
/// own.
///
/// Deliberately small. The local database, the read caches and the currency
/// table belong to other parts of the application; this file depends on the
/// abstraction and implements none of it. Note what is ABSENT: there is no
/// method here that can reach the outbound command queue.
abstract interface class WorkspaceDependencies {
  /// Re-reads the `profiles` row. Country and site scope are server-owned.
  Future<WorkspaceProfile> loadProfile();

  /// Re-reads the permission maps.
  ///
  /// Called ONLY when the reloaded profile carries a different role or
  /// super-admin flag from the one in hand, because
  /// `get_user_module_permissions` is filtered by `profiles.role`: a role
  /// change makes the matrix in memory answer for somebody else. A country
  /// change does not affect permissions, and the realtime subscriptions on
  /// `user_access_grants` and `module_permissions` already keep an open session
  /// current, so making this call on every switch would buy nothing and cost a
  /// round trip on a field connection.
  Future<AccessState> reloadAccessState(WorkspaceProfile profile);

  /// The currency for [country], from the server's own mapping.
  ///
  /// Returns null when the server has no mapping for that country. It must
  /// NEVER return a default. A null renders as a dash or as Unavailable.
  Future<String?> currencyForCountry(String country);

  /// Drops scoped read caches and marks scoped providers stale.
  Future<void> invalidateScopedReads(WorkspaceChange change);

  /// Warms whatever the new workspace needs. Optional work by nature: a
  /// failure here degrades speed, not correctness.
  Future<void> refreshScopedCache(WorkspaceChange change);
}

/// The ordered work a successful switch performs.
enum WorkspaceSwitchStep {
  profileReloaded,
  accessStateReloaded,
  selectionValidated,
  currencyResolved,
  contextRebuilt,
  scopedReadsInvalidated,
  scopedCacheRefreshed,
  navigationRecomputed,
}

/// The result of a switch.
sealed class WorkspaceSwitchOutcome {
  const WorkspaceSwitchOutcome({
    required this.context,
    required this.completedSteps,
  });

  /// The context that is now active. On a refusal this is the UNCHANGED
  /// context that was already in force - a refused switch never leaves the
  /// application half moved.
  final WorkspaceContext context;

  final List<WorkspaceSwitchStep> completedSteps;

  /// The outbound command queue is never read, rewritten or reordered by a
  /// workspace change. Stated as a value so a test can assert it and a reviewer
  /// can see it was a decision rather than an omission.
  bool get outboundQueueUntouched => true;
}

/// The switch completed. [warnings] may be non-empty: the workspace moved, but
/// something optional failed and is reported rather than swallowed.
final class WorkspaceSwitchApplied extends WorkspaceSwitchOutcome {
  const WorkspaceSwitchApplied({
    required super.context,
    required super.completedSteps,
    required this.allowedModules,
    this.warnings = const <AppError>[],
  });

  /// Recomputed navigation. Spec section 8, obligation 5.
  final Set<ModuleKey> allowedModules;

  /// Non-fatal failures. Every entry is something a person may need to know,
  /// such as a currency that could not be resolved.
  final List<AppError> warnings;

  bool get hasWarnings => warnings.isNotEmpty;
}

/// The switch was refused. Nothing changed.
final class WorkspaceSwitchRefused extends WorkspaceSwitchOutcome {
  const WorkspaceSwitchRefused({
    required super.context,
    required super.completedSteps,
    required this.error,
  });

  final AppError error;
}

/// Performs a workspace change.
///
/// Pure Dart on purpose: no Flutter, no Riverpod, no BuildContext. The Riverpod
/// notifier in `workspace_providers.dart` is a thin adapter over this, so the
/// ordering rules above are unit-testable without a widget binding.
final class WorkspaceSwitcher {
  const WorkspaceSwitcher(
    this._dependencies, {
    this.precedence = AdminRevokePrecedence.serverAppUserCan,
  });

  final WorkspaceDependencies _dependencies;

  /// Which resolver ordering navigation is recomputed with. See
  /// [AdminRevokePrecedence]; the default follows the server.
  final AdminRevokePrecedence precedence;

  /// Moves [current] to [selection], or refuses and leaves it alone.
  Future<WorkspaceSwitchOutcome> switchTo({
    required WorkspaceContext current,
    required WorkspaceSelection selection,
  }) async {
    final List<WorkspaceSwitchStep> steps = <WorkspaceSwitchStep>[];
    final List<AppError> warnings = <AppError>[];

    // 1. Re-fetch the profile. Country and site scope are server-owned.
    final WorkspaceProfile profile;
    try {
      profile = await _dependencies.loadProfile();
    } on AppError catch (error) {
      return WorkspaceSwitchRefused(
        context: current,
        completedSteps: List<WorkspaceSwitchStep>.unmodifiable(steps),
        error: error,
      );
    } on Object catch (error) {
      return WorkspaceSwitchRefused(
        context: current,
        completedSteps: List<WorkspaceSwitchStep>.unmodifiable(steps),
        error: AppError(
          kind: AppErrorKind.sync,
          message:
              'Your workspace could not be changed because your profile '
              'could not be loaded. Check your connection and try again.',
          technical: 'loadProfile failed: $error',
          cause: error,
          isRetryable: true,
        ),
      );
    }
    steps.add(WorkspaceSwitchStep.profileReloaded);

    // 2. Refresh permissions only when the role or super-admin flag moved.
    AccessState access = current.effectivePermissions.copyWith(
      role: profile.role,
      isSuperAdmin: profile.isSuperAdmin,
    );
    final bool identityChanged =
        current.role != profile.role ||
        current.effectivePermissions.isSuperAdmin != profile.isSuperAdmin;
    if (identityChanged) {
      try {
        access = await _dependencies.reloadAccessState(profile);
        steps.add(WorkspaceSwitchStep.accessStateReloaded);
      } on Object catch (error) {
        // The role changed, so the matrix in memory answers for the previous
        // role and cannot be trusted. Marking it unavailable makes the three
        // administration modules fail CLOSED while every ordinary module falls
        // through to the role default and the field user keeps working.
        access = access.copyWith(permissionsError: true);
        warnings.add(
          AppError(
            kind: AppErrorKind.authorization,
            message:
                'Your permissions could not be reloaded after your role '
                'changed. Administration sections stay closed until they load.',
            technical: 'reloadAccessState failed: $error',
            cause: error,
          ),
        );
      }
    }

    // 3. Validate the request against the RELOADED scope.
    final AppError? refusal = _validate(selection, profile);
    if (refusal != null) {
      return WorkspaceSwitchRefused(
        context: current,
        completedSteps: List<WorkspaceSwitchStep>.unmodifiable(steps),
        error: refusal,
      );
    }
    steps.add(WorkspaceSwitchStep.selectionValidated);

    // 4. Currency, from the server. Never defaulted, never guessed.
    String? currency;
    bool currencyLookupFailed = false;
    final String? country = selection.country;
    if (country != null) {
      try {
        currency = await _dependencies.currencyForCountry(country);
      } on Object catch (error) {
        currency = null;
        currencyLookupFailed = true;
        warnings.add(
          AppError(
            kind: AppErrorKind.server,
            message:
                'The currency for this country could not be loaded. '
                'Amounts will be shown without a currency until it does.',
            technical: 'currencyForCountry($country) failed: $error',
            cause: error,
            isRetryable: true,
          ),
        );
      }
      if (currency == null && !currencyLookupFailed) {
        warnings.add(
          AppError(
            kind: AppErrorKind.server,
            message:
                'No currency is configured for this country. Amounts will '
                'be shown without a currency.',
            technical: 'currencyForCountry($country) returned null',
          ),
        );
      }
    }
    steps.add(WorkspaceSwitchStep.currencyResolved);

    // 5. Rebuild the context.
    final WorkspaceContext next = WorkspaceContext.fromProfile(
      profile,
      effectivePermissions: access,
      activeCountry: country,
      activeSites: selection.sites,
      currency: currency,
    );
    steps.add(WorkspaceSwitchStep.contextRebuilt);

    final WorkspaceChange change = WorkspaceChange(
      previous: current,
      next: next,
    );

    // 6. Invalidate scoped reads. The context has already moved, so a failure
    //    here is reported and the switch STANDS: reverting after invalidating
    //    would leave the caches pointing at a workspace nobody is in.
    try {
      await _dependencies.invalidateScopedReads(change);
      steps.add(WorkspaceSwitchStep.scopedReadsInvalidated);
    } on Object catch (error) {
      warnings.add(
        AppError(
          kind: AppErrorKind.storage,
          message:
              'Some saved data from your previous workspace could not be '
              'cleared. Pull to refresh if a screen looks out of date.',
          technical: 'invalidateScopedReads failed: $error',
          cause: error,
          isRetryable: true,
        ),
      );
    }

    // 7. Warm the new workspace. Optional by nature.
    try {
      await _dependencies.refreshScopedCache(change);
      steps.add(WorkspaceSwitchStep.scopedCacheRefreshed);
    } on Object catch (error) {
      warnings.add(
        AppError(
          kind: AppErrorKind.storage,
          message:
              'This workspace could not be prepared for offline use yet. '
              'It will fill in as you use it.',
          technical: 'refreshScopedCache failed: $error',
          cause: error,
          isRetryable: true,
        ),
      );
    }

    // 8. The outbound command queue is deliberately NOT touched. Obligation 4.

    // 9. Recompute navigation.
    final Set<ModuleKey> modules = allowedModulesFor(
      access,
      precedence: precedence,
    );
    steps.add(WorkspaceSwitchStep.navigationRecomputed);

    return WorkspaceSwitchApplied(
      context: next,
      completedSteps: List<WorkspaceSwitchStep>.unmodifiable(steps),
      allowedModules: Set<ModuleKey>.unmodifiable(modules),
      warnings: List<AppError>.unmodifiable(warnings),
    );
  }

  /// Client-side sanity only. RLS is the boundary and it will refuse a
  /// cross-scope read whatever this returns. The point of checking here is that
  /// a refusal can EXPLAIN itself, where RLS would simply return nothing and
  /// read as missing data.
  AppError? _validate(WorkspaceSelection selection, WorkspaceProfile profile) {
    final String? country = selection.country;
    if (country != null &&
        !profile.countryScope.canSee(
          country,
          isSuperAdmin: profile.isSuperAdmin,
        )) {
      return AppError.authorization(
        message:
            'You do not have access to $country. Contact your '
            'administrator if you need it.',
        technical:
            'country "$country" is outside '
            '${profile.countryScope.values}',
      );
    }

    for (final String site in selection.sites) {
      if (!profile.siteScope.canSee(
        site,
        isSuperAdmin: profile.isSuperAdmin,
        isAdminRole: profile.role.isAdministrator,
      )) {
        return AppError.authorization(
          message:
              'You do not have access to site $site. Contact your '
              'administrator if you need it.',
          technical: 'site "$site" is outside ${profile.siteScope.values}',
        );
      }
    }

    return null;
  }
}
