import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

final class AdminSite {
  factory AdminSite.fromRow(Map<String, dynamic> row) => AdminSite(
        id: row['id'] as String,
        name: row['name'] as String,
        country: row['country'] as String,
        organisationId: row['organisation_id'] as String,
        region: row['region'] as String?,
        city: row['city'] as String?,
        active: row['active'] == true,
      );
  const AdminSite({
    required this.id,
    required this.name,
    required this.country,
    required this.organisationId,
    this.region,
    this.city,
    this.active = true,
  });
  final String id, name, country, organisationId;
  final String? region, city;
  final bool active;
}

abstract interface class AdminSitesSource {
  Future<List<AdminSite>> page(String org, String? country, int offset);
  Future<AdminSite> save(String org, String? id, Map<String, Object?> values);
}

/// sites schema, org/country RLS, constraints and defaults verified live;
/// base table is MIGRATIONS_V109_SITES_MASTER.sql. Writes stay online-only.
final class SupabaseAdminSitesSource implements AdminSitesSource {
  SupabaseAdminSitesSource(this.client);
  final SupabaseClient client;
  static const columns = 'id,name,country,region,city,active,organisation_id';

  @override
  Future<List<AdminSite>> page(String org, String? country, int offset) async {
    var query = client.from('sites').select(columns).eq('organisation_id', org);
    if (country != null) query = query.eq('country', country);
    final rows =
        await query.order('name').order('id').range(offset, offset + 49);
    return rows.map(AdminSite.fromRow).toList();
  }

  @override
  Future<AdminSite> save(
    String org,
    String? id,
    Map<String, Object?> values,
  ) async {
    final row = id == null
        ? await client
            .from('sites')
            .upsert({...values, 'organisation_id': org}, onConflict: 'id')
            .select(columns)
            .single()
        : await client
            .from('sites')
            .update(values)
            .eq('id', id)
            .eq('organisation_id', org)
            .select(columns)
            .single();
    return AdminSite.fromRow(row);
  }
}

class AdminSitesRepository {
  AdminSitesRepository(this.source);
  final AdminSitesSource source;

  String _org(WorkspaceContext workspace) {
    final access = workspace.effectivePermissions;
    if (!canAccessModule(module: ModuleKey.admin, access: access) ||
        (!access.isSuperAdmin && !workspace.role.isAdministrator)) {
      throw const AppError(
        kind: AppErrorKind.authorization,
        message: 'Administrator access is required.',
      );
    }
    final org = workspace.companyId;
    if (org == null || org.isEmpty) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'Select an organisation before managing sites.',
      );
    }
    return org;
  }

  Future<List<AdminSite>> page(WorkspaceContext workspace, int offset) =>
      source.page(_org(workspace), workspace.activeCountry, offset);

  Future<AdminSite> save(
    WorkspaceContext workspace, {
    AdminSite? existing,
    String? createId,
    required String name,
    required String country,
    String? region,
    String? city,
    required bool active,
  }) {
    final org = _org(workspace);
    final cleanCountry = country.trim();
    if (name.trim().isEmpty || cleanCountry.isEmpty) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'Site name and country are required.',
      );
    }
    if ((existing != null && existing.organisationId != org) ||
        !workspace.countryScope.canSee(
          cleanCountry,
          isSuperAdmin: workspace.effectivePermissions.isSuperAdmin,
        )) {
      throw const AppError(
        kind: AppErrorKind.authorization,
        message: 'This site is outside your workspace.',
      );
    }
    if (existing == null && (createId == null || createId.isEmpty)) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'A stable identity is required before creating a site.',
      );
    }
    return source.save(org, existing?.id, {
      if (existing == null) 'id': createId,
      'name': name.trim(),
      'country': cleanCountry,
      'region': _optional(region),
      'city': _optional(city),
      'active': active,
      if (existing == null) 'created_by': workspace.userId,
    });
  }
}

String? _optional(String? value) =>
    value == null || value.trim().isEmpty ? null : value.trim();
