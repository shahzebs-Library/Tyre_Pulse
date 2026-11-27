/// Vehicle Handover Authorization document model, built from
/// `docs/document-specs/handover-authorization.json` and one
/// `handover_reports` row.
///
/// A port of the pure half of `src/lib/vehicleHandoverPdf.js`
/// (`documentNumber`, `formatSpecValue`, `handoverPdfRows`,
/// `signatureBlocks`, the header lines and the tiles) and of
/// `rowLocation` / `formatCoords` / `openStreetMapUrl` in
/// `src/lib/handoverAuthorization.js`. Sections come out in spec order, with
/// the spec's labels; the renderer only draws them.
library;

import 'package:tyre_pulse/core/documents/document_spec_support.dart';

const List<String> _gbMonths = <String>[
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
];

/// One damage mark as printed in the damage table.
final class HandoverDocumentMark {
  const HandoverDocumentMark(this.cells);
  final List<String> cells;
}

/// One signature block (title, captured mark, printed name, sub line).
final class HandoverSignatureBlock {
  const HandoverSignatureBlock({
    required this.title,
    required this.signature,
    required this.name,
    required this.sub,
  });

  final String title;
  final String? signature;
  final String? name;
  final String sub;

  Map<String, Object?> toJson() => <String, Object?>{
        'title': title,
        'signature': signature,
        'name': name,
        'sub': sub,
      };
}

/// One section in spec order. Only the members of its [type] are set.
final class HandoverDocumentSection {
  const HandoverDocumentSection({
    required this.key,
    required this.type,
    required this.title,
    this.rows = const <List<String>>[],
    this.note,
    this.blocks = const <HandoverSignatureBlock>[],
    this.lines = const <String>[],
    this.link,
    this.tableHead = const <String>[],
    this.emptyText,
    this.max,
    this.columns,
    this.missingText,
    this.count = 0,
  });

  final String key;
  final String type;
  final String title;

  /// fields / tiles: label and value pairs. damage_views: table rows.
  final List<List<String>> rows;
  final String? note;
  final List<HandoverSignatureBlock> blocks;

  /// location: printed lines.
  final List<String> lines;

  /// location: map link, null when no reading.
  final String? link;
  final List<String> tableHead;
  final String? emptyText;
  final int? max;
  final int? columns;
  final String? missingText;

  /// photos: number of attached photo references.
  final int count;
}

final class HandoverDocumentModel {
  const HandoverDocumentModel({
    required this.title,
    required this.documentNumber,
    required this.headerLines,
    required this.statusWord,
    required this.statusTone,
    required this.sections,
    required this.lockedNote,
    required this.qrTarget,
    required this.qrCaption,
    required this.page,
    required this.fileName,
  });

  final String title;
  final String documentNumber;
  final List<String> headerLines;
  final String statusWord;
  final String statusTone;
  final List<HandoverDocumentSection> sections;
  final String? lockedNote;

  /// `/handovers?view=<id>` path; the renderer prefixes the web origin.
  final String? qrTarget;
  final List<String> qrCaption;
  final Map<String, Object?> page;
  final String fileName;

  HandoverDocumentSection? section(String key) {
    for (final HandoverDocumentSection s in sections) {
      if (s.key == key) return s;
    }
    return null;
  }

  /// The parts the web exposes as pure functions, for the parity fixture.
  Map<String, Object?> toParityJson() {
    final HandoverDocumentSection? details = section('details');
    return <String, Object?>{
      'documentNumber': documentNumber,
      'headerLines': headerLines,
      'statusWord': statusWord,
      'detailRows': <List<String>>[
        for (final List<String> r in details?.rows ?? const <List<String>>[])
          if (r[0] != _statusLabel) r,
      ],
      'tiles': section('condition')?.rows ?? const <List<String>>[],
      'location': section('location')?.lines ?? const <String>[],
      'locationLink': section('location')?.link,
      'driverSignatures': <Map<String, Object?>>[
        for (final HandoverSignatureBlock b
            in section('driver_signatures')?.blocks ??
                const <HandoverSignatureBlock>[])
          b.toJson(),
      ],
      'approval': <Map<String, Object?>>[
        for (final HandoverSignatureBlock b
            in section('approval')?.blocks ?? const <HandoverSignatureBlock>[])
          b.toJson(),
      ],
      'lockedNote': lockedNote,
      'sectionKeys': <String>[for (final s in sections) s.key],
    };
  }
}

