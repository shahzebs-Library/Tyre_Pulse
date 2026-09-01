/// The active workspace: who is signed in, and which slice of the fleet they
/// are looking at.
///
/// # Spec section 8, field by field
///
/// The spec lists eight fields. Here is what each one really is, because two of
/// them are ambiguous in a way that has already broken this product once.
///
/// | Spec field | Here | Source and note |
/// |---|---|---|
/// | `tenantId` | [WorkspaceContext.tenantId] | `profiles.org_id`. This is the column `app_current_org()` reads, so it is the one the organisation RLS layer compares against. |
/// | `companyId` | [WorkspaceContext.companyId] | `profiles.organisation_id`. This is the column DATA ROWS carry. Two different columns, not one - V311 exists because a row with one set and the other NULL "would be visible under one boundary and invisible under the other". |
/// | `country` | [WorkspaceContext.activeCountry] | The ONE country currently selected, or null. Named `activeCountry` on purpose: the profile column is an ARRAY, and calling a scalar `country` is precisely the confusion that broke login in the Kotlin build. The array lives in [WorkspaceContext.countryScope]. |
/// | `currency` | [WorkspaceContext.currency] | Server-derived, nullable, NEVER defaulted. See below. |
/// | `siteIds` | [WorkspaceContext.siteIds] | The site filter to apply. Empty means no filter, not no access. The permitted set is [WorkspaceContext.siteScope]. |
/// | `userId` | [WorkspaceContext.userId] | `profiles.id`. |
/// | `role` | [WorkspaceContext.role] | A [UserRole], which may be explicitly unknown. It is never coerced. |
/// | `effectivePermissions` | [WorkspaceContext.effectivePermissions] | The [AccessState] the resolver consumes. |
///
/// # Currency is never assumed
///
/// Spec section 8: "Never hard-code Saudi Arabia, SAR, one company, one site.
/// The Kotlin project previously hard-coded Saudi Arabia and SAR for every
/// user. That must never exist in Flutter."
///
/// It also still exists in the Expo app, today: `mobile/lib/execReportPdf.ts`
/// reads `opts.currency ?? 'SAR'` and its only caller passes no currency, so
/// every exported report is labelled SAR regardless of country.
///
/// So there is no currency table in this file and no fallback anywhere in it.
/// [WorkspaceContext.currency] is a nullable code supplied by whoever resolved
/// it from the server's own `country_currency` mapping. A null currency renders
/// as `-` or `Unavailable`. It never renders as SAR, and a monetary figure with
/// no currency is not shown at all - AGENTS.md: where zero would falsely imply
/// a measurement, render `-`, not `0`.
library;

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';

/// The `profiles` row, decoded with the array columns kept as arrays.
///
/// This is a domain value, not a DTO for one query. A repository may map its
/// own row shape into it; what must not happen is a second, looser decoding of
/// `country` or `sites` somewhere else.
final class WorkspaceProfile {
  const WorkspaceProfile({
    required this.userId,
    required this.role,
    required this.countryScope,
    required this.siteScope,
    this.tenantId,
    this.companyId,
    this.isSuperAdmin = false,
    this.isApproved = false,
    this.isLocked = false,
    this.legacySite,
    this.fullName,
    this.employeeId,
  });

