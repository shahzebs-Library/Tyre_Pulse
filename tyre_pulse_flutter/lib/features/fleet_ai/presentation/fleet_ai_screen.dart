import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/fleet_ai/data/fleet_ai_repository.dart';

class FleetAiScreen extends ConsumerStatefulWidget {
  const FleetAiScreen({super.key});
  @override
  ConsumerState<FleetAiScreen> createState() => _FleetAiScreenState();
}

class _FleetAiScreenState extends ConsumerState<FleetAiScreen> {
  final _question = TextEditingController();
  final _asset = TextEditingController();
  String? _answer;
  String? _error;
  bool _sending = false;
  int _generation = 0;

  @override
  void dispose() {
    _question.dispose();
    _asset.dispose();
    super.dispose();
  }

  String _copy(String key) =>
      (_copyByLocale[Localizations.localeOf(context).languageCode] ??
          _copyByLocale['en']!)[key]!;

  Future<void> _send() async {
    if (_sending || _question.text.trim().isEmpty) return;
    final workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      setState(() => _error = _copy('workspace'));
      return;
    }
    final int generation = ++_generation;
    setState(() {
      _sending = true;
      _answer = null;
      _error = null;
    });
    try {
      final answer = await ref.read(fleetAiRepositoryProvider).ask(
            question: _question.text,
            assetNo: _asset.text,
            country: workspace.activeCountry,
            sites: workspace.siteIds,
            language: Localizations.localeOf(context).languageCode,
            isCurrentWorkspace: () =>
                mounted &&
                generation == _generation &&
                ref.read(workspaceContextProvider) == workspace,
          );
      if (!mounted || generation != _generation) return;
      setState(() {
        _answer = answer;
        _sending = false;
      });
    } on Object catch (error) {
      if (!mounted || generation != _generation) return;
      final AppError failure = mapSupabaseError(error);
      final String errorKey = switch (failure.kind) {
        AppErrorKind.authorization || AppErrorKind.authentication => 'denied',
        AppErrorKind.validation => 'invalid',
        AppErrorKind.network => 'offline',
        _ => 'failed',
      };
      setState(() {
        _error = _copy(errorKey);
        _sending = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(workspaceContextProvider, (previous, next) {
      if (previous == next) return;
      _generation++;
      _asset.clear();
      _question.clear();
      setState(() {
        _answer = null;
        _error = null;
        _sending = false;
      });
    });
    final String fallback = TpBackFallbacks.forRoute(const FleetAiRoute());
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(title: _copy('title'), backFallback: fallback),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          Text(_copy('scope')),
          const SizedBox(height: TpSpace.lg),
          TextField(
            controller: _asset,
            enabled: !_sending,
            decoration: InputDecoration(labelText: _copy('asset')),
          ),
          const SizedBox(height: TpSpace.md),
          TextField(
            controller: _question,
            enabled: !_sending,
            minLines: 3,
            maxLines: 6,
            maxLength: 4000,
            decoration: InputDecoration(labelText: _copy('question')),
          ),
          const SizedBox(height: TpSpace.md),
          FilledButton(
            onPressed: _sending ? null : _send,
            child: Text(_copy(_sending ? 'sending' : 'send')),
          ),
          if (_sending)
            const Padding(
              padding: EdgeInsets.all(TpSpace.lg),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: TpSpace.md),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (_answer != null) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(TpSpace.lg),
                child: SelectableText(_answer!),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

const _copyByLocale = <String, Map<String, String>>{
  'en': {
    'title': 'Fleet AI',
    'scope':
        'Ask a question online. Enter an exact asset number to include its current fleet record. Without an asset, answers contain general guidance only. Each question is independent.',
    'asset': 'Asset number (optional)',
    'question': 'Your question',
    'send': 'Ask Fleet AI',
    'sending': 'Getting answer…',
    'workspace': 'Select a workspace before asking Fleet AI.',
    'denied':
        'Your account cannot use Fleet AI. An approved administrator, manager or director account is required.',
    'invalid':
        'Check your question and exact asset number. The asset must belong to the selected workspace.',
    'offline':
        'Fleet AI needs a connection. Your question remains here; reconnect and retry.',
    'failed':
        'No answer received. Check your connection, asset number and AI access, then retry. Your question remains here.',
  },
  'ar': {
    'title': 'ذكاء الأسطول',
    'scope':
        'اطرح سؤالاً عبر الإنترنت. أدخل رقم الأصل بدقة لتضمين سجله الحالي. بدون أصل، تقتصر الإجابات على إرشادات عامة. كل سؤال مستقل.',
    'asset': 'رقم الأصل (اختياري)',
    'question': 'سؤالك',
    'send': 'اسأل ذكاء الأسطول',
    'sending': 'جارٍ الحصول على الإجابة…',
    'workspace': 'اختر مساحة عمل قبل طرح السؤال.',
    'denied':
        'لا يملك حسابك صلاحية ذكاء الأسطول. يلزم حساب مسؤول أو مدير معتمد.',
    'invalid':
        'تحقق من السؤال ورقم الأصل الدقيق. يجب أن يكون الأصل ضمن مساحة العمل المحددة.',
    'offline':
        'يحتاج ذكاء الأسطول إلى اتصال. يبقى سؤالك هنا؛ اتصل ثم أعد المحاولة.',
    'failed':
        'لم تصل إجابة. تحقق من الاتصال ورقم الأصل وصلاحية الذكاء الاصطناعي ثم أعد المحاولة. يبقى سؤالك هنا.',
  },
  'ur': {
    'title': 'فلیٹ اے آئی',
    'scope':
        'آن لائن سوال پوچھیں۔ موجودہ ریکارڈ شامل کرنے کے لیے اثاثے کا درست نمبر درج کریں۔ اثاثے کے بغیر صرف عمومی رہنمائی ملے گی۔ ہر سوال الگ ہے۔',
    'asset': 'اثاثہ نمبر (اختیاری)',
    'question': 'آپ کا سوال',
    'send': 'فلیٹ اے آئی سے پوچھیں',
    'sending': 'جواب حاصل ہو رہا ہے…',
    'workspace': 'سوال پوچھنے سے پہلے ورک اسپیس منتخب کریں۔',
    'denied':
        'آپ کے اکاؤنٹ کو فلیٹ اے آئی کی اجازت نہیں ہے۔ منظور شدہ ایڈمن، مینیجر یا ڈائریکٹر اکاؤنٹ درکار ہے۔',
    'invalid':
        'سوال اور اثاثے کا درست نمبر چیک کریں۔ اثاثہ منتخب ورک اسپیس کا ہونا چاہیے۔',
    'offline':
        'فلیٹ اے آئی کو کنکشن درکار ہے۔ سوال یہاں موجود ہے؛ دوبارہ جڑ کر کوشش کریں۔',
    'failed':
        'جواب موصول نہیں ہوا۔ کنکشن، اثاثہ نمبر اور اے آئی رسائی چیک کرکے دوبارہ کوشش کریں۔ سوال یہاں موجود ہے۔',
  },
};
