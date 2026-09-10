import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/sync/supabase_command_pusher.dart';
import 'package:tyre_pulse/features/approvals/data/approval_review_context.dart';

final executionApprovalRepositoryProvider = Provider((ref) => ExecutionApprovalRepository(ref.watch(supabaseClientProvider)));

class ExecutionApprovalRepository with SupabaseGateway {
  ExecutionApprovalRepository(this.client);
  final SupabaseClient client;

  Future<Map<String, dynamic>> workOrder(String id) => guard(() async => client.rpc<Map<String, dynamic>>('work_order_approval_context', params: {'p_work_order_id': id}));
  Future<Map<String, dynamic>> requestWorkOrder(String id, String operation, String reason) => guard(() async => client.rpc<Map<String, dynamic>>('request_work_order_approval', params: {'p_work_order_id': id, 'p_operation_id': operation, 'p_reason': reason}));
  Future<Map<String, dynamic>> tyreContext(String vehicleId) => guard(() async => client.rpc<Map<String, dynamic>>('tyre_change_approval_context', params: {'p_vehicle_id': vehicleId}));
  Future<Map<String, dynamic>> requestTyre(String vehicleId, Map<String, dynamic> change, String operation, String reason) => guard(() async => client.rpc<Map<String, dynamic>>('request_tyre_change_approval', params: {'p_vehicle_id': vehicleId, 'p_change': change, 'p_operation_id': operation, 'p_reason': reason}));

  Future<Map<String, dynamic>> review(String type, String id) => guard(() async => client.rpc<Map<String, dynamic>>('approval_review_context', params: {'p_entity_type': type, 'p_entity_id': id}));
  Future<void> decide({required String type, required String id, required ApprovalReviewContext context, required String operation, required String decision, required DateTime capturedAt, String? signature, String? reason}) => guard(() async {
    final receipt = await client.rpc<Object?>('decide_approval', params: {'p_entity_type': type, 'p_entity_id': id, 'p_expected_revision': context.revision, 'p_expected_stage': context.stageToken, 'p_operation_id': operation, 'p_decision': decision, 'p_signature': signature, 'p_note': reason, 'p_client_captured_at': capturedAt.toUtc().toIso8601String()});
    validateApprovalReceipt(receipt, operation);
  });
  Future<void> executeTyre(String id, String operation) => guard(() async {
    final receipt = await client.rpc<Map<String, dynamic>>('execute_approved_tyre_change', params: {'p_request_id': id, 'p_operation_id': operation});
    if (receipt['ok'] != true || receipt['status'] != 'executed' || receipt['operation_id'] != operation || receipt['request_id'] != id) {
      throw const FormatException('Execution was not confirmed. Refresh before retrying.');
    }
  });

  Future<List<Map<String, dynamic>>> activeTyres(String asset) => guard(() async => client.from('tyre_records').select('id,position,tyre_position,serial_no,brand').eq('asset_no', asset).eq('status', 'Active').limit(100));

  Future<String> uploadPhoto(String localPath, String name) async {
    try {
      return (await SupabaseMediaUploader(client).upload(bucket: 'tyre-photos', localPath: localPath, fileName: name)).remoteRef;
    } on Object catch (error) {
      final failure = classifySupabaseError(error);
      if (failure.code != '409' && failure.code != 'Duplicate') rethrow;
      final remote = await client.storage.from('tyre-photos').download(name);
      if (!listEquals(remote, await File(localPath).readAsBytes())) rethrow;
      return 'tp-storage://tyre-photos/$name';
    }
  }
}

/// Durable capture, including evidence paths and operation IDs. Never sweeps
/// photos; an offline draft is not an accepted approval or an executed change.
class ExecutionApprovalDraftStore {
  ExecutionApprovalDraftStore(this.workspace);
  final String workspace;

  Future<File> _file(String key) async {
    final documents = await getApplicationDocumentsDirectory();
    final safeScope = base64Url.encode(utf8.encode(workspace)).replaceAll('=', '');
    final folder = Directory('${documents.path}${Platform.pathSeparator}execution_approval_drafts${Platform.pathSeparator}$safeScope');
    await folder.create(recursive: true);
    return File('${folder.path}${Platform.pathSeparator}${key.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_')}.json');
  }

  Future<Map<String, dynamic>?> read(String key) async {
    final file = await _file(key);
    if (!await file.exists()) return null;
    return Map<String, dynamic>.from(jsonDecode(await file.readAsString()) as Map);
  }

  Future<void> save(String key, Map<String, dynamic> draft) async {
    final file = await _file(key);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(draft), flush: true);
    await temporary.rename(file.path);
  }

  Future<List<Map<String, dynamic>>> list() async {
    final directory = (await _file('index')).parent;
    final drafts = <Map<String, dynamic>>[];
    await for (final entry in directory.list()) {
      if (entry is File && entry.path.endsWith('.json')) {
        drafts.add(Map<String, dynamic>.from(jsonDecode(await entry.readAsString()) as Map));
      }
    }
    return drafts;
  }
}
