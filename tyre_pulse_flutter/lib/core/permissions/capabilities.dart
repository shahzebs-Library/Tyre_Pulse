/// Capabilities, and the honest record of which of them the SERVER enforces.
///
/// # Module access is not authorisation to fetch
///
/// This is the most important sentence in the permission layer, so it is
/// written here rather than left to be inferred.
///
/// Turning a module off for a role writes `module_permissions.enabled = false`.
/// That hides a tile and blocks a route. It does **not** stop a PostgREST read
/// of the underlying table. Grepped across every `MIGRATIONS_V*.sql` in this
/// repository: there is not one RLS policy anywhere that gates on
/// `app_user_can(key, 'view')`. Every capability call inside a policy uses
/// `create`, `edit` or `delete`.
///
/// The row boundary is organisation + country + site RLS, and that boundary
/// does not know what a module is. So:
///
/// - If a module is denied, DO NOT CALL. The refusal is the client's job.
/// - If a call is made anyway, RLS decides - and RLS may well return rows.
/// - Never write `if (canAccess(module)) { ...treat the rows as authorised... }`
///   and never present a module gate as a security control in a review.
///
/// [CapabilityEnforcement] exists so that a call site cannot mistake one for
/// the other by accident: ask [Capability.enforcement], and a `view` decision
/// answers [CapabilityEnforcement.uiOnly] out loud.
///
/// # What the migrations actually do
///
/// `src/lib/permissionMatrix.js` declares six capabilities, each with an
/// `enforced` flag. That flag is the file's own claim, and for `view` it is
/// wrong. This enum records the measured truth instead, per artifact 04
/// section 4.
library;

/// How far a capability is actually enforced.
enum CapabilityEnforcement {
  /// The client gates it. No server object checks it. A determined or buggy
  /// caller reaches the data anyway.
  uiOnly,

  /// A PERMISSIVE policy grants it on specific tables. PERMISSIVE is the
  /// load-bearing word: such a policy can only ADD access. It cannot take a
  /// capability away from a role that already holds it through its ordinary
  /// role policy, because that would need a RESTRICTIVE policy and none
  /// exists. So a REVOKE of this capability is a UI gesture on those roles.
  serverAdditiveOnly,

  /// Enforced only as a refusal, never as a grant. `app_cap_revoked` plus a
  /// BEFORE UPDATE trigger refuses the change when the caller is explicitly
  /// revoked; nobody is revoked by default and administrators are exempt.
  serverNegativeOnly,
}

/// Whether the server checks this capability at all.
extension CapabilityEnforcementX on CapabilityEnforcement {
  bool get isServerEnforced => this != CapabilityEnforcement.uiOnly;
}

/// The six capabilities in `src/lib/permissionMatrix.js`.
enum Capability {
  /// Reach a screen. **Not a data boundary.** See the library comment.
  view(
    wireName: 'view',
    enforcement: CapabilityEnforcement.uiOnly,
    serverNote:
        'No RLS policy gates on view. It hides tiles and blocks '
        'routes; it does not stop a PostgREST read.',
  ),

  /// Insert. Granted additively on eleven tables by V238 (pilot) and V241
  /// (extension) via `WITH CHECK (app_user_can('<module>','create'))`.
  create(
    wireName: 'create',
    enforcement: CapabilityEnforcement.serverAdditiveOnly,
    serverNote:
        'PERMISSIVE INSERT policies on 11 tables (V238, V241). Adds '
        'access; never removes it.',
  ),

  /// Update. Same eleven tables, plus hand-written checks in V382, V608, V609.
  edit(
    wireName: 'edit',
    enforcement: CapabilityEnforcement.serverAdditiveOnly,
    serverNote:
        'PERMISSIVE UPDATE policies on the same 11 tables, plus '
        'hand-written checks in V382, V608 and V609.',
  ),

  /// Delete. Same eleven tables.
  delete(
    wireName: 'delete',
    enforcement: CapabilityEnforcement.serverAdditiveOnly,
    serverNote: 'PERMISSIVE DELETE policies on the same 11 tables.',
  ),

  /// Download. Checked nowhere on the server. A client-side file build.
  export(
    wireName: 'export',
    enforcement: CapabilityEnforcement.uiOnly,
    serverNote:
        'No server enforcement anywhere. The export is assembled on '
        'the device from rows RLS already returned.',
  ),

  /// Sign off. The generic capability system only ever REFUSES here (V242).
  /// The approvals that matter are gated by their own SECURITY DEFINER
  /// functions with their own hard-coded role lists -
  /// `decide_inspection_approval`, `checklist_is_supervisor`,
  /// `checklist_is_area_manager` - and by the `guard_checklist_approval_stages`
  /// trigger, which a direct PostgREST call cannot skip either.
  approve(
    wireName: 'approve',
    enforcement: CapabilityEnforcement.serverNegativeOnly,
    serverNote:
        'V242 refuses a status change when the caller is explicitly '
        'revoked approve, on accidents and work_orders only. The real gates '
        'are the domain RPCs, which have their own role lists.',
  );

  const Capability({
    required this.wireName,
    required this.enforcement,
    required this.serverNote,
  });

  /// The value stored in `user_access_grants.capability`. Defaults to `view`
  /// in the database (V225).
  final String wireName;

  final CapabilityEnforcement enforcement;

  /// One sentence of evidence, for a code reviewer and for a diagnostic
  /// screen. Never rendered to a field user.
  final String serverNote;

  /// Convenience mirror of [CapabilityEnforcement.isServerEnforced].
  bool get isServerEnforced => enforcement.isServerEnforced;
}

/// Parses `user_access_grants.capability`. Returns null for an unknown value
/// rather than defaulting to [Capability.view]: a row this app cannot
/// understand must be dropped, not reinterpreted as the most common case.
Capability? capabilityFromWire(String? raw) {
  if (raw == null) {
    return null;
  }
  final String normalised = raw.trim().toLowerCase();
  for (final Capability capability in Capability.values) {
    if (capability.wireName == normalised) {
      return capability;
    }
  }
  return null;
}

/// The mobile grant namespace never reaches `app_user_can`.
///
/// Server capability enforcement matches BARE WEB module keys
/// (`tyre_records`, `fleet_master`) with no prefix. A mobile grant is written
/// as `mobile:records`. They are two key spaces that never meet, so a mobile
/// grant of `create` changes no policy outcome at all. Recorded here because
/// the two look interchangeable and are not (artifact 04 section 4.2).
const String serverCapabilityKeyspaceNote =
    'app_user_can matches bare web module keys. A mobile: prefixed grant is '
    'invisible to every RLS policy.';
