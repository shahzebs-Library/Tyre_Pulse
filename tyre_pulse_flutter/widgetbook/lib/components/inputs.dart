import 'package:flutter/material.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:widgetbook/widgetbook.dart';
import 'package:widgetbook_annotation/widgetbook_annotation.dart' as widgetbook;
import 'package:widgetbook_workspace/components/catalogue_support.dart';

@widgetbook.UseCase(name: 'States', type: TpInput, path: CataloguePath.inputs)
Widget inputStates(BuildContext context) {
  final String label = labelKnob(context, 'Odometer (km)');
  return CatalogueFrame(
    children: <Widget>[
      Labelled('Default', TpInput(label: label, hint: 'e.g. 104 010')),
      Labelled(
        'Required with helper and icon',
        TpInput(
          label: label,
          isRequired: true,
          helperText: 'Read it from the dashboard',
          prefixIcon: Icons.speed,
          keyboardType: TextInputType.number,
        ),
      ),
      Labelled(
        'Error',
        TpInput(
          label: label,
          isRequired: true,
          controller: TextEditingController(text: '99'),
          errorText: 'Lower than the last reading (104 010 km)',
        ),
      ),
      Labelled(
        'Disabled',
        TpInput(
          label: label,
          enabled: false,
          controller: TextEditingController(text: '104 010'),
        ),
      ),
      Labelled(
        'Multiline with counter',
        TpInput(label: 'Notes', maxLines: 4, maxLength: 500),
      ),
      Labelled('Password', TpInput(label: 'Password', obscureText: true)),
    ],
  );
}

@widgetbook.UseCase(name: 'States', type: TpSearchField, path: CataloguePath.inputs)
Widget searchStates(BuildContext context) {
  final String hint = labelKnob(context, 'Search asset or serial');
  return CatalogueFrame(
    children: <Widget>[
      Labelled('Empty', TpSearchField(hint: hint)),
      Labelled(
        'With a query (clear button)',
        TpSearchField(hint: hint, controller: TextEditingController(text: 'TM-1042')),
      ),
      Labelled('Disabled', TpSearchField(hint: hint, enabled: false)),
    ],
  );
}

@widgetbook.UseCase(name: 'States', type: TpDropdown, path: CataloguePath.inputs)
Widget dropdownStates(BuildContext context) {
  final String label = labelKnob(context, 'Site');
  const List<TpDropdownItem<String>> sites = <TpDropdownItem<String>>[
    TpDropdownItem<String>(value: 'NHC', label: 'NHC Riyadh', icon: Icons.place_outlined),
    TpDropdownItem<String>(value: 'JED', label: 'Jeddah', icon: Icons.place_outlined),
    TpDropdownItem<String>(value: 'DMM', label: 'Dammam', icon: Icons.place_outlined),
  ];
  return CatalogueFrame(
    children: <Widget>[
      Labelled(
        'Nothing chosen',
        TpDropdown<String>(
          label: label,
          value: null,
          items: sites,
          hint: 'Choose a site',
          onChanged: (_) {},
        ),
      ),
      Labelled(
        'Chosen, required',
        TpDropdown<String>(
          label: label,
          value: 'JED',
          items: sites,
          isRequired: true,
          onChanged: (_) {},
        ),
      ),
      Labelled(
        'Error',
        TpDropdown<String>(
          label: label,
          value: null,
          items: sites,
          isRequired: true,
          errorText: 'Choose where the work happened',
          onChanged: (_) {},
        ),
      ),
      Labelled(
        'Disabled',
        TpDropdown<String>(
          label: label,
          value: 'NHC',
          items: sites,
          enabled: false,
          onChanged: (_) {},
        ),
      ),
    ],
  );
}

class _SegmentedDemo extends StatefulWidget {
  const _SegmentedDemo({required this.expanded, required this.enabled, required this.longLabel});

  final bool expanded;
  final bool enabled;
  final String longLabel;

  @override
  State<_SegmentedDemo> createState() => _SegmentedDemoState();
}

class _SegmentedDemoState extends State<_SegmentedDemo> {
  String _value = 'today';

  @override
  Widget build(BuildContext context) {
    return TpSegmented<String>(
      expanded: widget.expanded,
      value: _value,
      onChanged: widget.enabled ? (String v) => setState(() => _value = v) : null,
      options: <TpSegmentedOption<String>>[
        const TpSegmentedOption<String>(value: 'today', label: 'Today', icon: Icons.today),
        const TpSegmentedOption<String>(value: 'week', label: 'Week'),
        TpSegmentedOption<String>(value: 'all', label: widget.longLabel),
      ],
    );
  }
}

@widgetbook.UseCase(name: 'Interactive', type: TpSegmented, path: CataloguePath.inputs)
Widget segmented(BuildContext context) {
  final bool expanded = context.knobs.boolean(label: 'Expanded', initialValue: true);
  final bool enabled = context.knobs.boolean(label: 'Enabled', initialValue: true);
  final String last = labelKnob(context, 'All time');
  return CatalogueFrame(
    children: <Widget>[
      _SegmentedDemo(expanded: expanded, enabled: enabled, longLabel: last),
    ],
  );
}
