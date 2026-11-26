/// Driver Charge Notice document model, built from
/// `docs/document-specs/driver-charge-notice.json` and a `driver_charge_detail`
/// payload.
///
/// A line-for-line port of `buildChargeDocument` in
/// `src/lib/driverChargePdf.js`: same sections, same field order, same labels,
/// same value formats. Renderers only lay this model out; they never add,
/// drop or reorder anything. `test/core/documents/charge_document_test.dart`
/// compares the result with a model dumped from the web builder.
library;

import 'package:tyre_pulse/core/documents/document_spec_support.dart';

const List<String> _months = <String>[
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/// One photo of the `photos` section: the private storage reference and the
/// caption. The renderer loads the image; the model never holds bytes.
final class ChargeDocumentPhoto {
  const ChargeDocumentPhoto({required this.ref, required this.caption});
  final String ref;
  final String caption;

  Map<String, Object?> toJson() => <String, Object?>{
        'ref': ref,
        'caption': caption,
      };
}

/// The plain-language box printed in the driver's language.
final class ChargeDriverNotice {
  const ChargeDriverNotice({
    required this.language,
    required this.dir,
    required this.title,
    required this.lines,
  });
  final String language;
  final String dir;
  final String title;
  final List<String> lines;

  bool get rtl => dir == 'rtl';

  Map<String, Object?> toJson() => <String, Object?>{
        'language': language,
        'dir': dir,
        'title': title,
        'lines': lines,
      };
}

/// One section of the notice. [type] is `text`, `fields`, `table` or
/// `photos`.
final class ChargeDocumentSection {
  const ChargeDocumentSection({
    required this.id,
    required this.title,
    required this.type,
    this.text,
    this.rows,
    this.head,
    this.body,
    this.empty,
    this.photos,
    this.imageMissing,
  });

  final String id;
  final String title;
  final String type;
  final String? text;
  final List<List<String>>? rows;
  final List<String>? head;
  final List<List<String>>? body;
  final String? empty;
  final List<ChargeDocumentPhoto>? photos;
  final String? imageMissing;

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'title': title,
        'type': type,
        if (text != null) 'text': text,
        if (rows != null) 'rows': rows,
        if (head != null) 'head': head,
        if (body != null) 'body': body,
        if (head != null) 'empty': empty,
        if (photos != null) ...<String, Object?>{
          'photos': <Map<String, Object?>>[
            for (final ChargeDocumentPhoto p in photos!) p.toJson(),
          ],
          'empty': empty,
          'imageMissing': imageMissing,
        },
      };
}

/// One signature block of the notice.
final class ChargeDocumentSignature {
  const ChargeDocumentSignature({
    required this.heading,
    required this.statement,
    required this.statementVersion,
    required this.image,
    required this.imageMissing,
    required this.rows,
    this.language = 'en',
  });

  final String heading;
  final String statement;
  final String statementVersion;
  final String? image;
  final String imageMissing;
  final List<List<String>> rows;

  /// The language the statement was signed in (`en`, `ar` or `ur`).
  final String language;

  Map<String, Object?> toJson() => <String, Object?>{
        'heading': heading,
        'statement': statement,
        'statementVersion': statementVersion,
        'image': image,
        'language': language,
        'imageMissing': imageMissing,
        'rows': rows,
      };
}

final class ChargeDocumentModel {
  const ChargeDocumentModel({
    required this.title,
    required this.documentNumber,
    required this.language,
    required this.driverNotice,
    required this.headerLines,
    required this.sections,
    required this.signatureTitle,
    required this.signatureEmpty,
    required this.signatures,
    required this.footerLines,
    required this.pageNumber,
    required this.page,
  });

  final String title;
  final String documentNumber;

  /// The driver's language for the notice box.
  final String language;
  final ChargeDriverNotice driverNotice;
  final List<String> headerLines;
  final List<ChargeDocumentSection> sections;
  final String signatureTitle;
  final String signatureEmpty;
  final List<ChargeDocumentSignature> signatures;
  final List<String> footerLines;

  /// `Page {page} of {pages}` template from the spec.
  final String pageNumber;

  /// The spec `page` block (size, orientation, unit, margin).
  final Map<String, Object?> page;

  Map<String, Object?> toJson() => <String, Object?>{
        'title': title,
        'documentNumber': documentNumber,
        'language': language,
        'driverNotice': driverNotice.toJson(),
        'headerLines': headerLines,
        'sections': <Map<String, Object?>>[
          for (final ChargeDocumentSection s in sections) s.toJson(),
        ],
        'signatureTitle': signatureTitle,
        'signatureEmpty': signatureEmpty,
        'signatures': <Map<String, Object?>>[
          for (final ChargeDocumentSignature s in signatures) s.toJson(),
        ],
        'footerLines': footerLines,
        'pageNumber': pageNumber,
      };
}

