import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_switch.dart';

/// A hand-written fake rather than a mock, so the RECORDED CALL LIST is part of
/// the assertion. The queue rule is a rule about what is NOT called, and a call
/// list is the only way to test that.
final class FakeDependencies implements WorkspaceDependencies {
  FakeDependencies(this.profile);

  WorkspaceProfile profile;

  /// Every method this fake was asked for, in order.
  final List<String> calls = <String>[];

  Object? profileError;
  Object? accessError;
  Object? currencyError;
  Object? invalidateError;
  Object? refreshError;

  String? currency = 'AED';
  AccessState? accessOnReload;
  WorkspaceChange? lastChange;

  @override
  Future<WorkspaceProfile> loadProfile() async {
    calls.add('loadProfile');
    _raiseIfSet(profileError);
    return profile;
  }

  @override
  Future<AccessState> reloadAccessState(WorkspaceProfile reloaded) async {
    calls.add('reloadAccessState');
    _raiseIfSet(accessError);
    return accessOnReload ?? AccessState(role: reloaded.role);
  }

  @override
  Future<String?> currencyForCountry(String country) async {
    calls.add('currencyForCountry:$country');
    _raiseIfSet(currencyError);
    return currency;
  }

  @override
  Future<void> invalidateScopedReads(WorkspaceChange change) async {
    calls.add('invalidateScopedReads');
    lastChange = change;
    _raiseIfSet(invalidateError);
  }

  @override
  Future<void> refreshScopedCache(WorkspaceChange change) async {
    calls.add('refreshScopedCache');
    _raiseIfSet(refreshError);
  }

  /// Rethrows a configured failure with its own static type, so the throw
  /// satisfies `only_throw_errors`.
  void _raiseIfSet(Object? error) {
    if (error == null) {
      return;
    }
    if (error is AppError) {
      throw error;
    }
    if (error is Error) {
      throw error;
    }
    throw StateError('fake configured with an unthrowable value: $error');
  }
}

/// The five methods on the interface. Anything outside this list would mean the
/// switch reached a layer it has no business in.
const Set<String> permittedCalls = <String>{
  'loadProfile',
  'reloadAccessState',
  'currencyForCountry',
  'invalidateScopedReads',
  'refreshScopedCache',
};

WorkspaceProfile profileFor({
  String role = 'Manager',
  List<String> countries = const <String>['KSA', 'UAE'],
  List<String> sites = const <String>['ALL'],
  bool isSuperAdmin = false,
}) =>
    WorkspaceProfile.fromRow(<String, Object?>{
      'id': 'user-1',
      'role': role,
      'country': countries,
      'sites': sites,
      'org_id': 'org-1',
      'organisation_id': 'org-1',
      'is_super_admin': isSuperAdmin,
      'approved': true,
      'locked': false,
      'site': 'NHC',
    });

WorkspaceContext contextFor(WorkspaceProfile profile) =>
    WorkspaceContext.fromProfile(
      profile,
      effectivePermissions: AccessState(role: profile.role),
      activeCountry: 'KSA',
      currency: 'SAR',
    );

