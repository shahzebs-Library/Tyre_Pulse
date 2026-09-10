import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/approvals/data/execution_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/presentation/execution_approval_review_screen.dart';
import 'package:uuid/uuid.dart';

/// A proposal is durable before networking. Neither submitting nor approving
/// it changes fitment; only the explicit server-confirmed Execute action does.
class TyreExecutionApprovalScreen extends ConsumerStatefulWidget {
  const TyreExecutionApprovalScreen({required this.vehicleId, required this.captureId, required this.capture, super.key});
  final String vehicleId, captureId;
  final Map<String, dynamic> capture;
  @override
  ConsumerState<TyreExecutionApprovalScreen> createState() => _TyreExecutionApprovalScreenState();
}
class _TyreExecutionApprovalScreenState extends ConsumerState<TyreExecutionApprovalScreen> {
  late ExecutionApprovalDraftStore _store;
  late String _key;
  Map<String, dynamic>? _draft, _remote;
  bool _busy = true;
  String? _error;
  final _reason = TextEditingController();
  Object? _workspace;

  String _copy(String en, String ar, String ur) => executionApprovalCopy(context, en, ar, ur);
  @override
  void initState() { super.initState(); Future.microtask(_initialize); }
  @override
  void dispose() { _reason.dispose(); super.dispose(); }

