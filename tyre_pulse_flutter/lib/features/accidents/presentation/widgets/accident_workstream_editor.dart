import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/accidents/data/accident_workstream_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';

String workstreamEditorCopy(BuildContext context, String key) {
  final String language = Localizations.localeOf(context).languageCode;
  return (_copy[language] ?? _copy['en']!)[key]!;
}

const _copy = <String, Map<String, String>>{
  'en': {
    'title': 'Update workstream',
    'waiverTitle': 'Approve not-applicable waiver',
    'waiverInfo':
        'This marks the workstream not applicable and records you as its approver. A reason is required. Online permission checks apply.',
    'reason': 'Reason (required)',
    'approve': 'Approve waiver',
    'online':
        'Online only. Your current case permissions are checked when saving.',
    'save': 'Save',
    'failed':
        'Update not confirmed. Check the case status before retrying. Your note remains in this form.',
    'cancel': 'Cancel',
    'note': 'Note (optional)',
    'in_progress': 'In progress',
    'waiting_info': 'Waiting for information',
    'waiting_external': 'Waiting for external party',
    'on_hold': 'On hold',
    'completed': 'Completed',
    'reopened': 'Reopened',
  },
  'ar': {
    'title': 'تحديث مسار العمل',
    'waiverTitle': 'اعتماد عدم انطباق المسار',
    'waiverInfo':
        'سيتم تحديد المسار كغير منطبق وتسجيلك كمعتمد. السبب مطلوب. يتم التحقق من الصلاحيات عبر الإنترنت.',
    'reason': 'السبب (مطلوب)',
    'approve': 'اعتماد الإعفاء',
    'online': 'متصل فقط. يتم التحقق من صلاحيات الحالة الحالية عند الحفظ.',
    'save': 'حفظ',
    'failed':
        'لم يتم تأكيد التحديث. تحقق من حالة المسار قبل إعادة المحاولة. تبقى ملاحظتك في هذا النموذج.',
    'cancel': 'إلغاء',
    'note': 'ملاحظة (اختياري)',
    'in_progress': 'قيد التنفيذ',
    'waiting_info': 'بانتظار المعلومات',
    'waiting_external': 'بانتظار جهة خارجية',
    'on_hold': 'معلق',
    'completed': 'مكتمل',
    'reopened': 'أعيد فتحه',
  },
  'ur': {
    'title': 'ورک اسٹریم اپ ڈیٹ کریں',
    'waiverTitle': 'غیر قابل اطلاق چھوٹ منظور کریں',
    'waiverInfo':
        'ورک اسٹریم غیر قابل اطلاق ہوگا اور آپ منظوری دینے والے کے طور پر درج ہوں گے۔ وجہ ضروری ہے۔ اجازت آن لائن جانچی جائے گی۔',
    'reason': 'وجہ (ضروری)',
    'approve': 'چھوٹ منظور کریں',
    'online':
        'صرف آن لائن۔ محفوظ کرتے وقت موجودہ کیس کی اجازتیں جانچی جاتی ہیں۔',
    'save': 'محفوظ کریں',
    'failed':
        'اپ ڈیٹ کی تصدیق نہیں ہوئی۔ دوبارہ کوشش سے پہلے کیس کی حالت دیکھیں۔ نوٹ اس فارم میں موجود ہے۔',
    'cancel': 'منسوخ',
    'note': 'نوٹ (اختیاری)',
    'in_progress': 'جاری ہے',
    'waiting_info': 'معلومات کا انتظار',
    'waiting_external': 'بیرونی فریق کا انتظار',
    'on_hold': 'روکا گیا',
    'completed': 'مکمل',
    'reopened': 'دوبارہ کھولا گیا',
  },
};

class AccidentWorkstreamEditor extends ConsumerStatefulWidget {
  const AccidentWorkstreamEditor({
    required this.accidentId,
    required this.workstreams,
    this.waiver = false,
    super.key,
  });
  final String accidentId;
  final List<AccidentWorkstream> workstreams;
  final bool waiver;

  @override
  ConsumerState<AccidentWorkstreamEditor> createState() =>
      _AccidentWorkstreamEditorState();
}

class _AccidentWorkstreamEditorState
    extends ConsumerState<AccidentWorkstreamEditor> {
  late String _key = widget.workstreams.first.key;
  String? _status;
  final _note = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving || !_valid) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final repository = ref.read(accidentWorkstreamRepositoryProvider);
      if (widget.waiver) {
        await repository.waive(
          accidentId: widget.accidentId,
          workstreamKey: _key,
          reason: _note.text,
        );
      } else {
        await repository.update(
          accidentId: widget.accidentId,
          workstreamKey: _key,
          status: _status!,
          note: _note.text,
        );
      }
      if (mounted) Navigator.of(context).pop(true);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        final AppError failure =
            accidentAppError(error, AccidentCopy.of(context));
        _error = failure.kind == AppErrorKind.authorization ||
                failure.kind == AppErrorKind.authentication
            ? failure.message
            : workstreamEditorCopy(context, 'failed');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    String copy(String key) => workstreamEditorCopy(context, key);
    return PopScope(
      canPop: !_saving,
      child: AlertDialog(
        title: Text(copy(widget.waiver ? 'waiverTitle' : 'title')),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(copy(widget.waiver ? 'waiverInfo' : 'online')),
              DropdownButtonFormField<String>(
                initialValue: _key,
                isExpanded: true,
                items: widget.workstreams
                    .map(
                      (ws) => DropdownMenuItem(
                        value: ws.key,
                        child: Text(
                          workstreamLabel(AccidentCopy.of(context), ws.key),
                        ),
                      ),
                    )
                    .toList(),
                onChanged:
                    _saving ? null : (value) => setState(() => _key = value!),
              ),
              if (!widget.waiver)
                DropdownButtonFormField<String>(
                  key: const Key('accident.workstream.status'),
                  isExpanded: true,
                  items: AccidentWorkstreamRepository.statuses
                      .map(
                        (status) => DropdownMenuItem(
                          value: status,
                          child: Text(copy(status)),
                        ),
                      )
                      .toList(),
                  onChanged: _saving
                      ? null
                      : (value) => setState(() => _status = value),
                ),
              TextField(
                controller: _note,
                enabled: !_saving,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: copy(widget.waiver ? 'reason' : 'note'),
                ),
                onChanged: (_) => setState(() {}),
              ),
              if (_error != null)
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: _saving ? null : () => Navigator.of(context).pop(false),
            child: Text(copy('cancel')),
          ),
          FilledButton(
            key: const Key('accident.workstream.save'),
            onPressed: _saving || !_valid ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(copy(widget.waiver ? 'approve' : 'save')),
          ),
        ],
      ),
    );
  }

  bool get _valid =>
      widget.waiver ? _note.text.trim().isNotEmpty : _status != null;
}