const String _statusLabel = 'Sign-off status';

/// The printed document number: the server number, else the legacy
/// `HND-<first 8 hex>` fallback.
String handoverDocumentNumber(Map<String, Object?> row) {
  final Object? number = row['document_no'];
  if (jsTruthy(number)) return jsString(number);
  final String hex = jsString(row['id'] ?? '').replaceAll('-', '');
  final String head =
      (hex.length > 8 ? hex.substring(0, 8) : hex).toUpperCase();
  return 'HND-${head.isEmpty ? 'DRAFT' : head}';
}

/// A finite location on the row, or null.
({double lat, double lng, double? accuracy})? handoverRowLocation(
  Map<String, Object?> row,
) {
  if (row['latitude'] == null || row['longitude'] == null) return null;
  final double lat = jsNumber(row['latitude']);
  final double lng = jsNumber(row['longitude']);
  if (!lat.isFinite || !lng.isFinite) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  final double acc = jsNumber(row['location_accuracy_m']);
  return (
    lat: lat,
    lng: lng,
    accuracy: row['location_accuracy_m'] != null && acc.isFinite ? acc : null,
  );
}

/// `https://www.openstreetmap.org/?mlat=..&mlon=..#map=17/../..`
String handoverMapUrl(double lat, double lng, {int zoom = 17}) {
  final String la = jsToFixed(lat, 6);
  final String lo = jsToFixed(lng, 6);
  return 'https://www.openstreetmap.org/?mlat=$la&mlon=$lo#map=$zoom/$la/$lo';
}

