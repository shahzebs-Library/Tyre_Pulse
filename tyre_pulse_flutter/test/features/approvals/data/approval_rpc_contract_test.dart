import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/features/approvals/data/approval_review_context.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/data/queued_checklist_approval_decision.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';

void main() {
  late HttpServer server;
  late SupabaseClient client;
  late List<Map<String, dynamic>> requests;
  late Object response;
  const operation = 'ac64f75a-cf76-49a6-9830-b3a44fbe2103';

  setUp(() async {
    requests = [];
    response = {
      'ok': true,
      'operation_id': operation,
      'status': 'pending',
      'accepted_at': '2026-09-10T14:00:00Z'
    };
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      final body = await utf8.decoder.bind(request).join();
      requests.add({
        'path': request.uri.path,
        'method': request.method,
        'body': body.isEmpty ? null : jsonDecode(body)
      });
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode(response));
      await request.response.close();
    });
    client = SupabaseClient('http://127.0.0.1:${server.port}', 'test-key');
  });
  tearDown(() async {
    await client.dispose();
    await server.close(force: true);
  });

  QueuedChecklistApprovalDecision intent() => QueuedChecklistApprovalDecision(
        id: operation,
        submissionId: 'record',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: 'approved',
        approved: true,
        decidedAt: DateTime.parse('2026-09-10T13:00:00Z'),
        expectedRevision: 1234,
        expectedStageToken: 'policy:stage:0',
        approverId: 'untrusted-client-actor',
        approverName: 'Typed name',
        approverSignature: 'data:image/png;base64,mark',
      );

  test(
      'checklist sends frozen intent to canonical RPC without actor/status columns',
      () async {
    final result = await SupabaseChecklistApprovalRepository(client)
        .applyDecision(intent());
    expect(result, ChecklistApprovalApplyResult.applied);
    expect(requests.single['path'], '/rest/v1/rpc/decide_approval');
    final body = requests.single['body'] as Map<String, dynamic>;
    expect(body['p_expected_revision'], 1234);
    expect(body['p_expected_stage'], 'policy:stage:0');
    expect(body['p_operation_id'], operation);
    expect(body['p_client_captured_at'], '2026-09-10T13:00:00.000Z');
    expect(body.containsKey('approved_by'), isFalse);
    expect(body.containsKey('approval_status'), isFalse);
    expect(body.containsKey('p_approver_id'), isFalse);
  });

  test('HTTP success without matching receipt is not acceptance', () async {
    response = {
      'ok': true,
      'operation_id': 'different',
      'status': 'approved',
      'accepted_at': '2026-09-10T14:00:00Z'
    };
    await expectLater(
        SupabaseChecklistApprovalRepository(client).applyDecision(intent()),
        throwsA(anything));
  });

  test(
      'review uses atomic server document and template, not another table read',
      () async {
    response = {
      'revision': 1234,
      'stage_token': 'stage',
      'can_decide': true,
      'status': 'pending',
      'mode': 'enforced',
      'document': {
        'id': 'record',
        'approval_status': 'pending',
        'answers': {'q': 'captured'},
        'checklist_templates': {
          'id': 'template',
          'require_area_manager': true,
          'fields': []
        }
      }
    };
    final item =
        await SupabaseChecklistApprovalRepository(client).byId('record');
    expect(item!.reviewContext!.revision, 1234);
    expect(item.answers['q'], 'captured');
    expect(item.reviewTemplate!['require_area_manager'], isTrue);
    expect(requests, hasLength(1));
    expect(requests.single['path'], '/rest/v1/rpc/approval_review_context');
  });

  test(
      'inspection return uses shared RPC and does not echo a direct notes write',
      () async {
    await SupabaseInspectionApprovalRepository(client)
        .decide(const InspectionApprovalDecision(
      inspectionId: 'record',
      approved: false,
      reviewNote: 'Repair needed',
      operationId: operation,
      reviewContext: ApprovalReviewContext(
          revision: 5,
          stageToken: 'stage',
          canDecide: true,
          mode: 'enforced',
          status: 'pending_approval'),
    ));
    expect(requests, hasLength(1));
    expect(requests.single['path'], '/rest/v1/rpc/decide_approval');
    expect((requests.single['body'] as Map<String, dynamic>)['p_decision'],
        'returned');
  });

  test(
      'unversioned queue JSON retains evidence, copy preserves immutable guards',
      () {
    final item = intent();
    final restored = QueuedChecklistApprovalDecision.fromJson(item.toJson())
        .copyWith(attempts: 2);
    expect(restored.expectedRevision, 1234);
    expect(restored.expectedStageToken, 'policy:stage:0');
    expect(restored.id, operation);
    final old = item.toJson()
      ..remove('expectedRevision')
      ..remove('expectedStageToken');
    final legacy = QueuedChecklistApprovalDecision.fromJson(old);
    expect(legacy.expectedRevision, isNull);
    expect(legacy.approverSignature, item.approverSignature);
  });
}
