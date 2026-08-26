/// The active workspace context. Artifact 05 section 2.1.
///
/// Every other table in this schema references a workspace and there is
/// nowhere else for the context to live, so it is a table rather than a
/// preferences file: it must be readable in the same transaction as the rows it
/// scopes.
library;

import 'package:drift/drift.dart';

/// One row per workspace the signed-in user has, with exactly one marked
/// active.
///
/// Currency and country are nullable and carry NO default. A fabricated
/// default is precisely the defect spec section 8 names: the previous rebuild
/// hard-coded one company and Saudi Arabia. Null renders as "not set", never as
/// SAR.
@DataClassName('WorkspaceScopeRow')
@TableIndex(name: 'idx_workspace_active', columns: {#isActive})
class WorkspaceScopes extends Table {
  /// `organisation_id`. The tenant boundary every cached row is filtered by.
  TextColumn get workspaceId => text()();

  /// Spec section 8. UNVERIFIED whether the server exposes a tenant above
  /// organisation, so this is nullable and nothing depends on it yet.
  TextColumn get tenantId => text().nullable()();

  TextColumn get companyName => text().nullable()();

  /// The active country. Null means every country this user may see, which is
  /// a real state and not a missing value.
  TextColumn get country => text().nullable()();

  TextColumn get currency => text().nullable()();

  /// JSON array. The `profiles.sites` scope array; the sentinel `ALL` means
  /// org-wide. Stored as received - an empty array and the sentinel mean
  /// opposite things and a mapper that coalesces one to the other is how a
  /// user loses every site or gains all of them.
  TextColumn get siteIdsJson => text()();

  TextColumn get userId => text()();

  /// `profiles.role`, in the Title Case the server stores. Not normalised: the
  /// server compares this value literally.
  TextColumn get role => text()();

  BoolColumn get isSuperAdmin => boolean().withDefault(const Constant(false))();

  /// Exactly one row is true. The app asks "which workspace am I in" on every
  /// navigation build, which is why this column is indexed.
  BoolColumn get isActive => boolean().withDefault(const Constant(false))();

  /// When the server last confirmed this context.
  DateTimeColumn get lastVerifiedAt => dateTime()();

  @override
  String get tableName => 'workspace_scope';

  @override
  Set<Column<Object>> get primaryKey => {workspaceId};
}