  Future<void> _initialize() async {
    final workspace = ref.read(workspaceContextProvider);
    _workspace = workspace;
    if (workspace == null) { setState(() { _busy = false; _error = _copy('Select a workspace first.', 'اختر مساحة عمل أولاً.', 'پہلے ورک اسپیس منتخب کریں۔'); }); return; }
    _store = ExecutionApprovalDraftStore('${workspace.tenantId}/${workspace.userId}');
    _key = 'tyre_${widget.captureId}';
    try {
      final saved = await _store.read(_key);
      _draft = saved ?? {...widget.capture, 'vehicle_id': widget.vehicleId, 'operation_id': widget.captureId, 'uploaded_photos': <String, String>{}, 'execute_operations': <String, String>{}};
      await _store.save(_key, _draft!);
      _reason.text = _draft!['request_reason'] as String? ?? _draft!['removal_reason'] as String? ?? '';
      await _refresh();
    } on Object catch (error) { if (mounted) setState(() => _error = classifySupabaseError(error).error.message); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  Future<void> _refresh() async {
    final remote = await ref.read(executionApprovalRepositoryProvider).tyreContext(widget.vehicleId);
    if (mounted) setState(() => _remote = remote);
  }
  Future<void> _submit() async {
    if (_busy || _draft == null) return;
    if (_reason.text.trim().isEmpty) { setState(() => _error = _copy('Enter the reason for this proposed change.', 'أدخل سبب التغيير المقترح.', 'مجوزہ تبدیلی کی وجہ درج کریں۔')); return; }
    setState(() { _busy = true; _error = null; });
    try {
      final repository = ref.read(executionApprovalRepositoryProvider);
      final draft = _draft!;
      draft['request_reason'] = _reason.text.trim();
      await _store.save(_key, draft);
      var change = draft['change'] is Map ? Map<String, dynamic>.from(draft['change'] as Map) : null;
      if (change == null) {
        final tyres = await repository.activeTyres(draft['asset_no'] as String);
        final matches = tyres.where((t) => (t['tyre_position'] ?? t['position']) == draft['position']).toList();
        if (matches.length > 1) throw StateError('Multiple active tyres occupy this position; refresh and resolve fitment first.');
        change = <String, dynamic>{
          'action': matches.isEmpty ? 'install' : 'replace',
          'position': draft['position'],
          if (matches.isNotEmpty) 'removed_record_id': matches.single['id'],
          'serial_no': draft['serial_no'], 'brand': draft['brand'],
          'size': draft['size'], 'tread_depth': draft['tread_depth'],
          'km_at_fitment': draft['km_at_fitment'], 'cost_per_tyre': draft['cost_per_tyre'],
          'issue_date': draft['issue_date'],
          if (matches.isNotEmpty) ...{'removal_reason': draft['request_reason'], 'km_at_removal': draft['km_at_fitment'], 'removal_date': draft['issue_date']},
        }..removeWhere((key, value) => value == null);
        draft['change'] = change;
        await _store.save(_key, draft);
      }
      final photos = (draft['photo_paths'] as List? ?? []).cast<String>();
      final uploaded = Map<String, dynamic>.from(draft['uploaded_photos'] as Map? ?? {});
      for (var index = 0; index < photos.length; index++) {
        if (uploaded['$index'] == null) {
          final extension = photos[index].split('.').last.toLowerCase();
          final name = 'approval_${draft['operation_id']}_$index.$extension';
          uploaded['$index'] = await repository.uploadPhoto(photos[index], name);
          draft['uploaded_photos'] = uploaded;
          await _store.save(_key, draft);
        }
      }
      if (photos.isNotEmpty) change['photos'] = [for (var i = 0; i < photos.length; i++) uploaded['$i']];
      draft['change'] = change;
      await _store.save(_key, draft);
      final request = await repository.requestTyre(widget.vehicleId, change, draft['operation_id'] as String, draft['request_reason'] as String);
      if (request['id'] is! String) throw const FormatException('Request acknowledgement is missing.');
      draft['request_id'] = request['id'];
      await _store.save(_key, draft);
      await _refresh();
    } on Object catch (error) { if (mounted) setState(() => _error = classifySupabaseError(error).error.message); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  Future<void> _execute(Map<String, dynamic> request) async {
    if (_busy || _draft == null) return;
    final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: Text(_copy('Execute approved tyre change?', 'تنفيذ تغيير الإطار المعتمد؟', 'منظور شدہ ٹائر تبدیلی نافذ کریں؟')), content: Text(_copy('This changes the live fitment and inventory. The server rechecks the approved proposal and current tyres.', 'يغير هذا التركيب والمخزون الفعليين. يتحقق الخادم من المقترح المعتمد والإطارات الحالية.', 'اس سے حقیقی تنصیب اور اسٹاک تبدیل ہوں گے۔ سرور منظور شدہ تجویز اور موجودہ ٹائر دوبارہ جانچے گا۔')), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: Text(MaterialLocalizations.of(context).cancelButtonLabel)), FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(_copy('Execute', 'تنفيذ', 'نافذ کریں')))]));
    if (confirmed != true || !mounted) return;
    setState(() { _busy = true; _error = null; });
    try {
      final operations = Map<String, dynamic>.from(_draft!['execute_operations'] as Map? ?? {});
      final id = request['id'] as String;
      operations.putIfAbsent(id, () => const Uuid().v4());
      _draft!['execute_operations'] = operations;
      await _store.save(_key, _draft!);
      await ref.read(executionApprovalRepositoryProvider).executeTyre(id, operations[id] as String);
      await _refresh();
    } on Object catch (error) { if (mounted) setState(() => _error = classifySupabaseError(error).error.message); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    ref.listen(workspaceContextProvider, (_, next) { if (_workspace != null && next != _workspace && mounted) Navigator.of(context).pop(); });
    final requests = (_remote?['requests'] as List? ?? []).whereType<Map<String, dynamic>>();
    return PopScope(canPop: !_busy, child: Scaffold(appBar: AppBar(title: Text(_copy('Tyre change approval', 'موافقة تغيير الإطار', 'ٹائر تبدیلی کی منظوری')), actions: [IconButton(onPressed: _busy ? null : () async { setState(() => _busy = true); try { await _refresh(); } on Object catch (error) { if (mounted) setState(() => _error = classifySupabaseError(error).error.message); } finally { if (mounted) setState(() => _busy = false); } }, icon: const Icon(Icons.refresh))]), body: ListView(padding: const EdgeInsets.all(16), children: [
      Text(_copy('This is a proposal, not a completed tyre change. Captured details and local photos are retained on this device until delivery is confirmed. Submission and execution require a connection.', 'هذا مقترح وليس تغيير إطار مكتمل. تُحفظ التفاصيل والصور المحلية على هذا الجهاز حتى تأكيد التسليم. يتطلب الإرسال والتنفيذ اتصالاً.', 'یہ تجویز ہے، مکمل ٹائر تبدیلی نہیں۔ تفصیلات اور تصاویر تصدیق تک اس آلے پر محفوظ ہیں۔ جمع کرنے اور عمل کے لیے کنکشن ضروری ہے۔')),
      if (_busy) const LinearProgressIndicator(),
      if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
      if (_draft != null) ...[
        ListTile(title: Text('${_draft!['asset_no']} · ${_draft!['position']}'), subtitle: Text('${_draft!['serial_no'] ?? ''} · ${_draft!['brand'] ?? ''}')),
        for (final path in (_draft!['photo_paths'] as List? ?? []).whereType<String>()) Padding(padding: const EdgeInsets.only(bottom: 8), child: Image.file(File(path), height: 150, fit: BoxFit.contain, errorBuilder: (_, error, stack) => Text(_copy('Local photo unavailable; restore it before submitting.', 'الصورة المحلية غير متاحة؛ استعدها قبل الإرسال.', 'مقامی تصویر دستیاب نہیں؛ جمع کرنے سے پہلے بحال کریں۔')))),
        TextField(controller: _reason, enabled: !_busy && _draft!['request_id'] == null && _draft!['change'] == null, maxLines: 3, decoration: InputDecoration(labelText: _copy('Request reason', 'سبب الطلب', 'درخواست کی وجہ'))),
        if (_draft!['request_id'] == null) FilledButton(onPressed: _busy ? null : _submit, child: Text(_copy('Submit proposal for approval', 'إرسال المقترح للموافقة', 'تجویز منظوری کے لیے جمع کریں'))),
        if (_draft!['request_id'] != null) ...[
          Text(_copy('Proposal received by the server. Review its current status below.', 'استلم الخادم المقترح. راجع حالته الحالية أدناه.', 'سرور نے تجویز وصول کر لی۔ موجودہ حالت نیچے دیکھیں۔')),
          OutlinedButton(onPressed: _busy ? null : () => Navigator.of(context).pop(true), child: Text(_copy('Prepare a revised or new proposal', 'إعداد مقترح معدل أو جديد', 'ترمیم شدہ یا نئی تجویز تیار کریں'))),
        ],
      ],
      for (final request in requests) Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${request['title'] ?? request['action']}'),
        Text('${request['approval_outcome'] ?? request['approval_status']} · ${request['status']}'),
        Wrap(spacing: 8, children: [OutlinedButton(onPressed: _busy ? null : () async { await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => ExecutionApprovalReviewScreen(type: 'tyre_change', requestId: request['id'] as String))); if (mounted) { try { await _refresh(); } on Object catch (error) { if (mounted) setState(() => _error = classifySupabaseError(error).error.message); } } }, child: Text(_copy('Review and history', 'المراجعة والسجل', 'جائزہ اور تاریخ'))), if (request['can_execute'] == true) FilledButton(onPressed: _busy ? null : () => _execute(request), child: Text(_copy('Execute approved change', 'تنفيذ التغيير المعتمد', 'منظور شدہ تبدیلی نافذ کریں')))]),
      ]))),
    ])));
  }
}