/// The driver's language for the notice box: the language of his latest
/// signature, else [appLanguage], else English. Mirror of `noticeLanguage`.
String chargeNoticeLanguage(
  Map<String, Object?> spec,
  Map<String, Object?> detail, [
  String appLanguage = 'en',
]) {
  final Map<String, Object?> text = Map<String, Object?>.from(
    (spec['driver_notice']! as Map)['text']! as Map,
  );
  String? signed;
  final Object? rows = detail['signatures'];
  if (rows is List) {
    for (final Object? row in rows) {
      if (row is! Map) continue;
      final Object? kind = row['kind'];
      final Object? lang = row['statement_language'];
      if ((kind == 'driver_acceptance' || kind == 'driver_dispute') &&
          lang is String &&
          text.containsKey(lang)) {
        signed = lang;
      }
    }
  }
  return signed ?? (text.containsKey(appLanguage) ? appLanguage : 'en');
}

/// The plain-language box. Mirror of `buildDriverNotice`.
ChargeDriverNotice buildChargeDriverNotice(
  Map<String, Object?> spec,
  Map<String, Object?> detail,
  String language,
) {
  final Map<String, Object?> all = Map<String, Object?>.from(
    (spec['driver_notice']! as Map)['text']! as Map,
  );
  final Map<String, Object?> text =
      Map<String, Object?>.from((all[language] ?? all['en'])! as Map);
  final String missing = '${(spec['formats']! as Map)['missing']}';
  final Map<String, Object?> c = detail['charge'] is Map
      ? Map<String, Object?>.from(detail['charge']! as Map)
      : <String, Object?>{};
  final double amount = jsNumber(c['amount']);
  final String amountText =
      c['amount'] != null && c['amount'] != '' && amount.isFinite
          ? '${c['currency'] ?? ''} ${jsToFixed(amount, 2)}'.trim()
          : missing;
  final Map<String, Object?> settings = detail['settings'] is Map
      ? Map<String, Object?>.from(detail['settings']! as Map)
      : <String, Object?>{};
  final Object? rule = settings['country_rule'];
  final bool statutory = rule is Map && rule['statutory'] == true;
  final double days = jsNumber(settings['appeal_window_days']);
  final String window = statutory
      ? '${text['window_statutory']}'
      : '${text['window_days']}'
          .replaceFirst('{days}', days.isFinite ? jsString(days) : missing);
  final Object? lastDay = settings['objection_last_day'];
  final String deadline = jsTruthy(lastDay)
      ? (jsString(lastDay).length > 10
          ? jsString(lastDay).substring(0, 10)
          : jsString(lastDay))
      : '${text['deadline_pending']}';
  final List<String> lines = <String>[
    for (final Object? line in text['lines']! as List)
      '$line'
          .replaceFirst('{amount}', amountText)
          .replaceFirst('{window}', window)
          .replaceFirst('{deadline}', deadline),
  ];
  // The Art 91 fault finding goes after the first line, when there is one.
  final Object? faults = text['fault'];
  final Object? finding = c['fault_finding'];
  final Object? label =
      faults is Map && finding is String ? faults[finding] : null;
  if (label is String && text['fault_line'] is String && lines.isNotEmpty) {
    lines.insert(
      1,
      '${text['fault_line']}'.replaceFirst('{fault}', label),
    );
  }
  return ChargeDriverNotice(
    language: language,
    dir: '${text['dir']}',
    title: '${text['title']}',
    lines: lines,
  );
}

