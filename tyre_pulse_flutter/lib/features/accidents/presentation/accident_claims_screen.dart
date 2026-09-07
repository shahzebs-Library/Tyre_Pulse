import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim.dart';

String accidentClaimCopy(BuildContext context, String key) {
  final language = Localizations.localeOf(context).languageCode;
  if (key == 'loadFailed') {
    return switch (language) {
      'ar' =>
        'تعذر تحميل المطالبة الحالية. تحقق من الاتصال والصلاحيات ثم أعد المحاولة.',
      'ur' =>
        'موجودہ کلیم لوڈ نہیں ہوا۔ کنکشن اور اجازتیں چیک کرکے دوبارہ کوشش کریں۔',
      _ =>
        'The current claim could not be loaded. Check your connection and access, then retry.',
    };
  }
  return (_copy[language] ?? _copy['en']!)[key]!;
}

class AccidentClaimsScreen extends ConsumerStatefulWidget {
  const AccidentClaimsScreen({
    required this.accidentId,
    this.claimAmount,
    super.key,
  });
  final String accidentId;
  final num? claimAmount;
  @override
  ConsumerState<AccidentClaimsScreen> createState() =>
      _AccidentClaimsScreenState();
}

class _AccidentClaimsScreenState extends ConsumerState<AccidentClaimsScreen> {
  AccidentClaim? _claim;
  AppError? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final claim = await ref
          .read(accidentClaimRepositoryProvider)
          .latest(widget.accidentId);
      if (!mounted) return;
      setState(() {
        _claim = claim;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      final failure = mapSupabaseError(error);
      setState(() {
        _error = AppError(
          kind: failure.kind,
          message: accidentClaimCopy(
            context,
            failure.kind == AppErrorKind.authorization
                ? 'denied'
                : 'loadFailed',
          ),
          technical: failure.technical,
        );
        _loading = false;
      });
    }
  }

  Future<void> _register() async {
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => AccidentClaimRegistrationForm(
        accidentId: widget.accidentId,
        claim: _claim,
        claimAmount: _claim?.claimAmount ?? widget.claimAmount,
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    String copy(String key) => accidentClaimCopy(context, key);
    return TpScaffold(
      appBar: TpAppBar(
        title: copy('title'),
        onBack: () => Navigator.of(context).pop(),
      ),
      body: _loading
          ? const TpLoadingState()
          : _error != null
              ? TpErrorState(error: _error!, onRetry: _load)
              : ListView(
                  padding: const EdgeInsets.all(TpSpace.lg),
                  children: <Widget>[
                    Text(copy('online')),
                    const SizedBox(height: TpSpace.lg),
                    if (_claim == null)
                      Text(copy('empty'))
                    else
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(TpSpace.lg),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                _claim!.claimNo ?? copy('unrecorded'),
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              Text(
                                '${copy('insurer')}: ${_claim!.insurer ?? copy('unrecorded')}',
                              ),
                              Text(
                                '${copy('policy')}: ${_claim!.policyNo ?? copy('unrecorded')}',
                              ),
                              Text(
                                '${copy('status')}: ${_claim!.decision ?? copy('unrecorded')}',
                              ),
                              Text(
                                '${copy('approved')}: ${_claim!.approvedAmount ?? copy('unrecorded')}',
                              ),
                            ],
                          ),
                        ),
                      ),
                    const SizedBox(height: TpSpace.lg),
                    FilledButton(
                      onPressed: _register,
                      child: Text(
                        copy(_claim == null ? 'register' : 'update'),
                      ),
                    ),
                  ],
                ),
    );
  }
}

class AccidentClaimRegistrationForm extends ConsumerStatefulWidget {
  const AccidentClaimRegistrationForm({
    required this.accidentId,
    this.claim,
    this.claimAmount,
    super.key,
  });
  final String accidentId;
  final AccidentClaim? claim;
  final num? claimAmount;
  @override
  ConsumerState<AccidentClaimRegistrationForm> createState() =>
      _AccidentClaimRegistrationFormState();
}