class SavedTyreApprovalDraftsScreen extends ConsumerWidget {
  const SavedTyreApprovalDraftsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspace = ref.watch(workspaceContextProvider);
    final title = executionApprovalCopy(context, 'Saved tyre proposals', 'مقترحات الإطارات المحفوظة', 'محفوظ ٹائر تجاویز');
    return Scaffold(appBar: AppBar(title: Text(title)), body: workspace == null ? const SizedBox.shrink() : FutureBuilder<List<Map<String, dynamic>>>(
      future: ExecutionApprovalDraftStore('${workspace.tenantId}/${workspace.userId}').list(),
      builder: (context, snapshot) {
        if (snapshot.hasError) return Center(child: Text(classifySupabaseError(snapshot.error!).error.message));
        if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
        if (snapshot.data!.isEmpty) return Center(child: Text(executionApprovalCopy(context, 'No saved proposals on this device.', 'لا توجد مقترحات محفوظة على هذا الجهاز.', 'اس آلے پر کوئی محفوظ تجویز نہیں۔')));
        return ListView(children: [for (final draft in snapshot.data!) ListTile(title: Text('${draft['asset_no']} · ${draft['position']}'), subtitle: Text(draft['request_id'] == null ? executionApprovalCopy(context, 'Saved locally — awaiting submission', 'محفوظ محلياً — بانتظار الإرسال', 'مقامی طور پر محفوظ — جمع ہونا باقی') : executionApprovalCopy(context, 'Submitted — open current server status', 'مرسل — افتح حالة الخادم الحالية', 'جمع شدہ — سرور کی موجودہ حالت دیکھیں')), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => TyreExecutionApprovalScreen(vehicleId: draft['vehicle_id'] as String, captureId: draft['operation_id'] as String, capture: draft))))]);
      },
    ));
  }
}
