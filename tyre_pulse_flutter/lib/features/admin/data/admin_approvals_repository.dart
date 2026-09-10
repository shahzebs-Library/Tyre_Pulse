import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

enum AdminApprovalKind { upload, closure }

class AdminApprovalItem {
  const AdminApprovalItem({
    required this.id,
    required this.title,
    required this.detail,
    required this.kind,
    this.uploadType,
    this.rowCount,
  });
  final String id;
  final String title;
  final String detail;
  final AdminApprovalKind kind;
  final String? uploadType;
  final int? rowCount;
  bool get canApproveUpload =>
      kind == AdminApprovalKind.upload &&
      const {'tyres', 'stock'}.contains(uploadType);
}

abstract interface class AdminApprovalsSource {
  Future<List<Map<String, dynamic>>> page(
    WorkspaceContext workspace,
    AdminApprovalKind kind,
    int offset,
  );
  Future<List<dynamic>> uploadRows(String id);
  Future<Object?> decide(String id, bool approve, String? reason);
}

/// V320 owns atomic imports, the type allow-list, tenant checks and audit.
/// Live columns and RPC signatures verified on 2026-09-07.
class SupabaseAdminApprovalsSource implements AdminApprovalsSource {
  SupabaseAdminApprovalsSource(this.client);
  final SupabaseClient client;
  @override
  Future<List<Map<String, dynamic>>> page(
    WorkspaceContext workspace,
    AdminApprovalKind kind,
    int offset,
  ) {
    final upload = kind == AdminApprovalKind.upload;
    var query = client
        .from(upload ? 'pending_uploads' : 'accidents')
        .select(
          upload
              ? 'id,file_name,uploader_name,upload_type,row_count,country'
              : 'id,asset_no,site,close_request_note,country',
        )
        .eq(
          upload ? 'status' : 'closure_status',
          upload ? 'pending' : 'pending_closure',
        );
    if (!workspace.effectivePermissions.isSuperAdmin) {
      query = query.eq('organisation_id', workspace.tenantId!);
    }
    if (workspace.activeCountry != null) {
      query = query.eq('country', workspace.activeCountry!);
    }
    return query.order('id').range(offset, offset + 24);
  }

  @override
  Future<List<dynamic>> uploadRows(String id) async {
    final row = await client
        .from('pending_uploads')
        .select('rows')
        .eq('id', id)
        .single();
    final rows = row['rows'];
    if (rows is! List) throw const FormatException('Invalid upload rows');
    return List<dynamic>.from(rows);
  }

  @override
  Future<Object?> decide(String id, bool approve, String? reason) => client.rpc(
        approve ? 'approve_pending_upload' : 'reject_pending_upload',
        params: {'p_upload_id': id, if (!approve) 'p_reason': reason},
      );
}

final adminApprovalsRepositoryProvider = Provider<AdminApprovalsRepository>(
  (ref) => AdminApprovalsRepository(
    SupabaseAdminApprovalsSource(ref.watch(supabaseClientProvider)),
  ),
);

class AdminApprovalsRepository with SupabaseGateway {
  AdminApprovalsRepository(this.source);
  final AdminApprovalsSource source;
  void _requireAdmin(WorkspaceContext workspace) {
    if (!workspace.effectivePermissions.isSuperAdmin &&
        (!workspace.role.isAdministrator || workspace.tenantId == null)) {
      throw const AppError(
        kind: AppErrorKind.authorization,
        message: 'Administrator access is required.',
      );
    }
  }

  Future<List<AdminApprovalItem>> page(
    WorkspaceContext workspace,
    AdminApprovalKind kind,
    int offset,
  ) {
    _requireAdmin(workspace);
    return guard(
      () async => (await source.page(workspace, kind, offset))
          .map(
            (row) => AdminApprovalItem(
              id: row['id'] as String,
              title: (kind == AdminApprovalKind.upload
                      ? row['file_name']
                      : row['asset_no']) as String? ??
                  row['id'] as String,
              detail: <Object?>[
                row['country'],
                row['site'],
                row['uploader_name'],
                row['close_request_note'],
              ].whereType<String>().join(' · '),
              kind: kind,
              uploadType: row['upload_type'] as String?,
              rowCount: row['row_count'] as int?,
            ),
          )
          .toList(),
    );
  }

  Future<List<dynamic>> uploadRows(WorkspaceContext workspace, String id) {
    _requireAdmin(workspace);
    return guard(() => source.uploadRows(id));
  }

  Future<void> decide(
    WorkspaceContext workspace,
    AdminApprovalItem item,
    bool approve,
    String reason,
  ) {
    _requireAdmin(workspace);
    if (item.kind != AdminApprovalKind.upload ||
        (approve && !item.canApproveUpload) ||
        (!approve && reason.trim().isEmpty)) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'Review a supported upload and provide a rejection reason.',
      );
    }
    return guard(() async {
      final result = await source.decide(item.id, approve, reason.trim());
      if (result is! Map || result['ok'] != true) {
        throw const AppError(
          kind: AppErrorKind.conflict,
          message:
              'The server did not confirm the decision. Refresh before retrying.',
        );
      }
    });
  }
}
