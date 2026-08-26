/// Proves the single most important invariant in this feature: scrapping or
/// undoing a scrap asks the precondition RPC, then makes EXACTLY ONE
/// mutating RPC call - never a second write, and never the mutating call at
/// all when the precondition was not confirmed.
///
/// This is tested against [SupabaseTyreLookupRepository] directly, through
/// its `.withRpcCaller` test seam, rather than against the [RpcCaller]
/// contract alone - the seam only proves something if the class actually
/// built on top of it is the one under test. No [SupabaseClient] is ever
/// constructed: [SupabaseTyreLookupRepository.withRpcCaller] accepts a null
/// client, and neither `scrapBySerial` nor `unscrapBySerial` ever reaches
/// it, so this file needs no real or mocked Supabase object at all - see
/// the production file's library comment for why that matters in an
/// environment with no Flutter SDK to verify `supabase_flutter`'s exact
/// query-builder API against.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/tyres/data/tyre_lookup_repository.dart';

/// One recorded RPC invocation.
class _RecordedCall {
  const _RecordedCall(this.function, this.params);

  final String function;
  final Map<String, Object?> params;
}

/// An [RpcCaller] driven entirely by a script keyed on function name, that
/// records every call it receives - in order - so a test can assert both
/// WHAT was called and, just as importantly, what was NOT.
class _ScriptedRpcCaller {
  final List<_RecordedCall> calls = <_RecordedCall>[];
  final Map<String, Object? Function(Map<String, Object?> params)> _answers =
      <String, Object? Function(Map<String, Object?> params)>{};

  void answer(
    String function,
    Object? Function(Map<String, Object?> params) reply,
  ) {
    _answers[function] = reply;
  }

  void answerWith(String function, Object? value) {
    answer(function, (_) => value);
  }

  void fail(String function, Object error) {
    answer(function, (_) => throw error);
  }

  Future<Object?> call(String function, Map<String, Object?> params) async {
    calls.add(_RecordedCall(function, params));
    final Object? Function(Map<String, Object?> params)? reply =
        _answers[function];
    if (reply == null) {
      throw StateError(
        'Unscripted RPC call to "$function". Script every function this '
        'test expects to be reached.',
      );
    }
    return reply(params);
  }

  int callCountFor(String function) =>
      calls.where((_RecordedCall c) => c.function == function).length;

  bool wasCalled(String function) => callCountFor(function) > 0;
}

SupabaseTyreLookupRepository _repositoryFor(_ScriptedRpcCaller rpc) =>
    SupabaseTyreLookupRepository.withRpcCaller(rpc.call);