void main() {
  group('a successful switch', () {
    test(
      'runs the five obligations in order and moves the workspace',
      () async {
        final WorkspaceProfile profile = profileFor();
        final FakeDependencies deps = FakeDependencies(profile);
        final WorkspaceContext current = contextFor(profile);

        final WorkspaceSwitchOutcome outcome =
            await WorkspaceSwitcher(deps).switchTo(
          current: current,
          selection: const WorkspaceSelection(
            country: 'UAE',
            sites: <String>['NHC'],
          ),
        );

        expect(outcome, isA<WorkspaceSwitchApplied>());
        final WorkspaceSwitchApplied applied =
            outcome as WorkspaceSwitchApplied;

        expect(applied.completedSteps, <WorkspaceSwitchStep>[
          WorkspaceSwitchStep.profileReloaded,
          WorkspaceSwitchStep.selectionValidated,
          WorkspaceSwitchStep.currencyResolved,
          WorkspaceSwitchStep.contextRebuilt,
          WorkspaceSwitchStep.scopedReadsInvalidated,
          WorkspaceSwitchStep.scopedCacheRefreshed,
          WorkspaceSwitchStep.navigationRecomputed,
        ]);

        expect(applied.context.activeCountry, 'UAE');
        expect(applied.context.currency, 'AED');
        expect(applied.context.siteIds, <String>['NHC']);
        expect(applied.hasWarnings, isFalse);
        expect(applied.allowedModules, isNotEmpty);
      },
    );

    test('hands the cache layer what actually changed', () async {
      final WorkspaceProfile profile = profileFor();
      final FakeDependencies deps = FakeDependencies(profile);

      await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(profile),
        selection: const WorkspaceSelection(country: 'UAE'),
      );

      final WorkspaceChange? change = deps.lastChange;
      expect(change, isNotNull);
      expect(change!.countryChanged, isTrue);
      expect(change.affectsScopedReads, isTrue);
      expect(change.previous.activeCountry, 'KSA');
      expect(change.next.activeCountry, 'UAE');
    });

    test('recomputes navigation from the resolver', () async {
      final WorkspaceProfile profile = profileFor(role: 'Driver');
      final FakeDependencies deps = FakeDependencies(profile);

      final WorkspaceSwitchApplied applied =
          await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(profile),
        selection: const WorkspaceSelection(country: 'UAE'),
      ) as WorkspaceSwitchApplied;

      expect(applied.allowedModules, contains(ModuleKey.meter));
      expect(applied.allowedModules, isNot(contains(ModuleKey.inspect)));
    });

    test('no country selected means no currency lookup at all', () async {
      final WorkspaceProfile profile = profileFor();
      final FakeDependencies deps = FakeDependencies(profile);

      final WorkspaceSwitchApplied applied =
          await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(profile),
        selection: const WorkspaceSelection.everythingInScope(),
      ) as WorkspaceSwitchApplied;

      expect(applied.context.activeCountry, isNull);
      expect(applied.context.currency, isNull);
      expect(applied.hasWarnings, isFalse);
      expect(
        deps.calls.where((String c) => c.startsWith('currencyForCountry')),
        isEmpty,
      );
    });
  });

  group('the outbound command queue is never touched', () {
    test('a switch only ever calls the five declared methods', () async {
      final WorkspaceProfile profile = profileFor();
      final FakeDependencies deps = FakeDependencies(profile);

      final WorkspaceSwitchOutcome outcome =
          await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(profile),
        selection: const WorkspaceSelection(country: 'UAE'),
      );

      for (final String call in deps.calls) {
        expect(
          permittedCalls,
          contains(call.split(':').first),
          reason: 'the switch reached $call, which is outside its interface',
        );
      }
      // A queued observation was recorded in the workspace it was captured in
      // and must sync with the country it was stamped with, not the one now
      // selected.
      expect(outcome.outboundQueueUntouched, isTrue);
    });
  });

  group('a refused switch changes nothing', () {
    test('an unreachable profile refuses rather than half switching', () async {
      final WorkspaceProfile profile = profileFor();
      final FakeDependencies deps = FakeDependencies(profile)
        ..profileError = StateError('offline');
      final WorkspaceContext current = contextFor(profile);

      final WorkspaceSwitchOutcome outcome =
          await WorkspaceSwitcher(deps).switchTo(
        current: current,
        selection: const WorkspaceSelection(country: 'UAE'),
      );

      expect(outcome, isA<WorkspaceSwitchRefused>());
      final WorkspaceSwitchRefused refused = outcome as WorkspaceSwitchRefused;

      expect(refused.context, same(current));
      expect(refused.context.activeCountry, 'KSA');
      expect(refused.completedSteps, isEmpty);
      expect(refused.error.kind, AppErrorKind.sync);
      expect(refused.error.isRetryable, isTrue);
      expect(refused.error.message, isNotEmpty);
      // Nothing downstream ran: no cache was cleared for a move that did not
      // happen.
      expect(deps.calls, <String>['loadProfile']);
    });

    test(
      'an AppError from the profile read is passed through unchanged',
      () async {
        const AppError original = AppError.network(technical: 'no route');
        final FakeDependencies deps = FakeDependencies(profileFor())
          ..profileError = original;

        final WorkspaceSwitchRefused refused =
            await WorkspaceSwitcher(deps).switchTo(
          current: contextFor(profileFor()),
          selection: const WorkspaceSelection(country: 'UAE'),
        ) as WorkspaceSwitchRefused;

        expect(refused.error, same(original));
      },
    );

    test(
      'a country outside the reloaded scope is refused, with a reason',
      () async {
        final WorkspaceProfile profile = profileFor(
          countries: const <String>['KSA'],
        );
        final FakeDependencies deps = FakeDependencies(profile);

        final WorkspaceSwitchRefused refused =
            await WorkspaceSwitcher(deps).switchTo(
          current: contextFor(profile),
          selection: const WorkspaceSelection(country: 'UAE'),
        ) as WorkspaceSwitchRefused;

        expect(refused.error.kind, AppErrorKind.authorization);
        expect(refused.error.message, contains('UAE'));
        expect(refused.context.activeCountry, 'KSA');
        expect(deps.calls, isNot(contains('invalidateScopedReads')));
      },
    );

    test('a site outside the reloaded scope is refused', () async {
      final WorkspaceProfile profile = profileFor(sites: const <String>['NHC']);
      final FakeDependencies deps = FakeDependencies(profile);

      final WorkspaceSwitchRefused refused =
          await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(profile),
        selection: const WorkspaceSelection(
          country: 'UAE',
          sites: <String>['DIRIYAH'],
        ),
      ) as WorkspaceSwitchRefused;

      expect(refused.error.kind, AppErrorKind.authorization);
      expect(refused.error.message, contains('DIRIYAH'));
    });

    test('a scope that GREW since the last load is honoured', () async {
      // The reload happens before validation on purpose: the scope can grow as
      // well as shrink, and validating against the context in hand would refuse
      // a country the administrator granted thirty seconds ago.
      final WorkspaceProfile narrow = profileFor(
        countries: const <String>['KSA'],
      );
      final FakeDependencies deps = FakeDependencies(
        profileFor(countries: const <String>['KSA', 'UAE']),
      );

      final WorkspaceSwitchOutcome outcome =
          await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(narrow),
        selection: const WorkspaceSelection(country: 'UAE'),
      );

      expect(outcome, isA<WorkspaceSwitchApplied>());
    });
  });

  group('currency is never invented', () {
    test('a failed lookup leaves it null and reports why', () async {
      final WorkspaceProfile profile = profileFor();
      final FakeDependencies deps = FakeDependencies(profile)
        ..currencyError = StateError('lookup down');

      final WorkspaceSwitchApplied applied =
          await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(profile),
        selection: const WorkspaceSelection(country: 'UAE'),
      ) as WorkspaceSwitchApplied;

      expect(applied.context.currency, isNull);
      expect(
        applied.context.currency,
        isNot('SAR'),
        reason: 'the previous workspace was SAR; it must not carry over',
      );
      expect(applied.warnings, hasLength(1));
      expect(applied.warnings.single.kind, AppErrorKind.server);
    });

    test('a server that has no mapping is reported, not defaulted', () async {
      final WorkspaceProfile profile = profileFor();
      final FakeDependencies deps = FakeDependencies(profile)..currency = null;

      final WorkspaceSwitchApplied applied =
          await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(profile),
        selection: const WorkspaceSelection(country: 'UAE'),
      ) as WorkspaceSwitchApplied;

      expect(applied.context.currency, isNull);
      expect(applied.context.hasCurrency, isFalse);
      expect(applied.warnings, hasLength(1));
    });
  });

  group('permissions are reloaded only when the identity moved', () {
    test(
      'a country change alone does not re-read the permission maps',
      () async {
        final WorkspaceProfile profile = profileFor();
        final FakeDependencies deps = FakeDependencies(profile);

        await WorkspaceSwitcher(deps).switchTo(
          current: contextFor(profile),
          selection: const WorkspaceSelection(country: 'UAE'),
        );

        expect(deps.calls, isNot(contains('reloadAccessState')));
      },
    );

    test(
      'a role change re-reads them, because the matrix is role scoped',
      () async {
        // get_user_module_permissions is filtered by profiles.role, so after a
        // role change the matrix in memory answers for somebody else.
        final WorkspaceProfile before = profileFor();
        final WorkspaceProfile after = profileFor(role: 'Director');
        final FakeDependencies deps = FakeDependencies(after)
          ..accessOnReload = AccessState(
            role: after.role,
            grants: const <ModuleKey, GrantEffect>{
              ModuleKey.analytics: GrantEffect.grant,
            },
          );

        final WorkspaceSwitchApplied applied =
            await WorkspaceSwitcher(deps).switchTo(
          current: contextFor(before),
          selection: const WorkspaceSelection(country: 'UAE'),
        ) as WorkspaceSwitchApplied;

        expect(deps.calls, contains('reloadAccessState'));
        expect(
          applied.completedSteps,
          contains(WorkspaceSwitchStep.accessStateReloaded),
        );
        expect(applied.context.role.id, RoleId.director);
        expect(applied.allowedModules, contains(ModuleKey.analytics));
      },
    );

    test(
      'a failed reload after a role change fails the admin surfaces CLOSED',
      () async {
        final WorkspaceProfile before = profileFor();
        final WorkspaceProfile after = profileFor(role: 'Director');
        final FakeDependencies deps = FakeDependencies(after)
          ..accessError = StateError('rpc down');

        final WorkspaceSwitchApplied applied =
            await WorkspaceSwitcher(deps).switchTo(
          current: contextFor(before),
          selection: const WorkspaceSelection(country: 'UAE'),
        ) as WorkspaceSwitchApplied;

        expect(applied.context.effectivePermissions.permissionsError, isTrue);
        expect(applied.warnings, hasLength(1));

        // A director IS on the approvals default list, so this proves the
        // fail-closed branch is what denied it.
        expect(applied.allowedModules, isNot(contains(ModuleKey.approvals)));
        expect(applied.allowedModules, isNot(contains(ModuleKey.admin)));
        // Ordinary field modules still work: a field user is never stranded.
        expect(applied.allowedModules, contains(ModuleKey.inspect));
      },
    );
  });

  group('cache failures are reported, and the switch still stands', () {
    test('a failed invalidation does not roll the workspace back', () async {
      // The context has already moved. Reverting after invalidating would
      // leave the caches pointing at a workspace nobody is in.
      final WorkspaceProfile profile = profileFor();
      final FakeDependencies deps = FakeDependencies(profile)
        ..invalidateError = StateError('disk full');

      final WorkspaceSwitchApplied applied =
          await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(profile),
        selection: const WorkspaceSelection(country: 'UAE'),
      ) as WorkspaceSwitchApplied;

      expect(applied.context.activeCountry, 'UAE');
      expect(applied.warnings, hasLength(1));
      expect(applied.warnings.single.kind, AppErrorKind.storage);
      expect(
        applied.completedSteps,
        isNot(contains(WorkspaceSwitchStep.scopedReadsInvalidated)),
      );
      // It carried on rather than stopping half way.
      expect(
        applied.completedSteps,
        contains(WorkspaceSwitchStep.navigationRecomputed),
      );
    });

    test('a failed warm-up is a warning, not a failure', () async {
      final WorkspaceProfile profile = profileFor();
      final FakeDependencies deps = FakeDependencies(profile)
        ..refreshError = StateError('no space');

      final WorkspaceSwitchApplied applied =
          await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(profile),
        selection: const WorkspaceSelection(country: 'UAE'),
      ) as WorkspaceSwitchApplied;

      expect(applied.context.activeCountry, 'UAE');
      expect(applied.warnings, hasLength(1));
      expect(
        applied.completedSteps,
        contains(WorkspaceSwitchStep.scopedCacheRefreshed),
      );
    });

    test('warnings never masquerade as an error', () async {
      final WorkspaceProfile profile = profileFor();
      final FakeDependencies deps = FakeDependencies(profile)
        ..currencyError = StateError('a')
        ..invalidateError = StateError('b')
        ..refreshError = StateError('c');

      final WorkspaceSwitchOutcome outcome =
          await WorkspaceSwitcher(deps).switchTo(
        current: contextFor(profile),
        selection: const WorkspaceSelection(country: 'UAE'),
      );

      expect(outcome, isA<WorkspaceSwitchApplied>());
      final WorkspaceSwitchApplied applied = outcome as WorkspaceSwitchApplied;
      expect(applied.warnings, hasLength(3));
      for (final AppError warning in applied.warnings) {
        expect(warning.message, isNotEmpty);
        expect(warning.technical, isNotNull);
      }
    });
  });

  group('the phone ordering can be selected for navigation too', () {
    test('a revoked admin loses the module under the phone ordering', () async {
      final WorkspaceProfile profile = profileFor(role: 'Admin');
      final FakeDependencies deps = FakeDependencies(profile);
      final WorkspaceContext current = WorkspaceContext.fromProfile(
        profile,
        effectivePermissions: AccessState(
          role: profile.role,
          grants: const <ModuleKey, GrantEffect>{
            ModuleKey.records: GrantEffect.revoke,
          },
        ),
        activeCountry: 'KSA',
      );

      final WorkspaceSwitchApplied server =
          await WorkspaceSwitcher(deps).switchTo(
        current: current,
        selection: const WorkspaceSelection(country: 'UAE'),
      ) as WorkspaceSwitchApplied;
      expect(server.allowedModules, contains(ModuleKey.records));

      final WorkspaceSwitchApplied phone = await WorkspaceSwitcher(
        deps,
        precedence: AdminRevokePrecedence.mobileRevokeBeatsAdmin,
      ).switchTo(
        current: current,
        selection: const WorkspaceSelection(country: 'UAE'),
      ) as WorkspaceSwitchApplied;
      expect(phone.allowedModules, isNot(contains(ModuleKey.records)));
    });
  });
}
