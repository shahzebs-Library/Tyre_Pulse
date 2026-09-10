import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/approvals/data/approval_operations_repository.dart';
import 'package:tyre_pulse/features/approvals/data/approval_review_context.dart';

class ApprovalRouteActions extends ConsumerStatefulWidget {
  const ApprovalRouteActions(
      {required this.type,
      required this.entityId,
      required this.review,
      required this.onRefresh,
      super.key});
  final String type, entityId;
  final ApprovalReviewContext review;
  final Future<void> Function() onRefresh;
  @override
  ConsumerState<ApprovalRouteActions> createState() =>
      _ApprovalRouteActionsState();
}

class _ApprovalRouteActionsState extends ConsumerState<ApprovalRouteActions> {
  bool _busy = false;
  String? _error;
  String _copy(String en, String ar, String ur) =>
      switch (Localizations.localeOf(context).languageCode) {
        'ar' => ar,
        'ur' => ur,
        _ => en
      };

  Future<void> _act(String action, {String? delegationId}) async {
    if (_busy) return;
    final frozenToken = widget.review.stageToken;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final repository = ref.read(approvalOperationsRepositoryProvider);
      final people = action == 'reassign' || action == 'delegate'
          ? await repository.people(widget.type, widget.entityId)
          : <Map<String, dynamic>>[];
      if (!mounted) return;
      final values = await showDialog<Map<String, Object?>>(
          context: context,
          builder: (_) => _ActionDialog(
              people: people,
              needsPerson: action == 'reassign' || action == 'delegate',
              delegation: action == 'delegate'));
      if (values == null) return;
      if (delegationId != null) {
        await repository.revoke(delegationId, values['reason']! as String);
      } else {
        await repository.act(
            type: widget.type,
            id: widget.entityId,
            token: frozenToken,
            action: action,
            reason: values['reason']! as String,
            person: values['person'] as String?,
            end: values['end'] as DateTime?);
      }
      await widget.onRefresh();
    } on Object catch (error) {
      if (mounted)
        setState(() => _error = classifySupabaseError(error).error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_busy) const LinearProgressIndicator(),
          if (_error != null)
            Text(_error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
          Wrap(
            spacing: 8,
            children: [
              if (widget.review.canRecover)
                OutlinedButton(
                    onPressed: _busy ? null : () => _act('recover'),
                    child: Text(_copy(
                        'Recover route', 'استعادة المسار', 'راستہ بحال کریں'))),
              if (widget.review.canReassign)
                OutlinedButton(
                    onPressed: _busy ? null : () => _act('reassign'),
                    child: Text(_copy('Reassign reviewer',
                        'إعادة تعيين المراجع', 'جائزہ کار دوبارہ مقرر کریں'))),
              if (widget.review.canDelegate)
                OutlinedButton(
                    onPressed: _busy ? null : () => _act('delegate'),
                    child: Text(_copy(
                        'Delegate temporarily', 'تفويض مؤقت', 'عارضی تفویض'))),
            ],
          ),
          for (final delegation
              in widget.review.delegations.where((d) => d['active'] == true))
            ListTile(
              title:
                  Text(_copy('Active delegation', 'تفويض نشط', 'فعال تفویض')),
              subtitle: Text(
                  '${delegation['delegate_name'] ?? delegation['delegate_id'] ?? ''} · ${delegation['ends_at'] ?? delegation['end_date'] ?? ''}'),
              trailing: (widget.review.canDelegate || widget.review.canReassign)
                  ? TextButton(
                      onPressed: _busy
                          ? null
                          : () => _act('revoke',
                              delegationId: delegation['id'] as String),
                      child: Text(_copy('Revoke', 'إلغاء', 'منسوخ کریں')))
                  : null,
            ),
        ],
      );
}

class _ActionDialog extends StatefulWidget {
  const _ActionDialog(
      {required this.people,
      required this.needsPerson,
      required this.delegation});
  final List<Map<String, dynamic>> people;
  final bool needsPerson, delegation;
  @override
  State<_ActionDialog> createState() => _ActionDialogState();
}

class _ActionDialogState extends State<_ActionDialog> {
  final _form = GlobalKey<FormState>();
  final _reason = TextEditingController();
  String? _person;
  DateTime _end = DateTime.now().add(const Duration(days: 1));
  String _search = '';
  String _copy(String en, String ar, String ur) =>
      switch (Localizations.localeOf(context).languageCode) {
        'ar' => ar,
        'ur' => ur,
        _ => en
      };
  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(_copy(
            'Approval administration', 'إدارة الموافقات', 'منظوری کا انتظام')),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Form(
              key: _form,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_copy(
                      'This action is audited and requires a connection.',
                      'يتم تدقيق هذا الإجراء ويتطلب اتصالاً.',
                      'یہ کارروائی ریکارڈ ہوتی ہے اور کنکشن ضروری ہے۔')),
                  if (widget.needsPerson) ...[
                    TextField(
                        onChanged: (s) =>
                            setState(() => _search = s.toLowerCase()),
                        decoration: InputDecoration(
                            labelText: _copy('Search reviewers',
                                'بحث المراجعين', 'جائزہ کار تلاش کریں'))),
                    DropdownButtonFormField<String>(
                        initialValue: _person,
                        isExpanded: true,
                        items: widget.people
                            .where((p) =>
                                p['id'] == _person ||
                                '${p['full_name']} ${p['role']}'
                                    .toLowerCase()
                                    .contains(_search))
                            .map((p) => DropdownMenuItem(
                                value: p['id'] as String,
                                child: Text('${p['full_name']} · ${p['role']}',
                                    overflow: TextOverflow.ellipsis)))
                            .toList(),
                        onChanged: (s) => setState(() => _person = s),
                        validator: (s) => s == null
                            ? _copy('Select a reviewer', 'اختر مراجعاً',
                                'جائزہ کار منتخب کریں')
                            : null),
                  ],
                  if (widget.delegation)
                    TextButton(
                      onPressed: () async {
                        final now = DateTime.now();
                        final day = await showDatePicker(
                            context: context,
                            initialDate: _end,
                            firstDate: now,
                            lastDate: now.add(const Duration(days: 89)));
                        if (day != null && mounted)
                          setState(() => _end =
                              DateTime(day.year, day.month, day.day, 23, 59));
                      },
                      child: Text(
                          '${_copy('Delegate until', 'التفويض حتى', 'تفویض کی آخری تاریخ')} ${MaterialLocalizations.of(context).formatMediumDate(_end)}'),
                    ),
                  TextFormField(
                      controller: _reason,
                      maxLines: 3,
                      decoration: InputDecoration(
                          labelText: _copy('Reason', 'السبب', 'وجہ')),
                      validator: (s) => s?.trim().isNotEmpty == true
                          ? null
                          : _copy('Reason required', 'السبب مطلوب',
                              'وجہ ضروری ہے')),
                ],
              ),
            ),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(MaterialLocalizations.of(context).cancelButtonLabel)),
          FilledButton(
              onPressed: () {
                if (_form.currentState!.validate())
                  Navigator.pop(context, <String, Object?>{
                    'reason': _reason.text.trim(),
                    'person': _person,
                    'end': _end
                  });
              },
              child: Text(_copy('Apply', 'تطبيق', 'نافذ کریں')))
        ],
      );
}