void main() {
  group('scrapBySerial - the critical single-write invariant', () {
    test('asks the precondition once, then makes EXACTLY ONE mutating '
        'call, and no other request reaches the server', () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..answerWith(SupabaseRpcs.tyreScrapAllowed, true)
        ..answerWith(
          SupabaseRpcs.scrapTyreBySerial,
          <String, Object?>{'updated': 2},
        );
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      final int updated = await repository.scrapBySerial(
        'EP0604207',
        reason: 'Worn beyond limit',
      );

      expect(updated, 2);
      expect(rpc.calls, hasLength(2));
      expect(rpc.calls[0].function, SupabaseRpcs.tyreScrapAllowed);
      expect(rpc.calls[1].function, SupabaseRpcs.scrapTyreBySerial);
      expect(rpc.callCountFor(SupabaseRpcs.scrapTyreBySerial), 1);
    });

    test('sends exactly the serial and reason as arguments, and no '
        'country from this call site', () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..answerWith(SupabaseRpcs.tyreScrapAllowed, true)
        ..answerWith(SupabaseRpcs.scrapTyreBySerial, <String, Object?>{});
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      await repository.scrapBySerial('EP0604207', reason: 'Worn');

      final Map<String, Object?> params =
          rpc.calls.last.params; // The mutating call.
      expect(params['p_serial'], 'EP0604207');
      expect(params['p_reason'], 'Worn');
      expect(params['p_country'], isNull);
    });

    test('a blank reason is sent as null, not an empty string', () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..answerWith(SupabaseRpcs.tyreScrapAllowed, true)
        ..answerWith(SupabaseRpcs.scrapTyreBySerial, <String, Object?>{});
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      await repository.scrapBySerial('EP0604207', reason: '   ');

      expect(rpc.calls.last.params['p_reason'], isNull);
    });

    test('refuses LOCALLY, with an authorization AppError, and NEVER '
        'reaches the mutating RPC, when the precondition answers false',
        () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..answerWith(SupabaseRpcs.tyreScrapAllowed, false);
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      await expectLater(
        () => repository.scrapBySerial('EP0604207'),
        throwsA(
          isA<AppError>().having(
            (AppError e) => e.kind,
            'kind',
            AppErrorKind.authorization,
          ),
        ),
      );

      expect(rpc.calls, hasLength(1));
      expect(rpc.calls.single.function, SupabaseRpcs.tyreScrapAllowed);
      expect(
        rpc.wasCalled(SupabaseRpcs.scrapTyreBySerial),
        isFalse,
        reason: 'the mutating write must never be attempted when the '
            'precondition was not confirmed',
      );
    });

    test('refuses locally, without a network round trip for the mutating '
        'RPC, when the precondition RPC itself fails', () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..fail(SupabaseRpcs.tyreScrapAllowed, StateError('offline'));
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      await expectLater(
        () => repository.scrapBySerial('EP0604207'),
        throwsA(isA<AppError>()),
      );
      expect(
        rpc.wasCalled(SupabaseRpcs.scrapTyreBySerial),
        isFalse,
      );
    });

    test('refuses locally, with a validation AppError, for a blank '
        'serial - the precondition RPC is never even asked', () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller();
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      await expectLater(
        () => repository.scrapBySerial('   '),
        throwsA(
          isA<AppError>().having(
            (AppError e) => e.kind,
            'kind',
            AppErrorKind.validation,
          ),
        ),
      );
      expect(rpc.calls, isEmpty);
    });

    test('a server failure on the mutating call is surfaced through the '
        'error mapper, not swallowed', () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..answerWith(SupabaseRpcs.tyreScrapAllowed, true)
        ..fail(SupabaseRpcs.scrapTyreBySerial, StateError('server error'));
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      // The mutating call goes through SupabaseGateway.guard, which
      // reclassifies whatever it catches into a SupabaseFailure (carrying
      // a safe-to-show AppError inside it) - it is NOT a bare AppError at
      // this call site, unlike the local precondition refusals above,
      // which throw AppError directly without going through guard at all.
      await expectLater(
        () => repository.scrapBySerial('EP0604207'),
        throwsA(isA<SupabaseFailure>()),
      );
      // Both calls happened - the precondition passed, and the write was
      // genuinely attempted; it just failed once it reached the server.
      expect(rpc.calls, hasLength(2));
    });

    test('a missing "updated" field decodes to 0, not a crash', () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..answerWith(SupabaseRpcs.tyreScrapAllowed, true)
        ..answerWith(SupabaseRpcs.scrapTyreBySerial, <String, Object?>{});
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      final int updated = await repository.scrapBySerial('EP0604207');
      expect(updated, 0);
    });
  });

  group('unscrapBySerial - the same invariant, in the other direction', () {
    test('asks canUnscrap once, then makes exactly one mutating call',
        () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..answerWith(SupabaseRpcs.tyreUnscrapAllowed, true)
        ..answerWith(SupabaseRpcs.unscrapTyreBySerial, null);
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      await repository.unscrapBySerial('EP0604207');

      expect(rpc.calls, hasLength(2));
      expect(rpc.calls[0].function, SupabaseRpcs.tyreUnscrapAllowed);
      expect(rpc.calls[1].function, SupabaseRpcs.unscrapTyreBySerial);
      expect(rpc.calls[1].params['p_serial'], 'EP0604207');
    });

    test('never reaches the mutating RPC when canUnscrap answers false',
        () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..answerWith(SupabaseRpcs.tyreUnscrapAllowed, false);
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      await expectLater(
        () => repository.unscrapBySerial('EP0604207'),
        throwsA(
          isA<AppError>().having(
            (AppError e) => e.kind,
            'kind',
            AppErrorKind.authorization,
          ),
        ),
      );
      expect(rpc.wasCalled(SupabaseRpcs.unscrapTyreBySerial), isFalse);
    });

    test('scrap rights and undo rights are asked through DIFFERENT RPCs - '
        'undo never piggybacks on the scrap precondition', () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..answerWith(SupabaseRpcs.tyreScrapAllowed, true)
        ..answerWith(SupabaseRpcs.tyreUnscrapAllowed, false);
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      final bool scrapOk = await repository.canScrap();
      final bool unscrapOk = await repository.canUnscrap();

      expect(scrapOk, isTrue);
      expect(unscrapOk, isFalse);
    });
  });

  group('canScrap / canUnscrap fail closed', () {
    test('canScrap answers false, never throws, when the RPC fails',
        () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..fail(SupabaseRpcs.tyreScrapAllowed, StateError('offline'));
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      expect(await repository.canScrap(), isFalse);
    });

    test('canScrap answers false for anything other than an explicit '
        'boolean true - a truthy-looking string does not count', () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..answerWith(SupabaseRpcs.tyreScrapAllowed, 'true');
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      expect(await repository.canScrap(), isFalse);
    });

    test('canUnscrap answers false, never throws, when the RPC fails',
        () async {
      final _ScriptedRpcCaller rpc = _ScriptedRpcCaller()
        ..fail(SupabaseRpcs.tyreUnscrapAllowed, StateError('offline'));
      final SupabaseTyreLookupRepository repository = _repositoryFor(rpc);

      expect(await repository.canUnscrap(), isFalse);
    });
  });
}