class _AccidentClaimRegistrationFormState
    extends ConsumerState<AccidentClaimRegistrationForm> {
  final _form = GlobalKey<FormState>();
  late final _insurer = TextEditingController(text: widget.claim?.insurer);
  late final _policy = TextEditingController(text: widget.claim?.policyNo);
  late final _claimNo = TextEditingController(text: widget.claim?.claimNo);
  late final _amount =
      TextEditingController(text: widget.claimAmount?.toString());
  late final _deductible =
      TextEditingController(text: widget.claim?.deductible?.toString());
  bool _saving = false;
  bool _uncertain = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_insurer, _policy, _claimNo, _amount, _deductible]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving || _uncertain || !_form.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(accidentClaimRepositoryProvider).register(
            accidentId: widget.accidentId,
            insurer: _insurer.text,
            policyNo: _policy.text,
            claimNo: _claimNo.text,
            claimAmount: num.parse(_amount.text.trim()),
            deductible: _deductible.text.trim().isEmpty
                ? null
                : num.parse(_deductible.text.trim()),
          );
      if (mounted) Navigator.of(context).pop();
    } on Object catch (error) {
      if (!mounted) return;
      final failure = mapSupabaseError(error);
      setState(() {
        _saving = false;
        _uncertain = failure.kind != AppErrorKind.authorization &&
            failure.kind != AppErrorKind.validation &&
            failure.kind != AppErrorKind.authentication;
        _error =
            accidentClaimCopy(context, _uncertain ? 'unconfirmed' : 'denied');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    String copy(String key) => accidentClaimCopy(context, key);
    Widget field(
      TextEditingController controller,
      String label, {
      bool amount = false,
      bool optional = false,
    }) =>
        TextFormField(
          controller: controller,
          enabled: !_saving,
          decoration: InputDecoration(labelText: copy(label)),
          keyboardType: amount
              ? const TextInputType.numberWithOptions(decimal: true)
              : TextInputType.text,
          validator: (value) {
            final text = value?.trim() ?? '';
            if (optional && text.isEmpty) return null;
            if (text.isEmpty) return copy('required');
            if (amount) {
              final number = num.tryParse(text);
              if (number == null || !number.isFinite || number < 0) {
                return copy('invalidAmount');
              }
            }
            return null;
          },
        );
    return PopScope(
      canPop: !_saving,
      child: AlertDialog(
        title: Text(copy(widget.claim == null ? 'register' : 'update')),
        content: SingleChildScrollView(
          child: Form(
            key: _form,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(copy('online')),
                field(_insurer, 'insurer'),
                field(_policy, 'policy'),
                field(_claimNo, 'claimNo'),
                field(_amount, 'amount', amount: true),
                field(
                  _deductible,
                  'deductible',
                  amount: true,
                  optional: true,
                ),
                if (_error != null)
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
              ],
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: _saving ? null : () => Navigator.of(context).pop(),
            child: Text(copy('close')),
          ),
          FilledButton(
            key: const Key('accident.claim.save'),
            onPressed: _saving || _uncertain ? null : _save,
            child: Text(copy(_saving ? 'saving' : 'save')),
          ),
        ],
      ),
    );
  }
}

const _copy = <String, Map<String, String>>{
  'en': {
    'title': 'Insurance claim',
    'online':
        'Online only. Saving updates the latest claim for this case. Your current insurance permissions are checked by the server.',
    'empty': 'No claim is registered for this case.',
    'unrecorded': 'Not recorded',
    'insurer': 'Insurer',
    'policy': 'Policy number',
    'claimNo': 'Claim number',
    'amount': 'Claim amount',
    'deductible': 'Deductible (optional)',
    'status': 'Decision',
    'approved': 'Approved amount',
    'register': 'Register claim',
    'update': 'Update registration',
    'save': 'Save',
    'saving': 'Saving…',
    'close': 'Close',
    'required': 'Required',
    'invalidAmount': 'Enter a nonnegative amount.',
    'denied':
        'The claim could not be saved. Check your insurance permissions and entries.',
    'unconfirmed':
        'Saving was not confirmed. Close this form to reload the latest claim before attempting another update.',
  },
  'ar': {
    'title': 'مطالبة التأمين',
    'online':
        'متصل فقط. يتم تحديث أحدث مطالبة لهذه الحالة. يتحقق الخادم من صلاحيات التأمين الحالية.',
    'empty': 'لا توجد مطالبة مسجلة لهذه الحالة.',
    'unrecorded': 'غير مسجل',
    'insurer': 'شركة التأمين',
    'policy': 'رقم الوثيقة',
    'claimNo': 'رقم المطالبة',
    'amount': 'مبلغ المطالبة',
    'deductible': 'مبلغ التحمل (اختياري)',
    'status': 'القرار',
    'approved': 'المبلغ المعتمد',
    'register': 'تسجيل المطالبة',
    'update': 'تحديث التسجيل',
    'save': 'حفظ',
    'saving': 'جارٍ الحفظ…',
    'close': 'إغلاق',
    'required': 'مطلوب',
    'invalidAmount': 'أدخل مبلغاً غير سالب.',
    'denied': 'تعذر حفظ المطالبة. تحقق من الصلاحيات والبيانات.',
    'unconfirmed':
        'لم يتم تأكيد الحفظ. أغلق النموذج لإعادة تحميل أحدث مطالبة قبل محاولة التحديث مجدداً.',
  },
  'ur': {
    'title': 'انشورنس کلیم',
    'online':
        'صرف آن لائن۔ اس کیس کا تازہ ترین کلیم اپ ڈیٹ ہوگا۔ سرور موجودہ انشورنس اجازتیں چیک کرتا ہے۔',
    'empty': 'اس کیس کا کوئی کلیم درج نہیں ہے۔',
    'unrecorded': 'درج نہیں',
    'insurer': 'بیمہ کمپنی',
    'policy': 'پالیسی نمبر',
    'claimNo': 'کلیم نمبر',
    'amount': 'کلیم کی رقم',
    'deductible': 'کٹوتی (اختیاری)',
    'status': 'فیصلہ',
    'approved': 'منظور شدہ رقم',
    'register': 'کلیم درج کریں',
    'update': 'رجسٹریشن اپ ڈیٹ کریں',
    'save': 'محفوظ کریں',
    'saving': 'محفوظ ہو رہا ہے…',
    'close': 'بند کریں',
    'required': 'ضروری',
    'invalidAmount': 'غیر منفی رقم درج کریں۔',
    'denied': 'کلیم محفوظ نہیں ہوا۔ اجازتیں اور اندراجات چیک کریں۔',
    'unconfirmed':
        'محفوظ ہونے کی تصدیق نہیں ہوئی۔ دوبارہ اپ ڈیٹ سے پہلے فارم بند کرکے تازہ ترین کلیم لوڈ کریں۔',
  },
};