  /// Decodes a `profiles` row.
  ///
  /// Every nullable boolean is compared to `true` rather than treated as
  /// truthy: `profiles.is_super_admin` and `profiles.locked` are both NULLABLE,
  /// and the production phone declares them `boolean | null` and compares
  /// `=== true` for exactly this reason. A null must never elevate anybody.
  ///
  /// Throws an [AppError] of kind [AppErrorKind.validation] when the row has no
  /// id. A profile with no identity cannot scope anything, and silently
  /// continuing with an empty user id would produce queries that quietly match
  /// nothing.
  factory WorkspaceProfile.fromRow(Map<String, Object?> row) {
    final Object? rawId = row['id'];
    if (rawId is! String || rawId.isEmpty) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'Your profile could not be read. Sign in again, and contact '
            'your administrator if this keeps happening.',
        technical: 'profiles row has no usable id column',
      );
    }

    return WorkspaceProfile(
      userId: rawId,
      role: UserRole.fromDatabase(_stringOrNull(row['role'])),
      countryScope: CountryScope.fromJson(row['country']),
      siteScope: SiteScope.fromJson(row['sites']),
      tenantId: _stringOrNull(row['org_id']),
      companyId: _stringOrNull(row['organisation_id']),
      isSuperAdmin: row['is_super_admin'] == true,
      isApproved: row['approved'] == true,
      isLocked: row['locked'] == true,
      legacySite: _stringOrNull(row['site']),
      fullName: _stringOrNull(row['full_name']),
      employeeId: _stringOrNull(row['employee_id']),
    );
  }

  final String userId;
  final UserRole role;

  /// `profiles.country`, the ARRAY.
  final CountryScope countryScope;

  /// `profiles.sites`, the ARRAY.
  final SiteScope siteScope;

  /// `profiles.org_id`, which `app_current_org()` reads.
  final String? tenantId;

  /// `profiles.organisation_id`, which data rows are matched against.
  final String? companyId;

  final bool isSuperAdmin;
  final bool isApproved;
  final bool isLocked;

  /// `profiles.site`, the LEGACY scalar. Used to pre-fill a form and label a
  /// header. It is NOT the access scope; [siteScope] is.
  final String? legacySite;

  final String? fullName;

  /// Human-facing employee number from `profiles.employee_id`.
  /// This is presentation metadata only; authorization continues to use
  /// [userId] and the resolved permission state.
  final String? employeeId;

  /// True when both organisation columns are populated and DISAGREE.
  ///
  /// V311's trigger is meant to make this impossible, and PROJECT_MEMORY
  /// records it as applied while the migration file's own STATUS header says
  /// NOT YET APPLIED. A status header is a claim, not evidence. Surfacing the
  /// disagreement means a support engineer sees it instead of chasing "some
  /// rows are invisible".
  bool get organisationIdsDiffer =>
      tenantId != null && companyId != null && tenantId != companyId;

  /// True when either organisation column is missing. The row will be visible
  /// under one boundary and invisible under the other.
  bool get organisationIdIncomplete => tenantId == null || companyId == null;

  /// The account may sign in but must not be given the app.
  ///
  /// The shell renders this as its own full-screen state, in order, after the
  /// update gate and the profile-error gate. It is a STATE, not a route: on a
  /// route, a deep link skips it.
  bool get isBlockedFromApp => !isApproved || isLocked;

  static String? _stringOrNull(Object? raw) {
    if (raw is! String) {
      return null;
    }
    final String trimmed = raw.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}

/// The immutable active workspace.
///
/// Rebuilt, never mutated. A workspace change produces a NEW context so a
/// provider comparing old to new sees a real change and every scoped read is
/// invalidated together.
final class WorkspaceContext {
  const WorkspaceContext({
    required this.userId,
    required this.role,
    required this.effectivePermissions,
    required this.countryScope,
    required this.siteScope,
    this.tenantId,
    this.companyId,
    this.activeCountry,
    this.activeSites = const <String>[],
    this.currency,
    this.legacySite,
    this.fullName,
    this.employeeId,
  });

  /// Builds the context for a freshly loaded profile.
  ///
  /// [activeCountry] and [currency] are supplied by the caller because neither
  /// can be derived on the device: the country selection is a user choice
  /// within the profile's scope, and the currency comes from the server's own
  /// `country_currency` mapping. Passing neither yields a context with no
  /// country filter and no currency, which renders honestly rather than
  /// pretending.
  factory WorkspaceContext.fromProfile(
    WorkspaceProfile profile, {
    required AccessState effectivePermissions,
    String? activeCountry,
    List<String>? activeSites,
    String? currency,
  }) =>
      WorkspaceContext(
        userId: profile.userId,
        role: profile.role,
        effectivePermissions: effectivePermissions,
        countryScope: profile.countryScope,
        siteScope: profile.siteScope,
        tenantId: profile.tenantId,
        companyId: profile.companyId,
        activeCountry: activeCountry,
        activeSites: List<String>.unmodifiable(activeSites ?? const <String>[]),
        currency: currency,
        legacySite: profile.legacySite,
        fullName: profile.fullName,
        employeeId: profile.employeeId,
      );

  final String userId;
  final UserRole role;
  final AccessState effectivePermissions;

  /// Every country the profile permits. The ARRAY, not a scalar.
  final CountryScope countryScope;

  /// Every site the profile permits. The ARRAY, not the legacy scalar.
  final SiteScope siteScope;

  /// `profiles.org_id`. See the library comment.
  final String? tenantId;

  /// `profiles.organisation_id`. See the library comment.
  final String? companyId;

