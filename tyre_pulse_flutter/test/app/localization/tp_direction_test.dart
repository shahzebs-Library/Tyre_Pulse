/// Tests for [TpDirection] and [TpIdentifierText].
///
/// Spec section 52 and repository rule 10: a tyre position such as `FL`,
/// `RR2`, `LHF1` or `RHCO`, or an asset number such as `TM514`, is a
/// TECHNICAL IDENTIFIER, not prose. Dropped into an Arabic or Urdu sentence
/// with no isolate, the bidirectional algorithm can reorder it - `RR2`
/// reading as `2RR` names a different wheel, not a cosmetic glitch. See the
/// doc comment on `tp_direction.dart` for the full reasoning.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

/// U+2066 LEFT-TO-RIGHT ISOLATE, matching the private constant
/// `TpDirection.isolateLtr` wraps a value with. Built from the numeric code
/// point rather than pasted as a character, for the same reason
/// `tp_direction.dart` writes its own copy as an escape: an invisible
/// character sitting in source is impossible to review and easy to delete
/// by accident.
final String _lri = String.fromCharCode(0x2066);

/// U+2069 POP DIRECTIONAL ISOLATE.
final String _pdi = String.fromCharCode(0x2069);

/// A representative set of real tyre position and asset identifiers.
const List<String> _kIdentifiers = <String>[
  'FL',
  'RR2',
  'LHF1',
  'RHCO',
  'TM514',
];

void main() {
  group('isolateLtr', () {
    test('an empty string is returned unchanged', () {
      expect(TpDirection.isolateLtr(''), '');
    });

    test('wraps a non-empty value in exactly the isolate marks', () {
      expect(TpDirection.isolateLtr('TM514'), '${_lri}TM514$_pdi');
    });

    test('never returns the input unchanged for a non-empty value', () {
      const String value = 'LHF1';
      expect(TpDirection.isolateLtr(value), isNot(value));
    });
  });

  group('stripIsolates', () {
    test('removes both marks added by isolateLtr', () {
      const String value = 'RHCO';
      expect(TpDirection.stripIsolates(TpDirection.isolateLtr(value)), value);
    });

    test('is a no-op on a string that carries no isolate marks', () {
      expect(TpDirection.stripIsolates('TM514'), 'TM514');
    });

    test('removes marks wherever they occur, not only at the edges', () {
      // replaceAll is global: two isolated runs concatenated collapse to
      // one plain string once both pairs of marks are stripped.
      expect(TpDirection.stripIsolates('${_lri}AB$_pdi${_lri}CD$_pdi'), 'ABCD');
    });
  });

  group('round-tripping real tyre and asset identifiers', () {
    for (final String id in _kIdentifiers) {
      test('"$id" survives isolateLtr then stripIsolates unchanged', () {
        expect(TpDirection.stripIsolates(TpDirection.isolateLtr(id)), id);
      });
    }

    test('the isolated form is never mistaken for the raw identifier', () {
      // Repository rule 10: never change a tyre position id. Storing the
      // isolated form in place of the plain identifier would corrupt it,
      // so the two forms must be provably distinct until stripped again.
      for (final String id in _kIdentifiers) {
        expect(TpDirection.isolateLtr(id), isNot(id));
      }
    });
  });

  group('TpDirection.isRtl(BuildContext)', () {
    testWidgets('matches TpLocalizations.isRtl for every supported locale', (
      WidgetTester tester,
    ) async {
      for (final Locale locale in TpLocalizations.supportedLocales) {
        late bool rtl;
        await tester.pumpWidget(
          MaterialApp(
            locale: locale,
            supportedLocales: TpLocalizations.supportedLocales,
            localizationsDelegates: TpLocalizations.delegates,
            home: Builder(
              builder: (BuildContext context) {
                rtl = TpDirection.isRtl(context);
                return const SizedBox.shrink();
              },
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(
          rtl,
          TpLocalizations.isRtl(locale),
          reason: 'locale ${locale.languageCode}',
        );
      }
    });
  });

  group('TpIdentifierText', () {
    testWidgets(
      'renders left to right regardless of an RTL ambient direction',
      (WidgetTester tester) async {
        await tester.pumpWidget(
          const MaterialApp(
            home: Directionality(
              textDirection: TextDirection.rtl,
              child: TpIdentifierText('TM514'),
            ),
          ),
        );

        final Finder ownDirectionality = find.descendant(
          of: find.byType(TpIdentifierText),
          matching: find.byType(Directionality),
        );
        expect(ownDirectionality, findsOneWidget);
        expect(
          tester.widget<Directionality>(ownDirectionality).textDirection,
          TextDirection.ltr,
        );
        expect(find.text(TpDirection.isolateLtr('TM514')), findsOneWidget);
      },
    );

    testWidgets('passes style, maxLines and overflow through to Text', (
      WidgetTester tester,
    ) async {
      const TextStyle style = TextStyle(fontSize: 21);
      await tester.pumpWidget(
        const MaterialApp(
          home: TpIdentifierText(
            'RHCO',
            style: style,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      );

      final Text text = tester.widget<Text>(
        find.descendant(
          of: find.byType(TpIdentifierText),
          matching: find.byType(Text),
        ),
      );
      expect(text.style, style);
      expect(text.maxLines, 2);
      expect(text.overflow, TextOverflow.ellipsis);
    });

    testWidgets('does not throw for an empty identifier', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(const MaterialApp(home: TpIdentifierText('')));

      expect(tester.takeException(), isNull);
      expect(find.text(''), findsOneWidget);
    });
  });
}