/// Builds the notice. Pure. [utcOffset] fixes the printed time zone (the web
/// prints in the browser zone; null here means the device zone).
ChargeDocumentModel buildChargeDocument(
  Map<String, Object?> spec,
  Map<String, Object?> detail, {
  required String generatedAt,
  Duration? utcOffset,
  String language = 'en',
}) {
  if (detail['charge'] is! Map) {
    throw const FormatException('Charge details are unavailable.');
  }
  final _ChargeFormatter f = _ChargeFormatter(spec, utcOffset);
  final Map<String, Object?> numberSpec =
      Map<String, Object?>.from(spec['document_number']! as Map);
  final String documentNumber =
      f.interpolate('${numberSpec['format']}', detail);
  final Map<String, Object?> ctx = <String, Object?>{
    ...detail,
    'document_number': documentNumber,
    'generated_at': generatedAt,
  };

  final List<ChargeDocumentSection> sections = <ChargeDocumentSection>[];
  for (final Object? raw in spec['sections']! as List) {
    final Map<String, Object?> section = Map<String, Object?>.from(raw! as Map);
    final String id = '${section['id']}';
    final String title = '${section['title']}';
    final String type = '${section['type']}';
    final Object? when = section['when'];
    if (when != null && !jsTruthy(specPath(detail, '$when'))) {
      sections.add(
        ChargeDocumentSection(
          id: id,
          title: title,
          type: 'text',
          text: jsTruthy(section['empty']) ? '${section['empty']}' : f.missing,
        ),
      );
      continue;
    }
    if (type == 'text') {
      sections.add(
        ChargeDocumentSection(
          id: id,
          title: title,
          type: type,
          text: f.value(specPath(detail, '${section['key']}'), null),
        ),
      );
      continue;
    }
    if (type == 'photos') {
      final Object? listed = specPath(detail, '${section['rows']}');
      final List<ChargeDocumentPhoto> photos = <ChargeDocumentPhoto>[
        if (listed is List)
          for (final Object? item in listed)
            if (item is Map &&
                item['kind'] == section['kind'] &&
                jsTruthy(item['${section['image_key']}']))
              ChargeDocumentPhoto(
                ref: jsString(item['${section['image_key']}']),
                caption: jsTruthy(item['${section['caption_key']}'])
                    ? jsString(item['${section['caption_key']}'])
                    : f.missing,
              ),
      ];
      sections.add(
        ChargeDocumentSection(
          id: id,
          title: title,
          type: type,
          photos: photos,
          empty: photos.isNotEmpty
              ? null
              : (jsTruthy(section['empty'])
                  ? '${section['empty']}'
                  : f.missing),
          imageMissing: '${section['image_missing']}',
        ),
      );
      continue;
    }
    if (type == 'fields') {
      sections.add(
        ChargeDocumentSection(
          id: id,
          title: title,
          type: type,
          rows: <List<String>>[
            for (final Object? field in section['fields']! as List)
              <String>[
                '${(field! as Map)['label']}',
                f.field(
                  Map<String, Object?>.from(field as Map),
                  detail,
                  detail,
                ),
              ],
          ],
        ),
      );
      continue;
    }
    final Object? listed = specPath(detail, '${section['rows']}');
    final List<Map<String, Object?>> items = listed is List
        ? <Map<String, Object?>>[
            for (final Object? item in listed)
              item is Map
                  ? Map<String, Object?>.from(item)
                  : <String, Object?>{},
          ]
        : <Map<String, Object?>>[];
    final List<Map<String, Object?>> columns = <Map<String, Object?>>[
      for (final Object? c in section['columns']! as List)
        Map<String, Object?>.from(c! as Map),
    ];
    sections.add(
      ChargeDocumentSection(
        id: id,
        title: title,
        type: type,
        head: <String>[for (final c in columns) '${c['label']}'],
        body: <List<String>>[
          for (final Map<String, Object?> item in items)
            <String>[for (final c in columns) f.field(c, item, detail)],
        ],
        empty: items.isNotEmpty
            ? null
            : (jsTruthy(section['empty']) ? '${section['empty']}' : f.missing),
      ),
    );
  }

  final Map<String, Object?> sig =
      Map<String, Object?>.from(spec['signature_blocks']! as Map);
  final Map<String, Object?> block =
      Map<String, Object?>.from(sig['block']! as Map);
  final Object? rawSignatures = detail['signatures'];
  final List<ChargeDocumentSignature> signatures = <ChargeDocumentSignature>[
    if (rawSignatures is List)
      for (final Object? raw in rawSignatures)
        if (raw is Map)
          _signature(f, block, Map<String, Object?>.from(raw), detail),
  ];

  final Map<String, Object?> header =
      Map<String, Object?>.from(spec['header']! as Map);
  final Map<String, Object?> footer =
      Map<String, Object?>.from(spec['footer']! as Map);
  final String noticeLanguage = chargeNoticeLanguage(spec, detail, language);
  return ChargeDocumentModel(
    title: '${spec['title']}',
    documentNumber: documentNumber,
    language: noticeLanguage,
    driverNotice: buildChargeDriverNotice(spec, detail, noticeLanguage),
    headerLines: <String>[
      for (final Object? line in header['lines']! as List)
        f.interpolate('$line', ctx),
    ],
    sections: sections,
    signatureTitle: '${sig['title']}',
    signatureEmpty: '${sig['empty']}',
    signatures: signatures,
    footerLines: <String>[
      for (final Object? line in footer['lines']! as List) '$line',
    ],
    pageNumber: '${footer['page_number']}',
    page: Map<String, Object?>.from(spec['page']! as Map),
  );
}

