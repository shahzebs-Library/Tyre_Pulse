import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/approvals/data/approval_review_context.dart';
import 'package:tyre_pulse/features/approvals/data/execution_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/approval_route_actions.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/approval_route_card.dart';
import 'package:tyre_pulse/features/approvals/presentation/widgets/inspection_approval_signature_pad.dart';
import 'package:uuid/uuid.dart';

String executionApprovalCopy(BuildContext context, String en, String ar, String ur) => switch (Localizations.localeOf(context).languageCode) { 'ar' => ar, 'ur' => ur, _ => en };

class ExecutionApprovalReviewScreen extends ConsumerStatefulWidget {
  const ExecutionApprovalReviewScreen({required this.type, required this.requestId, super.key});
  final String type, requestId;
  @override
  ConsumerState<ExecutionApprovalReviewScreen> createState() => _ExecutionApprovalReviewScreenState();
}
class _ExecutionApprovalReviewScreenState extends ConsumerState<ExecutionApprovalReviewScreen> {
  Map<String, dynamic>? _raw;
  String? _error, _signature;
  bool _busy = false;
  final _reason = TextEditingController();
  String? _operation, _decision;
  DateTime? _capturedAt;

  @override
  void initState() { super.initState(); Future.microtask(_load); }
  @override
  void dispose() { _reason.dispose(); super.dispose(); }
  Future<void> _load() async {
    setState(() { _busy = true; _error = null; });
    try {
      final value = await ref.read(executionApprovalRepositoryProvider).review(widget.type, widget.requestId);
      if (mounted) setState(() { _raw = value; _signature = null; _operation = null; _decision = null; _capturedAt = null; });
    } on Object catch (error) { if (mounted) setState(() => _error = classifySupabaseError(error).error.message); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  Future<void> _decide(String decision) async {
    if (_busy || _raw == null) return;
    final review = ApprovalReviewContext.fromJson(_raw!);
    if ((decision == 'approved' && _signature == null) || (decision != 'approved' && _reason.text.trim().isEmpty)) {
      setState(() => _error = executionApprovalCopy(context, 'A signature is required to approve; a reason is required to return or reject.', 'يلزم توقيع للموافقة وسبب للإعادة أو الرفض.', 'منظوری کے لیے دستخط اور واپسی یا مسترد کرنے کے لیے وجہ ضروری ہے۔'));
      return;
    }
    if (_decision != decision) { _operation = const Uuid().v4(); _decision = decision; _capturedAt = DateTime.now(); }
    setState(() { _busy = true; _error = null; });
    try {
      await ref.read(executionApprovalRepositoryProvider).decide(type: widget.type, id: widget.requestId, context: review, operation: _operation!, decision: decision, capturedAt: _capturedAt!, signature: decision == 'approved' ? _signature : null, reason: _reason.text.trim());
      if (mounted) await _load();
    } on Object catch (error) { if (mounted) setState(() => _error = classifySupabaseError(error).error.message); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    final review = _raw == null ? null : ApprovalReviewContext.fromJson(_raw!);
    final document = Map<String, dynamic>.from(_raw?['document'] as Map? ?? {});
    final source = Map<String, dynamic>.from(document['source_snapshot'] as Map? ?? {});
    final payload = Map<String, dynamic>.from(document['payload'] as Map? ?? {});
    final fields = <String, Object?>{...source, ...payload, ...document};
    final labels = <String, String>{'asset_no': executionApprovalCopy(context, 'Asset', 'المركبة', 'گاڑی'), 'title': executionApprovalCopy(context, 'Request', 'الطلب', 'درخواست'), 'work_type': executionApprovalCopy(context, 'Work type', 'نوع العمل', 'کام کی قسم'), 'description': executionApprovalCopy(context, 'Description', 'الوصف', 'تفصیل'), 'action': executionApprovalCopy(context, 'Action', 'الإجراء', 'کارروائی'), 'position': executionApprovalCopy(context, 'Tyre position', 'موضع الإطار', 'ٹائر کی جگہ'), 'serial_no': executionApprovalCopy(context, 'Serial number', 'الرقم التسلسلي', 'سیریل نمبر'), 'brand': executionApprovalCopy(context, 'Brand', 'العلامة', 'برانڈ'), 'reason': executionApprovalCopy(context, 'Reason', 'السبب', 'وجہ'), 'removal_reason': executionApprovalCopy(context, 'Removal reason', 'سبب الإزالة', 'ہٹانے کی وجہ'), 'km_at_fitment': executionApprovalCopy(context, 'Odometer at fitment', 'العداد عند التركيب', 'تنصیب پر میٹر'), 'cost_per_tyre': executionApprovalCopy(context, 'Cost per tyre', 'تكلفة الإطار', 'فی ٹائر لاگت')};
    return Scaffold(appBar: AppBar(title: Text(executionApprovalCopy(context, 'Before-execution approval', 'موافقة قبل التنفيذ', 'عمل سے پہلے منظوری')), actions: [IconButton(onPressed: _busy ? null : _load, icon: const Icon(Icons.refresh))]), body: ListView(padding: const EdgeInsets.all(16), children: [
      Text(executionApprovalCopy(context, 'Approval authorizes the proposed work. Execution is a separate confirmed action.', 'تسمح الموافقة بالعمل المقترح. التنفيذ إجراء منفصل مؤكد.', 'منظوری مجوزہ کام کی اجازت ہے۔ عمل درآمد الگ تصدیق شدہ کارروائی ہے۔')),
      if (_busy) const LinearProgressIndicator(),
      if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      for (final label in labels.entries) if (fields[label.key] != null) ListTile(title: Text(label.value), subtitle: Text('${fields[label.key]}')),
      if (review != null) ...[
        ApprovalRouteCard(review: review),
        ApprovalRouteActions(type: widget.type, entityId: widget.requestId, review: review, onRefresh: _load),
        if (review.canDecide || review.canReturn) ...[
          Text(executionApprovalCopy(context, 'A live connection is required. A failed decision is not applied.', 'يلزم اتصال مباشر. لا يطبق القرار الفاشل.', 'براہ راست کنکشن ضروری ہے۔ ناکام فیصلہ نافذ نہیں ہوتا۔')),
          InspectionApprovalSignaturePad(value: _signature, onChanged: _busy ? (_) {} : (capture) => setState(() { _signature = capture?.dataUrl; _operation = null; _decision = null; })),
          TextField(controller: _reason, enabled: !_busy, onChanged: (_) { _operation = null; _decision = null; }, maxLines: 3, decoration: InputDecoration(labelText: executionApprovalCopy(context, 'Decision reason', 'سبب القرار', 'فیصلے کی وجہ'))),
          Wrap(spacing: 8, children: [
            if (review.canDecide) FilledButton(onPressed: _busy ? null : () => _decide('approved'), child: Text(executionApprovalCopy(context, 'Approve', 'موافقة', 'منظور کریں'))),
            if (review.canReturn) OutlinedButton(onPressed: _busy ? null : () => _decide('returned'), child: Text(executionApprovalCopy(context, 'Return for correction', 'إعادة للتصحيح', 'درستگی کے لیے واپس کریں'))),
            if (review.canDecide) TextButton(onPressed: _busy ? null : () => _decide('rejected'), child: Text(approvalDecisionCopy(context, rejection: true))),
          ]),
        ],
      ],
    ]));
  }
}

/// Called before the existing guarded status queue starts a work order.
Future<bool> ensureWorkOrderApproval(BuildContext context, WidgetRef ref, String id) async {
  final repository = ref.read(executionApprovalRepositoryProvider);
  var result = await repository.workOrder(id);
  if (result['mode'] == 'legacy' || result['can_execute'] == true) return true;
  if (!context.mounted) return false;
  if (result['can_submit'] == true) {
    final reason = await requestExecutionReason(context);
    if (reason == null) return false;
    result = await repository.requestWorkOrder(id, const Uuid().v4(), reason);
  }
  if (!context.mounted) return false;
  final request = result['request_id'];
  if (request is String) {
    await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => ExecutionApprovalReviewScreen(type: 'work_order', requestId: request)));
  } else {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(executionApprovalCopy(context, 'Approval is required before this work can start.', 'تلزم الموافقة قبل بدء هذا العمل.', 'یہ کام شروع ہونے سے پہلے منظوری ضروری ہے۔'))));
  }
  return false;
}

Future<String?> requestExecutionReason(BuildContext context) async {
  final controller = TextEditingController();
  final form = GlobalKey<FormState>();
  final value = await showDialog<String>(context: context, builder: (context) => AlertDialog(title: Text(executionApprovalCopy(context, 'Request approval before execution', 'طلب الموافقة قبل التنفيذ', 'عمل سے پہلے منظوری کی درخواست')), content: Form(key: form, child: TextFormField(controller: controller, maxLines: 3, autofocus: true, decoration: InputDecoration(labelText: executionApprovalCopy(context, 'Reason', 'السبب', 'وجہ')), validator: (s) => s?.trim().isNotEmpty == true ? null : executionApprovalCopy(context, 'Required', 'مطلوب', 'ضروری'))), actions: [TextButton(onPressed: () => Navigator.pop(context), child: Text(MaterialLocalizations.of(context).cancelButtonLabel)), FilledButton(onPressed: () { if (form.currentState!.validate()) Navigator.pop(context, controller.text.trim()); }, child: Text(executionApprovalCopy(context, 'Submit request', 'إرسال الطلب', 'درخواست جمع کریں')))]));
  controller.dispose();
  return value;
}