  /// The single country currently selected, or null.
  ///
  /// Null means NO client-side country filter, which is the correct behaviour
  /// for a user scoped to several countries or to all of them: the RESTRICTIVE
  /// country policy already returns exactly the countries they may see.
  final String? activeCountry;

  /// The explicit site filter. Empty means no filter, NOT no access.
  final List<String> activeSites;

  /// The ISO currency code for [activeCountry], resolved from the server.
  ///
  /// Null means it has not been resolved. Render `-` or `Unavailable`. Never
  /// substitute a default; see the library comment.
  final String? currency;

  /// `profiles.site`, the legacy scalar, carried for form pre-fill only.
  final String? legacySite;

  /// The signed-in person's display name from the verified profile row.
  /// Presentation surfaces use it for personalisation only; it is never an
  /// identity key or an authorization input.
  final String? fullName;

  /// Verified human-facing staff number from `profiles.employee_id`.
  final String? employeeId;

  /// Spec section 8's `siteIds`.
  List<String> get siteIds => activeSites;

  /// Whether a query should carry a site filter at all.
  bool get filtersBySite => activeSites.isNotEmpty;

  /// Whether a query should carry a country filter at all.
  ///
  /// When true, the filter must still be written NULL-SAFE - a row whose
  /// `country` is NULL is visible to everyone by design, and a strict equality
  /// filter hides it. RECORDED: a strict `.eq` on `work_orders` hid 55,606
  /// country-less job cards from every country view.
  bool get filtersByCountry => activeCountry != null;

  bool get hasCurrency => currency != null && currency!.isNotEmpty;

  bool get isSuperAdmin => effectivePermissions.isSuperAdmin;

  /// Every module this workspace reaches, recomputed from the resolver.
  ///
  /// Navigation is derived from this and never from a role literal. The
  /// production app had the tab bar and the screens gating on different lists,
  /// and an inspector who saw a tile was thrown back to Home when they tapped
  /// it.
  Set<ModuleKey> allowedModules({
    AdminRevokePrecedence precedence = AdminRevokePrecedence.serverAppUserCan,
  }) =>
      allowedModulesFor(effectivePermissions, precedence: precedence);

  WorkspaceContext copyWith({
    UserRole? role,
    AccessState? effectivePermissions,
    CountryScope? countryScope,
    SiteScope? siteScope,
    String? tenantId,
    String? companyId,
    String? activeCountry,
    bool clearActiveCountry = false,
    List<String>? activeSites,
    String? currency,
    bool clearCurrency = false,
    String? legacySite,
    String? fullName,
    String? employeeId,
  }) =>
      WorkspaceContext(
        userId: userId,
        role: role ?? this.role,
        effectivePermissions: effectivePermissions ?? this.effectivePermissions,
        countryScope: countryScope ?? this.countryScope,
        siteScope: siteScope ?? this.siteScope,
        tenantId: tenantId ?? this.tenantId,
        companyId: companyId ?? this.companyId,
        activeCountry:
            clearActiveCountry ? null : (activeCountry ?? this.activeCountry),
        activeSites: activeSites == null
            ? this.activeSites
            : List<String>.unmodifiable(activeSites),
        currency: clearCurrency ? null : (currency ?? this.currency),
        legacySite: legacySite ?? this.legacySite,
        fullName: fullName ?? this.fullName,
        employeeId: employeeId ?? this.employeeId,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is WorkspaceContext &&
          other.userId == userId &&
          other.role == role &&
          other.effectivePermissions == effectivePermissions &&
          other.countryScope == countryScope &&
          other.siteScope == siteScope &&
          other.tenantId == tenantId &&
          other.companyId == companyId &&
          other.activeCountry == activeCountry &&
          other.currency == currency &&
          other.legacySite == legacySite &&
          other.fullName == fullName &&
          other.employeeId == employeeId &&
          _sameStrings(other.activeSites, activeSites);

  @override
  int get hashCode => Object.hash(
        userId,
        role,
        effectivePermissions,
        countryScope,
        siteScope,
        tenantId,
        companyId,
        activeCountry,
        currency,
        legacySite,
        fullName,
        employeeId,
        Object.hashAll(activeSites),
      );

  @override
  String toString() {
    final String currencyText = currency ?? 'unresolved';
    return 'WorkspaceContext(user: $userId, role: $role, '
        'tenant: $tenantId, company: $companyId, country: $activeCountry, '
        'currency: $currencyText, sites: $activeSites)';
  }
}

bool _sameStrings(List<String> a, List<String> b) {
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
