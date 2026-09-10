import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';

enum MobileAccessOverride { defaultAccess, allow, deny }

final class MobileAccessGrant {
  const MobileAccessGrant(this.id, this.module, this.effect, this.expiresAt);
  final String id;
  final ModuleKey module;
  final MobileAccessOverride effect;
  final DateTime? expiresAt;
  bool activeAt(DateTime now) => expiresAt == null || expiresAt!.isAfter(now);
}

MobileAccessOverride effectiveMobileOverride(
  List<MobileAccessGrant> grants,
  ModuleKey module,
  DateTime now,
) {
  final active = grants.where((g) => g.module == module && g.activeAt(now));
  if (active.any((g) => g.effect == MobileAccessOverride.deny)) {
    return MobileAccessOverride.deny;
  }
  if (active.isNotEmpty) return MobileAccessOverride.allow;
  return MobileAccessOverride.defaultAccess;
}

abstract interface class AdminAccessSource {
  Future<List<MobileAccessGrant>> read(String userId);
  Future<void> set(String userId, ModuleKey module, MobileAccessOverride value);
  Future<void> remove(String id);
}

final class SupabaseAdminAccessSource implements AdminAccessSource {
  SupabaseAdminAccessSource(this.client);
  final SupabaseClient client;

  @override
  Future<List<MobileAccessGrant>> read(String userId) async {
    final rows = await client
        .from('user_access_grants')
        .select('id,module_key,effect,expires_at')
        .eq('user_id', userId)
        .eq('capability', 'view')
        .like('module_key', '$mobileGrantPrefix%');
    return [
      for (final row in rows)
        if (moduleKeyFromMobileGrantKey(row['module_key'] as String)
            case final module?)
          MobileAccessGrant(
            row['id'] as String,
            module,
            row['effect'] == 'revoke'
                ? MobileAccessOverride.deny
                : MobileAccessOverride.allow,
            row['expires_at'] == null
                ? null
                : DateTime.parse(row['expires_at'] as String),
          ),
    ];
  }

  @override
  Future<void> set(
    String userId,
    ModuleKey module,
    MobileAccessOverride value,
  ) async {
    final id = await client.rpc<Object?>(
      'set_user_access_grant',
      params: {
        'p_user_id': userId,
        'p_module_key': mobileGrantKeyFor(module),
        'p_capability': 'view',
        'p_effect': value == MobileAccessOverride.deny ? 'revoke' : 'grant',
        'p_note': 'mobile',
        'p_expires_at': null,
      },
    );
    if (id is! String || id.isEmpty) {
      throw StateError('The grant was not confirmed.');
    }
  }

  @override
  Future<void> remove(String id) async {
    await client.rpc<Object?>('revoke_user_access_grant', params: {'p_id': id});
  }
}

/// Existing RPCs are not atomic together. Write the desired deny/grant first,
/// then remove its opposite: a partial failure can retain a denial, never open
/// access before an intended denial has been stored. Always reread on failure.
class AdminAccessRepository {
  AdminAccessRepository(this.source);
  final AdminAccessSource source;

  void _requireSuper(bool superAdmin) {
    if (!superAdmin) {
      throw const AppError(
        kind: AppErrorKind.authorization,
        message: 'Platform administrator access is required.',
      );
    }
  }

  Future<List<MobileAccessGrant>> read(
    String userId, {
    required bool superAdmin,
  }) {
    _requireSuper(superAdmin);
    return source.read(userId);
  }

  Future<void> change(
    String userId,
    ModuleKey module,
    MobileAccessOverride value, {
    required bool superAdmin,
  }) async {
    _requireSuper(superAdmin);
    final existing = await source.read(userId);
    if (value != MobileAccessOverride.defaultAccess) {
      await source.set(userId, module, value);
    }
    final obsolete = existing
        .where((g) => g.module == module && g.effect != value)
        .toList()
      ..sort((a, b) => a.effect == MobileAccessOverride.allow ? -1 : 1);
    for (final grant in obsolete) {
      await source.remove(grant.id);
    }
    final actual = await source.read(userId);
    if (effectiveMobileOverride(actual, module, DateTime.now()) != value) {
      throw const AppError(
        kind: AppErrorKind.conflict,
        message:
            'Access changed during this update. Review the current state and retry.',
      );
    }
  }
}
