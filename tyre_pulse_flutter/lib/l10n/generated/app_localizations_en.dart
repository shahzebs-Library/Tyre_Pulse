// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Tyre Pulse';

  @override
  String get actionBack => 'Back';

  @override
  String get actionRetry => 'Try again';

  @override
  String get actionClose => 'Close';

  @override
  String get actionCancel => 'Cancel';

  @override
  String get actionSignIn => 'Sign in';

  @override
  String get actionSignOut => 'Sign out';

  @override
  String get actionOpenStore => 'Open the store';

  @override
  String get actionClear => 'Clear';

  @override
  String get valueUnavailable => 'Unavailable';

  @override
  String get valueNotMeasured => '-';

  @override
  String get stateLoading => 'Loading';

  @override
  String get stateEmptyTitle => 'Nothing here yet';

  @override
  String get stateEmptyMessage =>
      'When there is something to show, it will appear here.';

  @override
  String get stateErrorTitle => 'Something went wrong';

  @override
  String get stateErrorMessage =>
      'The last action did not finish. Nothing was changed.';

  @override
  String get stateOfflineCachedTitle => 'Showing saved data';

  @override
  String get stateOfflineCachedMessage =>
      'You are offline. This is the copy saved on this device, so it may be out of date.';

  @override
  String stateOfflineCachedAt(String timestamp) {
    return 'Saved $timestamp';
  }

  @override
  String get stateBackendUnavailableTitle => 'The server is not responding';

  @override
  String get stateBackendUnavailableMessage =>
      'Your work is safe on this device. It will be sent when the connection comes back.';

  @override
  String get stateNotConfiguredTitle => 'Not set up';

  @override
  String get stateNotConfiguredMessage =>
      'This part of the app has not been set up for your organisation. Your administrator can turn it on.';

  @override
  String get stateScreenNotAvailableTitle => 'This screen is not built yet';

  @override
  String get stateScreenNotAvailableMessage =>
      'The navigation to it works, but the screen itself has not been written. This is a build in progress, not a fault with your account.';

  @override
  String get deniedTitle => 'No access to this screen';

  @override
  String get deniedNotGranted =>
      'You do not have access to this module. Contact your administrator.';

  @override
  String get deniedAdminOnly => 'This screen is for administrators only.';

  @override
  String get deniedSuperAdminOnly =>
      'This screen is for the platform owner only.';

  @override
  String get deniedPermissionsUnavailable =>
      'Your permissions could not be read, so this screen is closed until they can be. Everything else still works.';

  @override
  String get offlineTitle => 'Offline';

  @override
  String get offlineMessage =>
      'You can keep working. Everything is saved on this device.';

  @override
  String syncPendingChanges(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count changes waiting to sync',
      one: '1 change waiting to sync',
      zero: 'No changes waiting',
    );
    return '$_temp0';
  }

  @override
  String syncInProgress(int completed, int total) {
    return 'Syncing $completed of $total';
  }

  @override
  String get syncAllSynced => 'All changes synced';

  @override
  String syncNeedsAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count items need attention',
      one: '1 item needs attention',
      zero: 'Nothing needs attention',
    );
    return '$_temp0';
  }

  @override
  String get syncStatusUnknown => 'Connection status unknown';

  @override
  String get sessionRestoringTitle => 'Opening Tyre Pulse';

  @override
  String get sessionTimedOutTitle => 'This is taking longer than usual';

  @override
  String get sessionTimedOutMessage =>
      'We could not open your saved sign in. You can try again, or sign in from the start.';

  @override
  String get updateRequiredTitle => 'Update required';

  @override
  String get updateRequiredMessage =>
      'This version of Tyre Pulse is too old to keep using. Install the update to carry on.';

  @override
  String get profileUnavailableTitle => 'We could not load your profile';

  @override
  String get profileUnavailableMessage =>
      'Your account details did not load, so the app cannot tell what you are allowed to do. Try again, or sign out and back in.';

  @override
  String get accessBlockedTitle => 'Your account is not active';

  @override
  String get accessBlockedMessage =>
      'Your account is waiting for approval or has been locked. Your administrator can put this right.';

  @override
  String get routeNotFoundTitle => 'That screen does not exist';

  @override
  String get routeNotFoundMessage =>
      'The link you followed does not point anywhere in this app.';

  @override
  String get tabHome => 'Home';

  @override
  String get tabInspect => 'Inspect';

  @override
  String get tabAccidents => 'Accidents';

  @override
  String get tabMeter => 'Meter';

  @override
  String get tabWashing => 'Washing';

  @override
  String get tabProfile => 'Profile';

  @override
  String get tabHistory => 'History';

  @override
  String get tabChecklists => 'Checklists';

  @override
  String get tabApprovals => 'Approvals';

  @override
  String get searchHint => 'Search';

  @override
  String get dropdownHint => 'Select';

  @override
  String get fieldRequired => 'Required';

  @override
  String get statusOk => 'OK';

  @override
  String get statusWarning => 'Attention';

  @override
  String get statusCritical => 'Critical';

  @override
  String get statusInfo => 'Info';

  @override
  String get statusNeutral => 'Neutral';

  @override
  String get statusUnknown => 'Not measured';

  @override
  String get vehiclesTitle => 'Vehicles';

  @override
  String vehiclesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count vehicles in fleet',
      one: '1 vehicle in fleet',
      zero: 'No vehicles in fleet',
    );
    return '$_temp0';
  }

  @override
  String get vehiclesSearchHint => 'Search asset, make, type or site';

  @override
  String get vehiclesTyreAssetsFilter => 'Tyre assets';

  @override
  String get vehiclesAllFilter => 'All';

  @override
  String get vehiclesEmptyTitle => 'No vehicles found';

  @override
  String get vehiclesEmptySearchMessage => 'Try a different search term.';

  @override
  String get vehiclesDetailSubtitle => 'Vehicle details';

  @override
  String get vehiclesUnknownAsset => 'Unknown vehicle';

  @override
  String get vehiclesFieldFleetNo => 'Fleet number';

  @override
  String get vehiclesFieldType => 'Type';

  @override
  String get vehiclesFieldMakeModel => 'Make and model';

  @override
  String get vehiclesFieldYear => 'Year';

  @override
  String get vehiclesFieldCurrentKm => 'Current odometer';

  @override
  String get vehiclesFieldOperator => 'Operator';

  @override
  String get vehiclesFieldDepartment => 'Department';

  @override
  String get vehiclesFieldSite => 'Site';

  @override
  String get vehiclesFieldRegion => 'Region';

  @override
  String get vehiclesFieldCountry => 'Country';

  @override
  String get vehiclesFieldTyreSize => 'Tyre size';

  @override
  String get vehiclesFieldRegistration => 'Registration';

  @override
  String get vehiclesStartInspection => 'Start inspection';

  @override
  String get vehiclesNotFoundTitle => 'Vehicle not found';

  @override
  String get vehiclesNotFoundMessage =>
      'This vehicle could not be found in the fleet register. It may have been removed or reassigned to another country.';

  @override
  String get vehiclesTruncatedNotice =>
      'Showing part of the fleet. Narrow your search to find a specific vehicle.';

  @override
  String get serialSearchTitle => 'Serial Number Search';

  @override
  String get serialSearchSubtitle => 'Find a tyre by its serial number';

  @override
  String get serialSearchLabel => 'Tyre serial number';

  @override
  String get serialSearchPlaceholder => 'Type or paste a serial number';

  @override
  String get serialSearchHelp =>
      'Scanned labels, links and QR text are unwrapped automatically.';

  @override
  String get serialSearchSearching => 'Searching for tyre...';

  @override
  String get serialSearchFound => 'Tyre found';

  @override
  String get serialSearchBrand => 'Brand';

  @override
  String get serialSearchSize => 'Size';

  @override
  String get serialSearchPosition => 'Position';

  @override
  String get serialSearchAsset => 'Asset';

  @override
  String get serialSearchSite => 'Site';

  @override
  String get serialSearchLastReading => 'Last reading';

  @override
  String get serialSearchInspectThis => 'Inspect this tyre';

  @override
  String get serialSearchNoAssetNote =>
      'This tyre is not fitted to an asset, so an inspection cannot be started from here.';

  @override
  String get serialSearchEmptyTitle => 'No tyre found for that serial';

  @override
  String get serialSearchEmptyMessage =>
      'Check the serial number and try again. It may belong to another site, or it may not be recorded yet.';

  @override
  String get serialSearchIdleTitle => 'Search a tyre serial number';

  @override
  String get serialSearchIdleMessage =>
      'Enter a serial number above to see the tyre\'s brand, size, fitted position and last reading.';

  @override
  String get serialSearchScrappedBadge => 'Scrapped';

  @override
  String get serialSearchScrapReasonLabel => 'Reason';

  @override
  String get serialSearchScrapReasonPlaceholder =>
      'Why is this tyre being scrapped?';

  @override
  String get serialSearchMarkScrap => 'Mark as scrap';

  @override
  String get serialSearchUndoScrap => 'Undo scrap';

  @override
  String get serialSearchScrapModalTitle => 'Scrap this tyre';

  @override
  String get serialSearchConfirmScrap => 'Confirm scrap';

  @override
  String get serialSearchUndoConfirmTitle => 'Undo this scrap?';

  @override
  String get serialSearchUndoConfirmMessage =>
      'This tyre will be marked active again.';

  @override
  String get scannerTitle => 'Scan';

  @override
  String get scannerCameraUnavailableTitle =>
      'Camera scanning is not available in this build';

  @override
  String get scannerCameraUnavailableMessage =>
      'Type or paste the code from the label instead. Everything below works the same as a scan.';

  @override
  String get scannerCameraPermissionDeniedReason =>
      'Camera access was declined. Type or paste the code from the label instead.';

  @override
  String get scannerManualEntryLabel => 'Enter a code';

  @override
  String get scannerCodeFieldLabel => 'Asset or tyre code';

  @override
  String get scannerCodeFieldHint => 'e.g. TM514 or a tyre serial';

  @override
  String get scannerLookUpAction => 'Look up';

  @override
  String get scannerNoMatchTitle => 'No match for that code';

  @override
  String get scannerNoMatchMessage =>
      'Check the code and try again, or open Serial Search to look further.';

  @override
  String get scannerOpenSerialSearchAction => 'Open Serial Search';

  @override
  String get scannerScanAnotherAction => 'Look up another';

  @override
  String get scannerViewAssetAction => 'View asset';

  @override
  String get scannerStartInspectionAction => 'Start inspection';

  @override
  String get scannerViewTyreAction => 'View tyre';

  @override
  String get recordsTitle => 'Tyre Records';

  @override
  String recordsShownCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count tyre records shown',
      one: '1 tyre record shown',
      zero: 'No tyre records',
    );
    return '$_temp0';
  }

  @override
  String get recordsSearchHint => 'Search asset, serial or brand';

  @override
  String get recordsEmptyTitle => 'No records found';

  @override
  String get recordsEmptyMessage =>
      'Try a different search or clear your filters.';

  @override
  String get recordsLoadMoreError => 'Could not load more records.';

  @override
  String get recordsEndOfList => 'You have reached the end of the list.';

  @override
  String get recordsFilterTitle => 'Filter records';

  @override
  String get recordsRiskLevel => 'Risk level';

  @override
  String get recordsSite => 'Site';

  @override
  String get recordsApplyFilters => 'Apply filters';

  @override
  String get recordsClearFilters => 'Clear filters';

  @override
  String recordsActiveFilters(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count active filters',
      one: '1 active filter',
      zero: 'No active filters',
    );
    return '$_temp0';
  }

  @override
  String get recordsSerialNo => 'Serial number';

  @override
  String get recordsIssueDate => 'Issue date';

  @override
  String get recordsCategory => 'Category';

  @override
  String get recordsCostPerTyre => 'Cost per tyre';

  @override
  String get recordsKmFitment => 'Km at fitment';

  @override
  String get recordsKmRemoval => 'Km at removal';

  @override
  String get recordsTyreLife => 'Tyre life (km)';

  @override
  String get recordsCountry => 'Country';

  @override
  String get recordsDescription => 'Description';

  @override
  String get recordsRemarks => 'Remarks';

  @override
  String get recordsDetailFallbackTitle => 'Tyre record';

  @override
  String get tyreDiagramFrontLabel => 'FRONT';

  @override
  String get tyreDiagramTapHint => 'Tap a tyre to record its condition';

  @override
  String tyreDiagramTyreCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count tyres',
      one: '1 tyre',
      zero: 'No tyres',
    );
    return '$_temp0';
  }

  @override
  String tyreDiagramPendingLeadIn(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count tyres still need details',
      one: '1 tyre still needs details',
    );
    return '$_temp0';
  }

  @override
  String get tyreDiagramTyrelessMessage =>
      'Stationary equipment, no tyres to inspect.';

  @override
  String get tyreDiagramEmptyMessage => 'No tyre positions to display.';

  @override
  String tyreDiagramPressureDetail(String value) {
    return 'pressure $value psi';
  }

  @override
  String get tyreConditionGood => 'Good';

  @override
  String get tyreConditionWorn => 'Worn';

  @override
  String get tyreConditionDamaged => 'Damaged';

  @override
  String get tyreConditionPuncture => 'Puncture';

  @override
  String get tyreConditionFlat => 'Flat';

  @override
  String get tyreConditionMissing => 'Missing';

  @override
  String get inspectionNavTitle => 'New inspection';

  @override
  String get inspectionStep1Label => '1';

  @override
  String get inspectionStep2Label => '2';

  @override
  String get inspectionStep3Label => '3';

  @override
  String get inspectionResumeTitle => 'Continue unfinished work';

  @override
  String inspectionResumeProgress(int filled, int total) {
    return '$filled of $total tyres recorded';
  }

  @override
  String get inspectionChangeVehicleButton => 'Change';

  @override
  String get inspectionSiteLabel => 'Site';

  @override
  String get inspectionTypeSiteName => 'Type the site name';

  @override
  String get inspectionOdometerLabel => 'Odometer (km)';

  @override
  String get inspectionOdometerHint => 'Optional';

  @override
  String get inspectionHourMeterLabel => 'Hour meter';

  @override
  String get inspectionHourMeterHint => 'Optional';

  @override
  String get inspectionNextButton => 'Next: tyre positions';

  @override
  String get inspectionVehicleSearchPlaceholder =>
      'Search by asset number or type';

  @override
  String get inspectionSearchToBeginHint => 'Start typing to search the fleet.';

  @override
  String get inspectionVehicleNoMatch => 'No vehicle matches that search.';

  @override
  String get inspectionEnterAssetManually => 'Enter an asset number manually';

  @override
  String get inspectionManualAssetLabel => 'Asset number';

  @override
  String get inspectionManualUseButton => 'Use this asset';

  @override
  String get inspectionTyrePositionsTitle => 'Tyre positions';

  @override
  String get inspectionNotRecordedYet => 'Not recorded yet';

  @override
  String get inspectionValidationRecordTyre =>
      'Record at least one tyre before continuing.';

  @override
  String inspectionTyresIncompleteLead(int count, int total) {
    return '$count of $total tyres still need details before you can continue.';
  }

  @override
  String get inspectionReviewButton => 'Review and sign';

  @override
  String get inspectionGpsCaptured => 'Location captured';

  @override
  String get inspectionGpsCapturing => 'Getting location...';

  @override
  String get inspectionGpsUnavailable => 'Location not available';

  @override
  String get inspectionGpsRetry => 'Retry';

  @override
  String get inspectionReviewTitle => 'Review';

  @override
  String inspectionPositionsRecorded(int touched, int total) {
    return '$touched of $total tyre positions recorded';
  }

  @override
  String get inspectionObservationsLabel => 'Observations';

  @override
  String get inspectionObservationsPlaceholder =>
      'Anything else worth noting about this inspection';

  @override
  String get inspectionInspectorSignatureLabel => 'Inspector signature';

  @override
  String get inspectionSubmitForApproval => 'Submit for approval';

  @override
  String get inspectionSignatureRequiredMsg =>
      'A signature is required before this inspection can be submitted.';

  @override
  String get inspectionSubmittedForApprovalTitle => 'Submitted for approval';

  @override
  String get inspectionQueuedTitle => 'Saved on this device';

  @override
  String get inspectionQueuedWithWarningTitle =>
      'Saved, but the server did not accept it yet';

  @override
  String get inspectionBackHome => 'Back to Home';

  @override
  String get inspectionNewInspection => 'New inspection';

  @override
  String get inspectionConditionLabel => 'Condition';

  @override
  String get inspectionPressureLabel => 'Pressure (psi)';

  @override
  String get inspectionPressureHint => 'e.g. 110';

  @override
  String get inspectionTreadLabel => 'Tread depth (mm)';

  @override
  String get inspectionTreadHint => 'e.g. 8.5';

  @override
  String get inspectionSerialLabel => 'Tyre serial number';

  @override
  String get inspectionPhotoLabel => 'Photo';

  @override
  String get inspectionPhotoNone => 'No photo taken';

  @override
  String get inspectionPhotoCamera => 'Camera';

  @override
  String get inspectionPhotoGallery => 'Gallery';

  @override
  String get inspectionNotesLabel => 'Notes';

  @override
  String get inspectionSignatureSavedLabel => 'Signature saved';

  @override
  String get inspectionSignatureRedraw => 'Draw a new signature';

  @override
  String get inspectionDetailTitle => 'Inspection';

  @override
  String get inspectionNotFoundTitle => 'Inspection not found';

  @override
  String get inspectionNotFoundMessage =>
      'This inspection could not be found on this device or on the server.';

  @override
  String get inspectionStatusUnknown => 'Unknown';

  @override
  String get inspectionInspectorUnknown => 'Inspector not recorded';

  @override
  String get inspectionSignatureMissing => 'No signature recorded';

  @override
  String get inspectionGpsSectionTitle => 'Location';

  @override
  String inspectionGpsCoordinates(String lat, String lng) {
    return '$lat, $lng';
  }

  @override
  String get inspectionQueueFailedLabel => 'Sync failed';

  @override
  String get inspectionQueuePendingLabel => 'Waiting to sync';

  @override
  String get inspectionRetrySyncButton => 'Retry';

  @override
  String get inspectionStatusSynced => 'Synced';

  @override
  String get inspectionHistoryTitle => 'My Inspections';

  @override
  String get inspectionHistoryEmptyTitle => 'No inspections yet';

  @override
  String get inspectionHistoryEmptyMessage =>
      'Inspections you start or submit will appear here.';

  @override
  String get inspectionHistoryInProgressSection => 'In progress';

  @override
  String get inspectionHistorySubmittedSection => 'Submitted';

  @override
  String get checklistAddPhotoTitle => 'Add a photo';

  @override
  String get checklistPhotoSourceCamera => 'Take a photo';

  @override
  String get checklistPhotoSourceGallery => 'Choose from gallery';

  @override
  String get checklistNoteRequiredLabel => 'Remark (required)';

  @override
  String get checklistNoteLabel => 'Remark';

  @override
  String get checklistYes => 'Yes';

  @override
  String get checklistNo => 'No';

  @override
  String get checklistSignatureSavedLabel => 'Signature saved';

  @override
  String get checklistSignatureRedraw => 'Draw a new signature';

  @override
  String get checklistsHomeTitle => 'Checklists';

  @override
  String get checklistsHistoryAction => 'My checklist history';

  @override
  String get checklistsEmptyTitle => 'Nothing to fill yet';

  @override
  String get checklistsEmptyMessage =>
      'No checklists, assignments or unfinished sheets are available for you right now.';

  @override
  String get checklistsUnfinishedSection => 'Unfinished work';

  @override
  String get checklistsAssignmentsSection => 'Assignments due';

  @override
  String get checklistsAvailableSection => 'Available checklists';

  @override
  String get checklistNoAssetLabel => 'No asset picked yet';

  @override
  String checklistResumeProgress(int filled, int total) {
    return '$filled of $total answered';
  }

  @override
  String get checklistHistoryTitle => 'Checklist history';

  @override
  String get checklistHistorySearchHint =>
      'Search by document, template, asset or site';

  @override
  String get checklistHistoryFilterAll => 'All';

  @override
  String get checklistHistoryFilterWaiting => 'Waiting';

  @override
  String get checklistHistoryFilterClosed => 'Closed';

  @override
  String get checklistHistoryFilterSentBack => 'Sent back';

  @override
  String get checklistHistoryEmptyTitle => 'No checklist history yet';

  @override
  String get checklistHistoryEmptyMessage =>
      'Sheets you fill in will appear here, whether they are still on their way to the server or already confirmed.';

  @override
  String get checklistHistoryQueuedSection => 'Still on this device';

  @override
  String get checklistHistoryCompletedSection => 'Confirmed';

  @override
  String get checklistQueueFailedLabel => 'Needs attention';

  @override
  String get checklistQueuePendingLabel => 'Waiting to sync';

  @override
  String get checklistHistoryStatusClosed => 'Closed';

  @override
  String get checklistHistoryStatusSentBack => 'Sent back';

  @override
  String get checklistHistoryStatusWaiting => 'Waiting for approval';

  @override
  String get checklistHistoryStatusNoApproval => 'No approval needed';

  @override
  String get checklistFillLoadingTitle => 'Checklist';

  @override
  String get checklistSubmittedTitle => 'Checklist submitted';

  @override
  String get checklistSubmittedMessage =>
      'Your sheet is saved. It will reach the server as soon as this device is online.';

  @override
  String get checklistLastSubmissionKnown =>
      'This machine has a previous submission for this checklist.';

  @override
  String checklistLastSubmissionDaysAgo(int daysAgo) {
    return 'This machine was last checked $daysAgo day(s) ago on this checklist.';
  }

  @override
  String get checklistPrimarySignatureLabel => 'Sign-off signature';

  @override
  String get checklistSubmitAction => 'Submit checklist';

  @override
  String get checklistSiteLabel => 'Site';

  @override
  String get checklistPrintedNameLabel => 'Printed name';

  @override
  String get checklistPrintedNamePlaceholder => 'Type your full name';

  @override
  String checklistGateFieldErrors(int count) {
    return '$count field(s) need attention';
  }

  @override
  String checklistGateSignatureErrors(int count) {
    return '$count signature(s) are required';
  }

  @override
  String checklistGateMissingNotes(int count) {
    return '$count item(s) need a remark explaining the mark';
  }

  @override
  String checklistGateUnsatisfiedGroups(int count) {
    return '$count reading group(s) need at least one value';
  }

  @override
  String get checklistGatePrimarySignature =>
      'A signature is required to submit this sheet';

  @override
  String get inspectionApprovalsTitle => 'Inspection Approvals';

  @override
  String inspectionApprovalsAwaitingCount(int count) {
    return '$count awaiting sign-off';
  }

  @override
  String get inspectionApprovalsEmptyTitle => 'Nothing awaiting approval';

  @override
  String get inspectionApprovalsEmptyMessage =>
      'Every inspection has been reviewed. Pull down to check again.';

  @override
  String get inspectionApprovalsLoadErrorMessage =>
      'Approvals could not be loaded. Check your connection and try again.';

  @override
  String get inspectionApprovalsPendingBadge => 'Pending';

  @override
  String get inspectionApprovalFallbackTitle => 'Inspection';

  @override
  String get inspectionApprovalReviewTitle => 'Approval';

  @override
  String get inspectionApprovalLoadErrorMessage =>
      'This inspection could not be loaded. Check your connection and try again.';

  @override
  String get inspectionApprovalNotFoundMessage =>
      'This inspection could not be found. It may already have been reviewed or removed.';

  @override
  String inspectionApprovalTyreConditionsTitle(int count) {
    return 'Tyre conditions ($count)';
  }

  @override
  String get inspectionApprovalNoTyreConditions =>
      'No tyre conditions recorded.';

  @override
  String get inspectionApprovalYourDecisionTitle => 'Your decision';

  @override
  String get inspectionApprovalDecisionTitle => 'Decision';

  @override
  String get inspectionApprovalDecisionApproved => 'Approved';

  @override
  String get inspectionApprovalDecisionReturned => 'Returned to the field';

  @override
  String inspectionApprovalApprovedBy(String name) {
    return 'Approved by $name';
  }

  @override
  String inspectionApprovalReturnedBy(String name) {
    return 'Returned by $name';
  }

  @override
  String get inspectionApprovalApproverSignatureLabel => 'Approver signature';

  @override
  String inspectionApprovalSigningAs(String name) {
    return 'Signing as $name';
  }

  @override
  String get inspectionApprovalNoteLabel => 'Note (required to return)';

  @override
  String get inspectionApprovalNoteHint =>
      'Reason if returning to the inspector';

  @override
  String get inspectionApprovalApproveButton => 'Approve';

  @override
  String get inspectionApprovalReturnButton => 'Return';

  @override
  String get inspectionApprovalSignatureRequiredTitle => 'Signature required';

  @override
  String get inspectionApprovalSignatureRequiredMessage =>
      'Sign in the approver box to approve this inspection.';

  @override
  String get inspectionApprovalReasonRequiredTitle => 'Reason required';

  @override
  String get inspectionApprovalReasonRequiredMessage =>
      'Add a short note so the inspector knows what to fix.';

  @override
  String get inspectionApprovalApprovedOutcomeTitle => 'Inspection approved';

  @override
  String get inspectionApprovalReturnedOutcomeTitle => 'Inspection returned';

  @override
  String get inspectionApprovalApprovedOutcomeMessage =>
      'The inspection has been approved. You can review it here, or go back to the list.';

  @override
  String get inspectionApprovalReturnedOutcomeMessage =>
      'The inspection has been returned to the field. You can review it here, or go back to the list.';

  @override
  String get inspectionApprovalStayHereAction => 'Stay here';

  @override
  String get inspectionApprovalBackToListAction => 'Back to list';

  @override
  String get inspectionApprovalSaveFailedTitle => 'Could not save decision';

  @override
  String get inspectionApprovalDecideGenericError => 'Please try again.';

  @override
  String get inspectionApprovalSignatureSavedLabel => 'Signature saved';

  @override
  String get inspectionApprovalSignatureRedraw => 'Draw a new signature';

  @override
  String get checklistApprovalsTitle => 'Checklist Approvals';

  @override
  String checklistApprovalsAwaitingCount(int count) {
    return '$count awaiting sign-off';
  }

  @override
  String get checklistApprovalsLoadErrorMessage =>
      'Approvals could not be loaded. Check your connection and try again.';

  @override
  String get checklistApprovalsEmptyTitle => 'Nothing awaiting approval';

  @override
  String get checklistApprovalsEmptyMessage =>
      'Every checklist has been reviewed. Pull down to check again.';

  @override
  String get checklistApprovalsEmptyMineTitle => 'Nothing needs you right now';

  @override
  String get checklistApprovalsEmptyMineMessage =>
      'No checklist in this queue is waiting on your signature at the moment.';

  @override
  String get checklistApprovalsFilterAll => 'All';

  @override
  String get checklistApprovalsFilterMine => 'Needs me';

  @override
  String get checklistApprovalsYourTurn => 'Your turn';

  @override
  String get checklistApprovalFallbackTitle => 'Checklist';

  @override
  String checklistApprovalsBlockedTitle(int count) {
    return '$count decision(s) need attention';
  }

  @override
  String get checklistApprovalsBlockedMessage =>
      'These decisions could not be delivered and will not be tried again automatically. Try again below, or reopen the checklist to decide again.';

  @override
  String get checklistApprovalsStatusClosed => 'Closed';

  @override
  String get checklistApprovalsStatusSentBack => 'Sent back';

  @override
  String get checklistApprovalsStatusWaitingAreaManager =>
      'Waiting for the area manager';

  @override
  String get checklistApprovalsStatusWaitingSupervisor =>
      'Waiting for a supervisor';

  @override
  String get checklistApprovalsStatusWaitingApproval => 'Waiting for approval';

  @override
  String get checklistApprovalsStatusNoApproval => 'No approval needed';

  @override
  String get checklistApprovalReviewTitle => 'Approval';

  @override
  String get checklistApprovalLoadErrorMessage =>
      'This checklist could not be loaded. Check your connection and try again.';

  @override
  String get checklistApprovalNotFoundTitle => 'Checklist not found';

  @override
  String get checklistApprovalNotFoundMessage =>
      'This checklist could not be found. It may already have been reviewed or removed.';

  @override
  String get checklistApprovalSignOffsTitle => 'Sign-offs';

  @override
  String get checklistApprovalResponsesTitle => 'Responses';

  @override
  String get checklistApprovalNoResponses => 'No responses recorded.';

  @override
  String get checklistApprovalStageFilledBy => 'Filled by';

  @override
  String get checklistApprovalStageSupervisor => 'Supervisor sign-off';

  @override
  String get checklistApprovalStageAreaManager => 'Area manager approval';

  @override
  String get checklistApprovalStageApproval => 'Approval';

  @override
  String get checklistApprovalNotSignedYet => 'Not signed yet';

  @override
  String get checklistApprovalYourDecisionTitle => 'Your decision';

  @override
  String get checklistApprovalSupervisorSignatureLabel =>
      'Supervisor signature';

  @override
  String get checklistApprovalAreaManagerSignatureLabel =>
      'Area manager signature';

  @override
  String get checklistApprovalYourNameLabel => 'Your name';

  @override
  String get checklistApprovalYourNamePlaceholder => 'Type your name';

  @override
  String get checklistApprovalNoteLabel => 'Note (required to send back)';

  @override
  String get checklistApprovalNoteHint => 'Reason if sending this back';

  @override
  String get checklistApprovalReturnButton => 'Send back';

  @override
  String get checklistApprovalSignOffButton => 'Sign off';

  @override
  String get checklistApprovalApproveAndCloseButton => 'Approve and close';

  @override
  String get checklistApprovalRequirementTitle => 'Cannot sign off';

  @override
  String get checklistApprovalReasonRequiredTitle => 'Reason required';

  @override
  String get checklistApprovalReasonRequiredMessage =>
      'Add a short note so the person who filled this in knows what to fix.';

  @override
  String get checklistApprovalNameRequiredMessage =>
      'Enter your name to sign this off.';

  @override
  String get checklistApprovalSignatureRequiredMessage =>
      'Sign in the box above to sign this off.';

  @override
  String get checklistApprovalNothingToDecide =>
      'This checklist has nothing left to decide.';

  @override
  String checklistApprovalNotYourRung(String status) {
    return 'This is not for you to decide. $status';
  }

  @override
  String get checklistApprovalSaveFailedTitle => 'Could not save decision';

  @override
  String get checklistApprovalDecideGenericError => 'Please try again.';

  @override
  String get checklistApprovalSentBackTitle => 'Checklist sent back';

  @override
  String get checklistApprovalSentBackMessage =>
      'This checklist has been sent back to the field. You can review it here, or go back to the list.';

  @override
  String get checklistApprovalSignedOffTitle => 'Signed off';

  @override
  String get checklistApprovalSignedOffMessage =>
      'Your signature has been recorded. This checklist now waits for the area manager. You can review it here, or go back to the list.';

  @override
  String get checklistApprovalApprovedTitle => 'Checklist approved';

  @override
  String get checklistApprovalApprovedMessage =>
      'This checklist has been approved and closed. You can review it here, or go back to the list.';

  @override
  String get checklistApprovalStayHereAction => 'Stay here';

  @override
  String get checklistApprovalBackToListAction => 'Back to list';

  @override
  String get checklistApprovalQueuedTitle => 'Saved';

  @override
  String get checklistApprovalQueuedOffline =>
      'Your decision is saved on this device and will be sent when you are back online.';

  @override
  String checklistApprovalScoreLine(int pct, String status) {
    return 'Score: $pct% ($status)';
  }

  @override
  String get checklistApprovalScorePassed => 'Passed';

  @override
  String get checklistApprovalScoreFailed => 'Failed';

  @override
  String get checklistApprovalSignatureSavedLabel => 'Signature saved';

  @override
  String get checklistApprovalSignatureRedraw => 'Draw a new signature';

  @override
  String get meterLogNavTitle => 'Daily Meter Log';

  @override
  String get meterLogWorkspaceLoadingMessage =>
      'Your workspace is still loading. Try again in a moment.';

  @override
  String get meterLogAssetLabel => 'Asset';

  @override
  String get meterLogAssetHint => 'Type or scan the asset number';

  @override
  String get meterLogSiteLabel => 'Site';

  @override
  String get meterLogSiteHint => 'Where this reading was taken';

  @override
  String get meterLogSiteHelp =>
      'Filled in automatically from the fleet record. Change it if this reading is from a different site.';

  @override
  String get meterLogLastReadingChecking => 'Checking the last reading...';

  @override
  String get meterLogLastReadingUnknown =>
      'No previous reading is recorded for this asset.';

  @override
  String meterLogLastReadingKnown(String km, String date) {
    return 'Last reading: $km km on $date';
  }

  @override
  String get meterLogOdometerLabel => 'Odometer (km)';

  @override
  String get meterLogOdometerHint => 'Enter the reading';

  @override
  String get meterLogEngineHoursLabel => 'Engine hours';

  @override
  String get meterLogEngineHoursHint => 'Optional';

  @override
  String get meterLogEngineHoursHelpWithHours =>
      'A photo of the hour meter will be requested on the next step.';

  @override
  String get meterLogEngineHoursHelpWithoutHours =>
      'Leave this blank if the vehicle has no hour meter.';

  @override
  String get meterLogNotesLabel => 'Notes';

  @override
  String get meterLogNotesHint => 'Anything worth recording';

  @override
  String get meterLogSignatureLabel => 'Signature';

  @override
  String get meterLogSignatureSavedLabel => 'Signature saved';

  @override
  String get meterLogSignatureRedraw => 'Draw a new signature';

  @override
  String get meterLogContinueAction => 'Review & Save';

  @override
  String get meterLogAssetRequiredTitle => 'Asset needed';

  @override
  String get meterLogAssetRequiredMessage =>
      'Enter the asset before continuing.';

  @override
  String get meterLogReadingRequiredTitle => 'Reading needed';

  @override
  String get meterLogReadingRequiredMessage =>
      'Enter the odometer reading before continuing.';

  @override
  String get meterLogInvalidReadingTitle => 'That reading does not look right';

  @override
  String get meterLogInvalidReadingMessage =>
      'The odometer reading cannot be a negative number.';

  @override
  String get meterLogBelowLastTitle =>
      'This reading is lower than the last one';

  @override
  String meterLogBelowLastMessage(String km) {
    return 'The last reading recorded for this asset was $km km. Saving this reading will flag it for admin review.';
  }

  @override
  String get meterLogRecheckAction => 'Re-check';

  @override
  String get meterLogSaveAndFlagAction => 'Save anyway';

  @override
  String get meterLogBigJumpTitle => 'That is a large jump';

  @override
  String meterLogBigJumpMessage(String km) {
    return 'This is $km km more than the last reading.';
  }

  @override
  String get meterLogLogAnywayAction => 'Log anyway';

  @override
  String get meterLogReviewTitle => 'Confirm reading';

  @override
  String get meterLogPhotographGaugeLabel => 'Photograph the gauge';

  @override
  String get meterLogPhotoCamera => 'Camera';

  @override
  String get meterLogPhotoGallery => 'Gallery';

  @override
  String get meterLogPhotoNone => 'No photo taken';

  @override
  String get meterLogPhotoRequiredTitle => 'Photo needed';

  @override
  String get meterLogPhotoRequiredMessage =>
      'A photo of the odometer is required before saving.';

  @override
  String get meterLogSaveReadingAction => 'Save Reading';

  @override
  String get meterLogFlaggedNote =>
      'This reading is below the last one and will be flagged for admin review.';

  @override
  String get meterLogSavedMessage =>
      'Reading saved. It will sync automatically.';

  @override
  String get meterLogSavedAndFlaggedMessage =>
      'Reading saved and flagged for admin review because it is below the last one.';

  @override
  String get meterLogTryAgainFallback => 'Something went wrong. Try again.';

  @override
  String get meterLogRecentTitle => 'Recent readings';

  @override
  String get meterLogRecentEmptyMessage => 'No readings recorded yet.';

  @override
  String get meterLogRecentLoadErrorMessage =>
      'Recent readings could not be loaded.';

  @override
  String meterLogRecentKmValue(String km) {
    return '$km km';
  }

  @override
  String get washNavTitle => 'Vehicle Washing';

  @override
  String get washWorkspaceLoadingMessage =>
      'Your workspace is still loading. Try again in a moment.';

  @override
  String get washDueTitle => 'Due for wash';

  @override
  String get washDueNone => 'Nothing is due for a wash.';

  @override
  String get washDueToday => 'Due today';

  @override
  String washDueOverdue(int days) {
    return '$days days overdue';
  }

  @override
  String get washDueLoadErrorMessage =>
      'The due list could not be checked right now.';

  @override
  String get washAssetLabel => 'Asset';

  @override
  String get washAssetHint => 'Type or scan the asset number';

  @override
  String washMasterFleetNumber(String fleetNo) {
    return 'Fleet $fleetNo';
  }

  @override
  String get washSiteLabel => 'Site';

  @override
  String get washSiteHint => 'Where the vehicle is washed';

  @override
  String get washSiteHelp =>
      'Filled in automatically from the fleet record. Change it if this wash happened at a different site.';

  @override
  String get washDateLabel => 'Date';

  @override
  String washDateTodayLine(String date) {
    return 'Today · $date';
  }

  @override
  String get washTypeLabel => 'Wash type';

  @override
  String get washTypeExterior => 'Exterior';

  @override
  String get washTypeInterior => 'Interior';

  @override
  String get washTypeFull => 'Full';

  @override
  String get washTypeEngineBay => 'Engine Bay';

  @override
  String get washTypeUndercarriage => 'Undercarriage';

  @override
  String get washTypeSteam => 'Steam';

  @override
  String get washTypeWaterless => 'Waterless';

  @override
  String get washStatusLabel => 'Status';

  @override
  String get washStatusInProgress => 'In Progress';

  @override
  String get washStatusCompleted => 'Completed';

  @override
  String get washPhotosLabel => 'Photos';

  @override
  String get washAddPhoto => 'Add photo';

  @override
  String get washPhotoCamera => 'Camera';

  @override
  String get washPhotoGallery => 'Gallery';

  @override
  String get washDetailsLabel => 'Details';

  @override
  String get washOperatorLabel => 'Operator name';

  @override
  String get washOperatorHint => 'Who washed the vehicle';

  @override
  String get washBayLabel => 'Bay';

  @override
  String get washBayHint => 'Optional';

  @override
  String get washOdometerLabel => 'Odometer (km)';

  @override
  String get washOdometerHint => 'Optional';

  @override
  String get washNotesLabel => 'Notes';

  @override
  String get washNotesHint => 'Anything worth recording';

  @override
  String get washTypeRequiredTitle => 'Wash type needed';

  @override
  String get washTypeRequiredMessage => 'Choose a wash type before saving.';

  @override
  String get washAssetRequiredTitle => 'Asset needed';

  @override
  String get washAssetRequiredMessage => 'Enter the asset before saving.';

  @override
  String get washSaveAction => 'Save Wash';

  @override
  String get washSavedMessage => 'Wash logged. It will sync automatically.';

  @override
  String get washSaveFailedTitle => 'Could not save the wash';

  @override
  String get washTryAgainFallback => 'Something went wrong. Try again.';

  @override
  String get washRecentTitle => 'Recent washes';

  @override
  String get washRecentEmptyMessage => 'No washes recorded yet.';

  @override
  String get washRecentLoadErrorMessage => 'Recent washes could not be loaded.';

  @override
  String get homeNavTitle => 'Home';

  @override
  String get homeGreeting => 'Welcome back';

  @override
  String get homeFieldSectionHeading => 'Field';

  @override
  String get homeFleetSectionHeading => 'Fleet';

  @override
  String get homeMaintenanceSectionHeading => 'Maintenance';

  @override
  String get homeSyncStatLabel => 'Pending sync';

  @override
  String get homeSiteStatLabel => 'Site';

  @override
  String get homeSiteStatUnavailable => 'No site on file';

  @override
  String get homeFleetSizeStatLabel => 'Fleet size';

  @override
  String get homeStatLoadingCaption => 'Checking';

  @override
  String get homeStatUnavailableCaption => 'Could not check';

  @override
  String get homeNoQuickActionsMessage =>
      'Nothing is available to you here yet. Contact your administrator if you need access to a feature.';

  @override
  String get workOrdersNavTitle => 'Work Orders';

  @override
  String workOrdersActiveCount(int count) {
    return '$count active';
  }

  @override
  String get workOrdersFilterActive => 'Active';

  @override
  String get workOrdersFilterAll => 'All';

  @override
  String get workOrdersEmptyTitle => 'No work orders';

  @override
  String get workOrdersEmptyMessage =>
      'Work orders logged for this fleet will appear here.';

  @override
  String get workOrdersLoadErrorMessage =>
      'Work orders could not be loaded right now.';

  @override
  String get workOrdersStatusOpenFallback => 'Open';

  @override
  String get workOrdersWorkTypeFallback => 'General work';

  @override
  String get workOrderNewTitle => 'New work order';

  @override
  String get workOrderAssetLabel => 'Asset';

  @override
  String get workOrderAssetHint => 'e.g. TM514';

  @override
  String get workOrderAssetRequiredMessage => 'Enter the asset before saving.';

  @override
  String get workOrderWorkTypeLabel => 'Work type';

  @override
  String get workOrderPriorityLabel => 'Priority';

  @override
  String get workOrderDescriptionLabel => 'Details';

  @override
  String get workOrderDescriptionHint => 'Anything worth recording';

  @override
  String get workOrderCreateAction => 'Create work order';

  @override
  String get workOrderSavedMessage =>
      'Work order logged. It will sync automatically.';

  @override
  String get workOrderSaveFailedMessage => 'Could not save. Try again.';

  @override
  String get workOrderWorkspaceLoadingMessage =>
      'Your workspace is still loading. Try again in a moment.';

  @override
  String get workOrderWorkTypeTyreChange => 'Tyre Change';

  @override
  String get workOrderWorkTypeRepair => 'Repair';

  @override
  String get workOrderWorkTypeRotation => 'Rotation';

  @override
  String get workOrderWorkTypeAlignment => 'Alignment';

  @override
  String get workOrderWorkTypeInspection => 'Inspection';

  @override
  String get workOrderWorkTypeOther => 'Other';

  @override
  String get workOrderPriorityLow => 'Low';

  @override
  String get workOrderPriorityMedium => 'Medium';

  @override
  String get workOrderPriorityHigh => 'High';

  @override
  String get workOrderPriorityCritical => 'Critical';

  @override
  String get workOrderAdvanceToInProgress => 'In Progress';

  @override
  String get workOrderAdvanceToCompleted => 'Completed';

  @override
  String get workOrderStatusQueuedMessage =>
      'Status update saved. It will sync automatically.';

  @override
  String get workOrderDetailTitle => 'Work order';

  @override
  String get workOrderNotFoundTitle => 'Work order not found';

  @override
  String get workOrderNotFoundMessage =>
      'This work order could not be found, or you no longer have access to it.';

  @override
  String get workOrderLoadErrorMessage =>
      'This work order could not be loaded right now.';

  @override
  String get workOrderFieldWorkOrderNo => 'Work order no.';

  @override
  String get workOrderFieldWorkType => 'Work type';

  @override
  String get workOrderFieldSite => 'Site';

  @override
  String get workOrderFieldCountry => 'Country';

  @override
  String get workOrderFieldOpened => 'Opened';

  @override
  String get workOrderFieldStarted => 'Started';

  @override
  String get workOrderFieldCompleted => 'Completed';

  @override
  String get workOrderFieldDescription => 'Description';

  @override
  String get tyreReplaceNavTitle => 'Tyre Replacement';

  @override
  String get tyreReplaceWorkspaceLoadingMessage =>
      'Your workspace is still loading. Try again in a moment.';

  @override
  String get tyreReplaceAssetLabel => 'Asset';

  @override
  String get tyreReplaceAssetHint => 'Type or scan the asset number';

  @override
  String tyreReplaceMasterFleetNumber(String fleetNo) {
    return 'Fleet $fleetNo';
  }

  @override
  String get tyreReplaceSiteLabel => 'Site';

  @override
  String get tyreReplaceSiteHint => 'Where the tyre was replaced';

  @override
  String get tyreReplaceSiteHelp =>
      'Filled in automatically from the fleet record. Change it if this replacement happened at a different site.';

  @override
  String get tyreReplacePositionLabel => 'Position';

  @override
  String get tyreReplacePositionHint =>
      'Tap a position for this vehicle, or type your own below.';

  @override
  String get tyreReplacePositionInputLabel => 'Position code';

  @override
  String get tyreReplaceBrandLabel => 'Brand';

  @override
  String get tyreReplaceBrandHint => 'Optional';

  @override
  String get tyreReplaceSizeLabel => 'Size';

  @override
  String get tyreReplaceSizeHint => 'e.g. 315/80R22.5';

  @override
  String get tyreReplaceSerialLabel => 'Serial number';

  @override
  String get tyreReplaceSerialHint => 'Optional';

  @override
  String get tyreReplaceCostLabel => 'Cost';

  @override
  String get tyreReplaceCostHint => 'Optional';

  @override
  String get tyreReplaceOdometerLabel => 'Odometer (km)';

  @override
  String get tyreReplaceOdometerHint => 'Optional';

  @override
  String get tyreReplaceTreadLabel => 'Tread depth (mm)';

  @override
  String get tyreReplaceTreadHint => 'Optional';

  @override
  String get tyreReplaceReasonLabel => 'Reason for removal';

  @override
  String get tyreReplaceReasonHint => 'Optional - why the old tyre came off';

  @override
  String get tyreReplacePhotosLabel => 'Photos';

  @override
  String get tyreReplaceAddPhoto => 'Add photo';

  @override
  String get tyreReplacePhotoCamera => 'Camera';

  @override
  String get tyreReplacePhotoGallery => 'Gallery';

  @override
  String get tyreReplaceSaveAction => 'Save Tyre Replacement';

  @override
  String get tyreReplaceAssetRequiredTitle => 'Asset needed';

  @override
  String get tyreReplaceAssetRequiredMessage =>
      'Enter the asset before saving.';

  @override
  String get tyreReplacePositionRequiredTitle => 'Position needed';

  @override
  String get tyreReplacePositionRequiredMessage =>
      'Choose or type a position before saving.';

  @override
  String get tyreReplaceSavedTitle => 'Tyre replacement saved';

  @override
  String get tyreReplaceSavedMessage => 'It will sync automatically.';

  @override
  String get tyreReplaceAddAnotherAction => 'Add another';

  @override
  String get tyreReplaceDoneAction => 'Done';

  @override
  String get tyreReplaceSaveFailedTitle =>
      'Could not save the tyre replacement';

  @override
  String get tyreReplaceTryAgainFallback => 'Something went wrong. Try again.';

  @override
  String get globalSearchTitle => 'Search';

  @override
  String get globalSearchSubtitle =>
      'Find an asset, tyre, work order or inspection';

  @override
  String get globalSearchPlaceholder =>
      'Asset, registration, chassis, fleet no, serial, work order...';

  @override
  String get globalSearchHelp =>
      'Matches asset number, registration, chassis number, fleet number, tyre serial, work order number or inspection reference.';

  @override
  String get globalSearchSearching => 'Searching...';

  @override
  String get globalSearchIdleTitle => 'Search across your fleet';

  @override
  String get globalSearchIdleMessage =>
      'Type an asset number, registration, chassis number, fleet number, tyre serial, work order number or inspection reference to search everything at once.';

  @override
  String get globalSearchEmptyTitle => 'No matches found';

  @override
  String get globalSearchEmptyMessage =>
      'Nothing matched that term across assets, tyres, work orders or inspections. Check the spelling and try again.';

  @override
  String get globalSearchRecentSectionTitle => 'Recent searches';

  @override
  String globalSearchResultsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count results',
      one: '1 result',
      zero: 'No results',
    );
    return '$_temp0';
  }

  @override
  String get globalSearchSectionAssets => 'Assets';

  @override
  String get globalSearchSectionTyres => 'Tyres';

  @override
  String get globalSearchSectionWorkOrders => 'Work orders';

  @override
  String get globalSearchSectionInspections => 'Inspections';

  @override
  String get globalSearchSourceFailedNotice =>
      'Some results could not be checked right now. Pull to refresh or try again.';

  @override
  String get loginAppSubtitle => 'Inspector App';

  @override
  String get loginTagline => 'TyrePulse Fleet Intelligence · Tyre Man Portal';

  @override
  String get loginCardTitle => 'Sign In';

  @override
  String get loginCardSubtitle => 'Use your email, username, or Employee ID';

  @override
  String get loginIdentifierLabel => 'Email / Username / Employee ID';

  @override
  String get loginIdentifierPlaceholder => 'Enter email, username, or ID';

  @override
  String get loginPasswordLabel => 'Password';

  @override
  String get loginPasswordPlaceholder => 'Enter password';

  @override
  String get loginShowPassword => 'Show password';

  @override
  String get loginHidePassword => 'Hide password';

  @override
  String get loginErrorRequired => 'Please enter your login and password.';

  @override
  String loginErrorLocked(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'Too many failed attempts. Try again in $minutes minutes.',
      one: 'Too many failed attempts. Try again in 1 minute.',
    );
    return '$_temp0';
  }

  @override
  String get profileNavTitle => 'Profile';

  @override
  String get profileRoleLabel => 'Role';

  @override
  String get profileSuperAdminBadge => 'Platform administrator';

  @override
  String get profileSignOutConfirmTitle => 'Sign out?';

  @override
  String get profileSignOutConfirmMessage =>
      'You will need to sign in again to continue working. Anything already saved on this device stays saved.';
}