/// Builds the paper. [damageRows] are the printed damage table rows (the
/// caller numbers the marks with its own vocabulary); [photoCount] the number
/// of attached photo references.
HandoverDocumentModel buildHandoverDocument(
  Map<String, Object?> spec,
  Map<String, Object?> row, {
  required String generatedAt,
  int damageMarkCount = 0,
  int photoCount = 0,
  List<List<String>> damageRows = const <List<String>>[],
  Duration? utcOffset,
}) {
  final _HandoverFormatter f = _HandoverFormatter(spec, utcOffset);
  final String number = handoverDocumentNumber(row);
  final Map<String, Object?> ctx = <String, Object?>{
    'document_no': number,
    'generated_at': generatedAt,
    'damage_mark_count': '$damageMarkCount',
    'photo_count': '$photoCount',
  };
  final Map<String, Object?> header =
      Map<String, Object?>.from(spec['header']! as Map);
  final List<String> headerLines = <String>[
    for (final Object? raw in header['right_lines']! as List)
      () {
        final Map<String, Object?> line =
            Map<String, Object?>.from(raw! as Map);
        return '${line['label']}: '
            '${f.value(line['format'] as String?, f.field(row, line, ctx))}';
      }(),
  ];
  final Map<String, Object?> statusWords =
      Map<String, Object?>.from(spec['status_words']! as Map);
  final Object? status =
      statusWords[jsString(row['approval_status'] ?? '').toLowerCase()];
  final String statusWord = status is Map ? '${status['word']}' : 'No sign-off';
  final String statusTone = status is Map ? '${status['tone']}' : 'none';

  final List<HandoverDocumentSection> sections = <HandoverDocumentSection>[];
  for (final Object? raw in spec['sections']! as List) {
    final Map<String, Object?> s = Map<String, Object?>.from(raw! as Map);
    final String key = '${s['key']}';
    final String type = '${s['type']}';
    final String title = '${s['title']}';
    switch (type) {
      case 'fields':
        sections.add(
          HandoverDocumentSection(
            key: key,
            type: type,
            title: title,
            rows: <List<String>>[
              for (final Object? fld in s['fields']! as List)
                () {
                  final Map<String, Object?> field =
                      Map<String, Object?>.from(fld! as Map);
                  return <String>[
                    '${field['label']}',
                    f.value(
                      field['format'] as String?,
                      f.field(row, field, ctx),
                    ),
                  ];
                }(),
            ],
          ),
        );
      case 'tiles':
        sections.add(
          HandoverDocumentSection(
            key: key,
            type: type,
            title: title,
            rows: <List<String>>[
              for (final Object? t in s['tiles']! as List)
                () {
                  final Map<String, Object?> tile =
                      Map<String, Object?>.from(t! as Map);
                  return <String>[
                    '${tile['label']}',
                    f.value(tile['format'] as String?, f.field(row, tile, ctx)),
                  ];
                }(),
            ],
          ),
        );
      case 'damage_views':
        sections.add(
          HandoverDocumentSection(
            key: key,
            type: type,
            title: title,
            rows: damageRows,
            tableHead: <String>[
              for (final Object? c in s['table_columns']! as List) '$c',
            ],
            emptyText: '${s['empty_text']}',
          ),
        );
      case 'photos':
        sections.add(
          HandoverDocumentSection(
            key: key,
            type: type,
            title: title,
            max: (s['max'] as num?)?.toInt(),
            columns: (s['columns'] as num?)?.toInt(),
            missingText: s['missing_text'] as String?,
            count: photoCount,
          ),
        );
      case 'location':
        final Map<String, Object?> statusText =
            Map<String, Object?>.from(s['status_text']! as Map);
        final loc = handoverRowLocation(row);
        final List<String> lines = <String>[];
        String? link;
        if (loc != null) {
          final String coords =
              '${jsToFixed(loc.lat, 5)}, ${jsToFixed(loc.lng, 5)}';
          lines
            ..add(
              '$coords${loc.accuracy != null ? ' (within ${loc.accuracy!.round()} m)' : ''}',
            )
            ..add(
              '${statusText['captured']}'
              '${jsTruthy(row['location_captured_at']) ? ' at ${f.when(row['location_captured_at'])}' : ''}',
            );
          link = handoverMapUrl(loc.lat, loc.lng);
          lines.add(link);
        } else {
          final Object? text = statusText[jsString(row['location_status'])];
          lines.add(jsTruthy(text) ? '$text' : 'No location recorded');
        }
        sections.add(
          HandoverDocumentSection(
            key: key,
            type: type,
            title: title,
            lines: lines,
            link: link,
          ),
        );
      case 'signatures':
        sections.add(
          HandoverDocumentSection(
            key: key,
            type: type,
            title: title,
            note: s['note'] as String?,
            blocks: _signatureBlocks(f, row, s),
          ),
        );
    }
  }

  final Map<String, Object?> footer =
      Map<String, Object?>.from(spec['footer']! as Map);
  final Map<String, Object?> qr =
      Map<String, Object?>.from(footer['qr']! as Map);
  final String id = jsString(row['id'] ?? '');
  return HandoverDocumentModel(
    title: '${spec['title']}',
    documentNumber: number,
    headerLines: headerLines,
    statusWord: statusWord,
    statusTone: statusTone,
    sections: sections,
    lockedNote: jsTruthy(row['frozen_at'])
        ? 'Signed record. Content locked at ${f.when(row['frozen_at'])}.'
        : null,
    qrTarget: id.isEmpty ? null : '/handovers?view=${Uri.encodeComponent(id)}',
    qrCaption: <String>[for (final Object? c in qr['caption']! as List) '$c'],
    page: Map<String, Object?>.from(spec['page']! as Map),
    fileName: '${spec['file_name']}',
  );
}

