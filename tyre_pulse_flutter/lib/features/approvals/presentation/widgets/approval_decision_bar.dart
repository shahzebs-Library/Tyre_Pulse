/// The one decision row both approval review screens end with.
///
/// Return for correction is an OUTLINED critical button and Approve is the
/// single primary. Two saturated buttons side by side compete for the eye;
/// the approver's main action must be the only filled one. Both the
/// inspection and the checklist review render this widget so the two pages
/// can never drift apart again.
///
/// The widget carries no decision logic: each screen still decides when a
/// button is enabled, busy or blocked, and passes the callbacks in.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

class ApprovalDecisionBar extends StatelessWidget {
  const ApprovalDecisionBar({
    required this.returnLabel,
    required this.approveLabel,
    required this.onReturn,
    required this.onApprove,
    this.returnKey,
    this.approveKey,
    this.returnIcon = Icons.undo_rounded,
    this.approveIcon = Icons.check_circle_outline,
    this.isReturning = false,
    this.isApproving = false,
    super.key,
  });

  final String returnLabel;
  final String approveLabel;

  /// Null disables the button (for example while a decision is in flight).
  final VoidCallback? onReturn;
  final VoidCallback? onApprove;

  /// Test keys placed on the actual tappable buttons.
  final Key? returnKey;
  final Key? approveKey;

  final IconData returnIcon;
  final IconData approveIcon;

  /// Shows a spinner in place of the matching icon.
  final bool isReturning;
  final bool isApproving;

  /// The primary control height ([TpButton] uses the same 52).
  static const double buttonHeight = 52;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final Color critical = palette.critical.base;
    return Row(
      children: <Widget>[
        Expanded(
          child: SizedBox(
            height: buttonHeight,
            child: OutlinedButton.icon(
              key: returnKey,
              onPressed: onReturn,
              style: OutlinedButton.styleFrom(
                foregroundColor: critical,
                side: BorderSide(
                  color: onReturn == null ? palette.border : critical,
                  width: 1.5,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
              ),
              icon: isReturning
                  ? SizedBox(
                      width: TpSizing.iconSm,
                      height: TpSizing.iconSm,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: critical,
                      ),
                    )
                  : Icon(returnIcon),
              label: Text(
                returnLabel,
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ),
        const SizedBox(width: TpSpace.md),
        Expanded(
          child: TpButton.primary(
            key: approveKey,
            label: approveLabel,
            icon: approveIcon,
            isBusy: isApproving,
            onPressed: onApprove,
          ),
        ),
      ],
    );
  }
}