ChargeDocumentSignature _signature(
  _ChargeFormatter f,
  Map<String, Object?> block,
  Map<String, Object?> s,
  Map<String, Object?> detail,
) {
  final Object? statement = s['${block['statement_key']}'];
  final Object? version = s['${block['statement_version_key']}'];
  final Object? image = s['${block['image_key']}'];
  final Object? language = s['${block['statement_language_key']}'];
  return ChargeDocumentSignature(
    language: jsTruthy(language) ? jsString(language) : 'en',
    heading: f.value(
      s['${block['heading_key']}'],
      block['heading_format'] as String?,
    ),
    statement: jsTruthy(statement) ? jsString(statement) : f.missing,
    statementVersion: jsTruthy(version) ? jsString(version) : f.missing,
    image: jsTruthy(image) ? jsString(image) : null,
    imageMissing: '${block['image_missing']}',
    rows: <List<String>>[
      for (final Object? field in block['fields']! as List)
        <String>[
          '${(field! as Map)['label']}',
          f.field(Map<String, Object?>.from(field as Map), s, detail),
        ],
    ],
  );
}

final class _ChargeFormatter {
  _ChargeFormatter(this.spec, this.utcOffset)
      : missing = '${(spec['formats']! as Map)['missing']}';

  final Map<String, Object?> spec;
  final Duration? utcOffset;
  final String missing;

  static final RegExp _token = RegExp(
    r'\{([a-z_.]+)(?::([a-z_]+)(?::([a-z_]+))?)?\}',
    caseSensitive: false,
  );

  String interpolate(String template, Map<String, Object?> ctx) =>
      template.replaceAllMapped(_token, (Match m) {
        final Object? raw = specPath(ctx, m.group(1));
        final String? fmt = m.group(2);
        if (fmt == 'enum') return value(raw, 'enum:${m.group(3)}');
        if (fmt != null) return value(raw, fmt);
        return raw == null ? missing : jsString(raw);
      });

  String dateTime(Object? raw) {
    final DateTime? instant = parseSpecDate(raw);
    if (instant == null) return missing;
    final (DateTime d, Duration offset) = specWallClock(instant, utcOffset);
    final int minutes = offset.inMinutes;
    final String sign = minutes >= 0 ? '+' : '-';
    final int hours = minutes.abs() ~/ 60;
    final int rest = minutes.abs() % 60;
    final String zone =
        'GMT$sign$hours${rest == 0 ? '' : ':${twoDigits(rest)}'}';
    return '${d.year}-${twoDigits(d.month)}-${twoDigits(d.day)} '
        '${twoDigits(d.hour)}:${twoDigits(d.minute)} $zone';
  }

  String value(Object? raw, String? format) {
    if (raw == null || raw == '') return missing;
    if (format == null) return jsString(raw);
    if (format.startsWith('enum:')) {
      final Object? table = (spec['enums']! as Map)[format.substring(5)];
      final Object? label = table is Map ? table[jsString(raw)] : null;
      return jsTruthy(label) ? '$label' : jsString(raw).replaceAll('_', ' ');
    }
    switch (format) {
      case 'datetime':
        return dateTime(raw);
      case 'date':
        final String s = jsString(raw);
        return s.length > 10 ? s.substring(0, 10) : s;
      case 'month':
        final Match? m = RegExp(r'^(\d{4})-(\d{2})').firstMatch(jsString(raw));
        if (m == null) return jsString(raw);
        final int index = int.parse(m.group(2)!) - 1;
        final String name =
            index >= 0 && index < 12 ? _months[index] : 'undefined';
        return '$name ${m.group(1)}';
      case 'percent':
        return '${jsString(jsNumber(raw))}%';
      case 'boolean':
        return jsTruthy(raw) ? 'Yes' : 'No';
      default:
        return jsString(raw);
    }
  }

  String field(
    Map<String, Object?> field,
    Map<String, Object?> row,
    Map<String, Object?> root,
  ) {
    final Object? raw = specPath(row, field['key'] as String?);
    if (field['format'] == 'money') {
      final double n = jsNumber(raw);
      if (raw == null || raw == '' || !n.isFinite) return missing;
      final String? key = field['currency_key'] as String?;
      final Object currency = specPath(row, key) ?? specPath(root, key) ?? '';
      return '${jsString(currency)} ${jsToFixed(n, 2)}'.trim();
    }
    return value(raw, field['format'] as String?);
  }
}