List<HandoverSignatureBlock> _signatureBlocks(
  _HandoverFormatter f,
  Map<String, Object?> row,
  Map<String, Object?> section,
) {
  final bool legacy = section['legacy_block'] != null &&
      !jsTruthy(row['from_signature']) &&
      !jsTruthy(row['to_signature']) &&
      jsTruthy(row['signature_url']);
  final List<Object?> blocks = legacy
      ? <Object?>[section['legacy_block']]
      : section['blocks']! as List<Object?>;
  return <HandoverSignatureBlock>[
    for (final Object? raw in blocks)
      () {
        final Map<String, Object?> b = Map<String, Object?>.from(raw! as Map);
        final Object? signature = row['${b['signature']}'];
        final Object? at = b['at'] != null ? row['${b['at']}'] : null;
        final Object? named = b['name'] != null ? row['${b['name']}'] : null;
        final Object? fallback =
            b['name_fallback'] != null ? row['${b['name_fallback']}'] : null;
        final String? name = !f.blank(named) && jsTruthy(named)
            ? jsString(named)
            : (jsTruthy(fallback) ? jsString(fallback) : null);
        String sub = jsTruthy(at)
            ? '${b['at_label'] ?? 'Signed'}: ${f.when(at)}'
            : (jsTruthy(signature)
                ? 'Signed'
                : '${b['pending_text'] ?? 'Not signed'}');
        // An on-behalf signature says so on the paper, not only in the data.
        if (jsTruthy(signature) &&
            b['behalf'] != null &&
            row['${b['behalf']}'] == true) {
          sub =
              '$sub, ${jsTruthy(b['behalf_text']) ? b['behalf_text'] : 'signed on behalf'}';
        }
        return HandoverSignatureBlock(
          title: '${b['title']}',
          signature: jsTruthy(signature) ? jsString(signature) : null,
          name: name,
          sub: sub,
        );
      }(),
  ];
}

final class _HandoverFormatter {
  _HandoverFormatter(this.spec, this.utcOffset);

  final Map<String, Object?> spec;
  final Duration? utcOffset;

  bool blank(Object? v) => v == null || (v is String && v.trim().isEmpty);

  Object? field(
    Map<String, Object?> row,
    Map<String, Object?> field,
    Map<String, Object?> ctx,
  ) {
    if (field['source'] != null) return ctx['${field['source']}'];
    final Object? v = row['${field['column']}'];
    if (blank(v) && field['fallback_column'] != null) {
      return row['${field['fallback_column']}'];
    }
    return v;
  }

  /// en-GB medium date and short time: `5 Jan 2026, 14:20`.
  String when(Object? v) {
    final DateTime? instant = jsTruthy(v) ? parseSpecDate(v) : null;
    if (instant == null) return 'N/A';
    final (DateTime d, _) = specWallClock(instant, utcOffset);
    return '${d.day} ${_gbMonths[d.month - 1]} ${d.year}, '
        '${twoDigits(d.hour)}:${twoDigits(d.minute)}';
  }

  /// `YYYY-MM-DD` in local time; a bare date is local midnight.
  String date(Object? v) {
    final String s = jsString(v);
    final DateTime? instant =
        s.length == 10 ? DateTime.tryParse('${s}T00:00:00') : parseSpecDate(v);
    if (instant == null) return s.length > 10 ? s.substring(0, 10) : s;
    final DateTime d =
        s.length == 10 ? instant : specWallClock(instant, utcOffset).$1;
    return '${d.year}-${twoDigits(d.month)}-${twoDigits(d.day)}';
  }

  String value(String? format, Object? v) {
    if (blank(v)) return 'N/A';
    switch (format) {
      case 'date':
        return date(v);
      case 'datetime':
        return when(v);
      case 'km':
        final double n = jsNumber(v);
        return n.isFinite ? '${enUsNumber(n)} km' : 'N/A';
      case 'hours':
        final double n = jsNumber(v);
        return n.isFinite ? '${enUsNumber(n)} h' : 'N/A';
      case 'percent':
        final double n = jsNumber(v);
        return n.isFinite ? '${jsString(n)}%' : 'N/A';
      case 'capitalize':
        final String s = jsString(v);
        return s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1)}';
      case 'handover_type':
        final Object? label =
            ((spec['formats']! as Map)['handover_type'] as Map)[jsString(v)];
        return jsTruthy(label) ? '$label' : 'N/A';
      case 'status_pill':
        final Object? meta =
            (spec['status_words']! as Map)[jsString(v).toLowerCase()];
        return meta is Map ? '${meta['word']}' : 'No sign-off';
      default:
        return jsString(v);
    }
  }
}
