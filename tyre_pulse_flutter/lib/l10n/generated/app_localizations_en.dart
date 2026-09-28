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
  String get vehiclesSearchHint => 'Search asset, serial, make, type or site';

  @override
  String get vehiclesTyreAssetsFilter => 'Tyre assets';

  @override
  String get vehiclesAllFilter => 'All';

  @override
  String get vehiclesEmptyTitle => 'No vehicles found';

  @override
  String get vehiclesEmptySearchMessage => 'Try a different search term.';

  @override
  String get vehiclesDetailSubtitle => 'Vehicle 360°';

  @override
  String get vehiclesMultiViewTitle => 'Vehicle views';

  @override
  String get vehiclesMultiViewHint => 'Front · Rear · Top · Left · Right';

  @override
  String get vehiclesMultiViewZoom => 'Tap to zoom';

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
  String get vehiclesFieldSerialNo => 'Equipment serial';

  @override
  String get vehiclesFieldEngineNo => 'Engine number';

  @override
  String get vehiclesFieldCapacity => 'Capacity';

  @override
  String get vehiclesFieldOperationalStatus => 'Operational status';

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
    return '$filled of $total checked';
  }

  @override
  String get inspectionWorkflowNotStarted => 'Not started';

  @override
  String get inspectionWorkflowInProgress => 'In progress';

  @override
  String get inspectionWorkflowReadyForReview => 'Ready for review';

  @override
  String inspectionWorkflowResumeSummary(String status, String progress) {
    return '$status • $progress';
  }

  @override
  String get inspectionWorkflowTapTyre =>
      'Tap a tyre to add inspection details.';

  @override
  String get inspectionWorkflowContinueChecking =>
      'Continue checking tyre positions until each has enough detail.';

  @override
  String get inspectionWorkflowAllChecked =>
      'All tyre positions are checked. Review and sign is ready.';

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
  String get inspectionDraftLabel => 'Draft';

  @override
  String inspectionTyreConfiguration(int count) {
    return '$count-Tyre Configuration';
  }

  @override
  String inspectionStepOfTotal(int step, int total) {
    return 'Step $step of $total';
  }

  @override
  String get inspectionRearLabel => 'REAR';

  @override
  String get inspectionSelectedTyre => 'Selected Tyre';

  @override
  String get inspectionPressureShort => 'Pressure';

  @override
  String get inspectionTreadDepthShort => 'Tread Depth';

  @override
  String get inspectionAddEvidencePhoto => 'Add Evidence (Photo)';

  @override
  String get inspectionSaveAndNext => 'Save & Next';

  @override
  String get inspectionFrontLeft => 'Front Left';

  @override
  String get inspectionFrontRight => 'Front Right';

  @override
  String get inspectionInnerLeft => 'Inner Left';

  @override
  String get inspectionOuterLeft => 'Outer Left';

  @override
  String get inspectionInnerRight => 'Inner Right';

  @override
  String get inspectionOuterRight => 'Outer Right';

  @override
  String get inspectionRearLeft => 'Rear Left';

  @override
  String get inspectionRearRight => 'Rear Right';

  @override
  String get inspectionTyrePositionFallback => 'Tyre position';

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
  String get inspectionDetailLoadErrorMessage =>
      'This inspection could not be loaded. Check your connection and try again.';

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
  String get inspectionHistoryQueueReadErrorMessage =>
      'Some queued inspections could not be read from this device. They have not been lost—try again shortly.';

  @override
  String get inspectionHistoryLoadErrorMessage =>
      'Your inspections could not be loaded. Pull down to try again.';

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
  String get checklistWorkspaceLoadingMessage =>
      'Your workspace is still loading. Try again in a moment.';

  @override
  String get checklistsLoadErrorMessage =>
      'Checklists could not be loaded. Pull down to try again.';

  @override
  String get checklistsLibraryTitle => 'Inspection library';

  @override
  String get checklistsLibrarySubtitle =>
      'Choose the correct workflow for the asset';

  @override
  String get checklistsAssetSearchHint => 'Scan QR or enter asset number';

  @override
  String get checklistsLanguageStorageHint =>
      'Answers are stored consistently across languages';

  @override
  String get checklistsRequiredForAsset => 'Required for this asset';

  @override
  String get checklistsGeneralLibraryTitle => 'General checklist library';

  @override
  String get checklistsGeneralLibrarySubtitle =>
      'Safety, shift, equipment and washing checklists';

  @override
  String get checklistsTyreInspectionTitle => 'Tyre inspection';

  @override
  String get checklistsTyreInspectionSubtitle =>
      'Dedicated axle/inner/outer tyre workflow';

  @override
  String checklistsAssetHistoryTitle(String assetNo) {
    return 'Checklist history for $assetNo';
  }

  @override
  String get checklistsMasterDataVerified => 'Master data verified';

  @override
  String checklistsAvailableCount(int count) {
    return '$count available';
  }

  @override
  String checklistItemCount(int count) {
    return '$count items';
  }

  @override
  String checklistPositionCount(int count) {
    return '$count positions';
  }

  @override
  String get checklistPhotosOnFailure => 'Photos required on failed items';

  @override
  String get checklistStartAction => 'Start';

  @override
  String get checklistResumeAction => 'Resume';

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
  String get myPlansNavTitle => 'My plans';

  @override
  String get myPlansSubtitle => 'Inspections assigned to you';

  @override
  String get myPlansLoadingMessage => 'Loading your plans';

  @override
  String get myPlansEmptyTitle => 'Nothing planned for you';

  @override
  String get myPlansEmptyMessage =>
      'When a supervisor schedules an inspection for you, it will appear here. You can still start an inspection at any time without a plan.';

  @override
  String get myPlansTruncatedNotice =>
      'This list may not be complete. The server returned as many plans as it will send at once, so some may be missing. Check with your supervisor before treating this as your full workload.';

  @override
  String get myPlansStateMissed => 'Missed';

  @override
  String get myPlansStateDue => 'Due now';

  @override
  String get myPlansStateStarted => 'Started';

  @override
  String get myPlansStateUpcoming => 'Upcoming';

  @override
  String get myPlansStateDone => 'Done';

  @override
  String get myPlansStateCancelled => 'Cancelled';

  @override
  String get myPlansStateUnknown => 'Not recognised';

  @override
  String get myPlansNoLocation => 'No location recorded';

  @override
  String myPlansCoveredBy(String name) {
    return 'Covered by $name';
  }

  @override
  String get myPlansCompleted => 'Completed';

  @override
  String myPlansCompletedOn(String date) {
    return 'Completed $date';
  }

  @override
  String myPlansOverdue(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days days overdue - it still needs doing',
      one: '1 day overdue - it still needs doing',
    );
    return '$_temp0';
  }

  @override
  String get checklistHistoryLoadErrorMessage =>
      'Your checklist history could not be loaded. Pull down to try again.';

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
  String get checklistFillNotFoundMessage =>
      'This checklist could not be found. It may have been unpublished.';

  @override
  String get checklistFillSaveFailedMessage =>
      'This checklist could not be saved. It has not been lost—try again.';

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
  String get inspectionApprovalsApprovedTab => 'Approved';

  @override
  String get inspectionApprovalsReturnedTab => 'Returned';

  @override
  String get dateGroupToday => 'Today';

  @override
  String get dateGroupTomorrow => 'Tomorrow';

  @override
  String get dateGroupYesterday => 'Yesterday';

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
  String get checklistApprovalReviewTitle => 'Checklist approval';

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
  String get checklistApprovalCannotCloseTitle =>
      'This sheet cannot be closed yet';

  @override
  String get checklistApprovalCannotCloseMessage =>
      'Some items are still recorded as a fault. Send the sheet back to have them fixed, then close it.';

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
  String get meterLogNavTitle => 'Record meter reading';

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
  String get washNavTitle => 'Log vehicle wash';

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
  String get homeGoodMorning => 'Good morning,';

  @override
  String get homeGoodAfternoon => 'Good afternoon,';

  @override
  String get homeGoodEvening => 'Good evening,';

  @override
  String get homeFallbackUser => 'Team member';

  @override
  String get homeSearchAssetsHint => 'Search asset, tyre, job...';

  @override
  String get homeAttentionRequired => 'Attention required';

  @override
  String get homeViewAll => 'View all';

  @override
  String get homeApprovalsMetric => 'Approvals';

  @override
  String get homeOverdueMetric => 'Overdue';

  @override
  String get homeCriticalMetric => 'Critical';

  @override
  String get homeTyreIssueDetected => 'Tyre issue detected';

  @override
  String get homeNoCriticalIssueTitle => 'No critical tyre issue';

  @override
  String get homeNoCriticalIssueMessage =>
      'No active critical tyre alert was found.';

  @override
  String get homeReviewAction => 'Review';

  @override
  String get homeMyWork => 'My work';

  @override
  String get homeQuickActions => 'Quick actions';

  @override
  String get homeInspectAction => 'Inspect';

  @override
  String get homeAssetAction => 'Asset';

  @override
  String get homeReportIssueAction => 'Report issue';

  @override
  String get homeOpenAction => 'Open';

  @override
  String get homeNoUrgentWorkTitle => 'No urgent work';

  @override
  String get homeNoUrgentWorkMessage =>
      'No overdue or high-priority task is assigned.';

  @override
  String get homeMoreAction => 'More';

  @override
  String get homeAlertsAction => 'Alerts';

  @override
  String get homeMenuTooltip => 'Open services';

  @override
  String get homeNotificationsTooltip => 'Open tyre alerts';

  @override
  String get homeSiteSelectorTooltip => 'View current site';

  @override
  String get homeReportIssueSheetTitle => 'Report an issue';

  @override
  String get homeReportAccidentAction => 'Report an accident';

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
  String get tyreDiagramModeLayout => 'Layout view';

  @override
  String get tyreDiagramModeList => 'List view';

  @override
  String get tyreDiagramStatTotal => 'Total tyres';

  @override
  String get tyreDiagramStatOk => 'OK';

  @override
  String get tyreDiagramStatMonitor => 'Monitor';

  @override
  String get tyreDiagramStatCritical => 'Critical';

  @override
  String tyreDiagramStatUnrecordedCaption(int count) {
    return '$count not yet recorded';
  }

  @override
  String tyreDiagramListPressureValue(String value) {
    return '$value psi';
  }

  @override
  String tyreDiagramListTreadValue(String value) {
    return '$value mm';
  }

  @override
  String get tyreDiagramListNotRecorded => 'Not recorded';

  @override
  String get tyreDiagramListEmptyTitle => 'Nothing recorded yet';

  @override
  String get tyreDiagramListEmptyMessage =>
      'Switch to Layout view and tap a tyre to record its condition.';

  @override
  String get tyreDetailTitle => 'Tyre detail';

  @override
  String get tyreDetailStatTread => 'Tread depth';

  @override
  String get tyreDetailStatPressure => 'Pressure';

  @override
  String get tyreDetailStatTemperature => 'Temperature';

  @override
  String get tyreDetailFieldNotRecorded => 'Not recorded';

  @override
  String get tyreDetailNotRecordedCaption => 'Not recorded for this inspection';

  @override
  String get tyreDetailSectionOverview => 'Overview';

  @override
  String get tyreDetailSectionAdditionalInfo => 'Additional info';

  @override
  String get tyreDetailBrandLabel => 'Brand / pattern';

  @override
  String get tyreDetailSizeLabel => 'Size';

  @override
  String get tyreDetailInstalledKmLabel => 'Installed at';

  @override
  String get tyreDetailRunningKmLabel => 'Running distance';

  @override
  String get tyreDetailAssetLabel => 'Asset';

  @override
  String get tyreDetailSiteLabel => 'Site';

  @override
  String get tyreDetailTakeActionButton => 'Take action';

  @override
  String get tyreDetailAddDetailsButton => 'Add details';

  @override
  String get tyreDetailEditDetailsButton => 'Edit details';

  @override
  String get tyreDetailRemainingKmLabel => 'Remaining life';

  @override
  String get tyreDetailRemainingKmCaption => 'Fleet life projection';

  @override
  String get tyreDetailRemainingKmUnavailable => 'No measured life projection';

  @override
  String get tyreDetailNoEvidenceMessage =>
      'Nobody has recorded anything for this wheel yet.';

  @override
  String get takeActionTitle => 'Take action';

  @override
  String get takeActionReplaceTyre => 'Replace tyre';

  @override
  String get takeActionReplaceTyreSubtitle =>
      'Record the new tyre fitted to this wheel';

  @override
  String get takeActionReportDefect => 'Repair (Puncture / Damage)';

  @override
  String get takeActionReportDefectSubtitle =>
      'File a repair job for this tyre';

  @override
  String get takeActionAdjustReading => 'Adjust reading';

  @override
  String get takeActionAdjustReadingSubtitle =>
      'Update pressure, tread depth or condition';

  @override
  String get takeActionAdjustReadingUnavailableCaption =>
      'Only available while filling in this inspection';

  @override
  String get takeActionRotateTyre => 'Rotate tyre';

  @override
  String get takeActionRemoveTyre => 'Remove tyre';

  @override
  String get takeActionSendToRetread => 'Send to retread';

  @override
  String get takeActionMarkAsSpare => 'Mark as spare';

  @override
  String get takeActionComingSoonCaption => 'Not available in this build yet';

  @override
  String get reportDefectTitle => 'Report a defect';

  @override
  String get reportDefectTitleFieldLabel => 'Title';

  @override
  String get reportDefectTitleFieldHint => 'e.g. Puncture on outer rear tyre';

  @override
  String get reportDefectDescriptionLabel => 'Description';

  @override
  String get reportDefectDescriptionHint => 'What is wrong with this tyre?';

  @override
  String get reportDefectDamageReasonLabel => 'Damage reason';

  @override
  String get reportDefectDamageReasonHint => 'Optional';

  @override
  String get reportDefectPriorityLabel => 'Priority';

  @override
  String get reportDefectSubmitAction => 'Submit repair request';

  @override
  String get reportDefectTitleRequiredTitle => 'Title needed';

  @override
  String get reportDefectTitleRequiredMessage =>
      'Add a short title before saving.';

  @override
  String get reportDefectSavedTitle => 'Repair request saved';

  @override
  String get reportDefectSavedMessage => 'It will sync automatically.';

  @override
  String get reportDefectSaveFailedTitle => 'Could not save the repair request';

  @override
  String get damageReasonPuncture => 'Puncture';

  @override
  String get damageReasonSidewall => 'Sidewall damage';

  @override
  String get damageReasonTreadWear => 'Tread wear';

  @override
  String get damageReasonBlowout => 'Blowout';

  @override
  String get damageReasonImpact => 'Impact damage';

  @override
  String get damageReasonOther => 'Other';

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
  String get loginTagline => 'Fleet · Workshop · Inspections · Tyres · Safety';

  @override
  String get loginCardTitle => 'Sign In';

  @override
  String get loginCardSubtitle => 'Use your email, username, or Employee ID';

  @override
  String get loginIdentifierLabel => 'Email or employee ID';

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
  String get loginOperationsTitle => 'One platform for every PMV asset';

  @override
  String get loginWelcomeTitle => 'Welcome back';

  @override
  String get loginWelcomeSubtitle =>
      'Access your assigned fleet, workshop and field tasks';

  @override
  String get loginSelectCountryTitle => 'Select your country';

  @override
  String get loginSelectCountrySubtitle =>
      'Choose the country for your assigned operations.';

  @override
  String get loginChangeCountryAction => 'Change country';

  @override
  String get loginCountrySaudiArabia => 'Saudi Arabia';

  @override
  String get loginCountryUnitedArabEmirates => 'United Arab Emirates';

  @override
  String get loginCountryEgypt => 'Egypt';

  @override
  String get loginCountrySelectorSemantics => 'Country selector';

  @override
  String loginSelectedCountrySemantics(String country) {
    return 'Selected country: $country';
  }

  @override
  String get loginScopeFleetAssets => 'Fleet & assets';

  @override
  String get loginScopeInspectionsChecklists => 'Inspections & checklists';

  @override
  String get loginScopeMaintenanceWorkshop => 'Maintenance & workshop';

  @override
  String get loginSecurityCopyCatalog =>
      'secure=Secure company workspace · %country%~forgot=Forgot password?~access=Need access? Contact your administrator~or=or~biometric=Use device biometrics~authorized=Authorized PMV personnel only~audited=Activity is audited~version=Version %version%~biometricReason=Confirm your identity to sign in to Tyre Pulse~biometricUnavailable=Device biometrics are unavailable or not enrolled.~biometricLocked=Device biometrics are temporarily locked. Use your password.~biometricFailed=Device verification could not be completed.~credentialsRequired=Enter your email or employee ID and password before using device biometrics.~helpTitle=Sign-in help~forgotHelp=Password resets are managed by your Tyre Pulse administrator. Contact your administrator to restore access.~accessHelp=Your Tyre Pulse administrator manages mobile access and account approval.';

  @override
  String get profileNavTitle => 'Profile';

  @override
  String get profileRoleLabel => 'Role';

  @override
  String get profileSuperAdminBadge => 'Platform administrator';

  @override
  String get accidentReportCaptureSubtitle => 'Private evidence capture';

  @override
  String get accidentSubmitUnavailable =>
      'Submission is unavailable until the protected sync pipeline guarantees every private evidence photo is uploaded before the accident row. Captured photos remain on this device.';

  @override
  String get accidentOverviewAppBarTitle => 'Accident';

  @override
  String get accidentCaseAppBarTitle => 'Case Details';

  @override
  String get accidentViewCaseDetailsAction => 'View Case Details';

  @override
  String get accidentUpdateCaseAction => 'Update Case';

  @override
  String get accidentReportedOnLabel => 'Reported on';

  @override
  String get accidentProgressSection => 'Progress';

  @override
  String get accidentDueDateLabel => 'Due Date';

  @override
  String get accidentCaseInfoSection => 'Case Info';

  @override
  String get accidentCaseAssetLabel => 'Asset';

  @override
  String get accidentCaseLocationLabel => 'Location';

  @override
  String get accidentCaseReportedByLabel => 'Reported By';

  @override
  String get tasksCopyCatalog =>
      'title=My Work~today=Today~assignedTab=Assigned~dueToday=Due today~inProgress=In Progress~completed=Completed~urgent=Urgent~upcoming=Upcoming~open=open~emptyTitle=No tasks~emptyMessage=No work matches this view.~loadError=My work could not be loaded right now.~due=Due~assigned=Assigned to~unassigned=Unassigned~normal=Normal~overdue=Overdue~details=Task details~description=Description~site=Site~asset=Asset~priority=Priority~status=Status~view=View~reportIssue=Report an issue~retry=Retry';

  @override
  String get alertsCopyCatalog =>
      'title=Tyre Alerts~all=All~critical=Critical~warnings=Warnings~info=Info~flagged=flagged~criticalCount=critical~emptyTitle=No active alerts~emptyFilter=No alerts match this filter.~loadError=Could not load alerts. Pull down to retry.~unknownAsset=Unknown asset~pressureLow=Tyre pressure is low~treadLow=Tread depth is low~position=Position~serial=Serial~tread=Tread~retry=Retry';

  @override
  String get notificationInboxCopyCatalog =>
      'title=Notifications~markAll=Mark all read~fallbackTitle=Notification~emptyTitle=You\'re all caught up~emptyBody=Assignments, approvals and operational updates will appear here.~loadFailed=Could not load notifications. Pull down to retry.~markFailed=Could not mark this notification as read.~markAllFailed=Could not mark all notifications as read.~justNow=Just now~minutesAgo=%count%m ago~hoursAgo=%count%h ago~daysAgo=%count%d ago';

  @override
  String get reportIssueCopyCatalog =>
      'title=Report an issue~problem=What is wrong?~problemHint=Briefly describe the issue~priority=Priority~low=Low~medium=Medium~high=High~critical=Critical~site=Site~siteHint=Where the issue was found~asset=Asset~assetHint=Asset number~due=Due in~noDate=No date~threeDays=3 days~oneWeek=1 week~twoWeeks=2 weeks~details=Description~detailsHint=Add symptoms, exact location and any immediate action taken~photos=Evidence~optional=(optional)~addPhoto=Add photo~camera=Camera~gallery=From gallery~photoFailed=The photo could not be added.~submit=Submit issue~titleRequired=Enter what is wrong before saving.~workspaceUnavailable=Your workspace is still loading. Try again in a moment.~savedTitle=Issue saved~savedBody=The issue is in My Work and will sync automatically.~stay=Stay here~viewTasks=View My Work~saveFailed=The issue could not be saved. Try again.~category=Issue category~mechanical=Mechanical~electrical=Electrical~hydraulic=Hydraulic~tyre=Tyre~body=Body~washing=Washing~safety=Safety~other=Other~operation=Can the asset operate safely?~yes=Yes~restricted=Restricted~no=No~restriction=Operating restriction~saveDraft=Save draft~draftSaved=Draft saved~createWorkOrder=Create work order after supervisor review~notifyTeam=Will notify Fleet Supervisor and Workshop team';

  @override
  String get rcaCopyCatalog =>
      'title=Root Cause Analysis~records=records~newRecord=New RCA~none=No RCA records~noneBody=Completed root-cause records will appear here.~unknown=Unknown asset~asset=Asset~serial=Tyre serial~brand=Brand~site=Site~km=Kilometres at failure~factors=Contributing factors~rootCause=Root cause~photos=Evidence photos~photo=Photo~addPhoto=Add photo~camera=Camera~gallery=Gallery~photoFailed=The photo could not be added.~save=Save RCA~missingCause=Enter the root cause before saving.~invalidKm=Enter a valid kilometre reading.~loadFailed=The RCA records could not be loaded.~saveFailed=The RCA could not be saved. Try again.';

  @override
  String get pmCopyCatalog =>
      'title=Maintenance Control Center~subtitle=Control today\'s maintenance workload~createWorkOrder=Create work order~pmDue=PM due~priorityQueue=Priority work queue~viewAll=View all~allWorkOrders=View all work orders~quickAccess=Quick access~workOrders=Work orders~workOrdersHint=Create & manage~pmSchedule=PM schedule~pmScheduleHint=Plan & track PM~inspections=Inspections~inspectionsHint=Check & report~parts=Parts~partsHint=Stock & requests~tyres=Tyres~tyresHint=Records, rotation & replacements~overdue=Overdue~dueSoon=Due soon~active=Active plans~due=Due now~all=All plans~empty=No maintenance plans~emptyDue=No preventive maintenance is due in the next 14 days.~emptyAll=No active preventive maintenance plans are available.~plan=Maintenance plan~daysOverdue=days overdue~daysLeft=days left~noDate=No due date~record=Record service~meter=Meter reading~performedBy=Performed by~workshop=Workshop~partsCost=Parts cost~labourCost=Labour cost~findings=Findings~completed=Completed~partial=Partially completed~deferred=Deferred~failed=Failed~save=Save service~invalidNumber=Enter valid numeric values.~loadFailed=The maintenance plans could not be loaded.~saveFailed=The service record could not be saved. Try again.~openBreakdowns=Open breakdowns~activeWorkOrders=Active work orders~breakdown=Breakdown~workOrder=Work order~dueToday=Due today~since=Since~opened=Opened~queueEmpty=Nothing needs attention~woLoadFailed=Open work orders could not be loaded.~retry=Retry~countFailed=This count could not be loaded. Tap to retry.';

  @override
  String get stockCountCopyCatalog =>
      'title=Stock Count~items=Items~reorder=Need reorder~notToday=Not counted~search=Search description or site~all=All~low=Low stock~stale=Not counted today~empty=No stock items~emptyBody=No stock records match these filters.~count=Count~stockItem=Stock item~physicalCount=Physical count~reason=Reason (optional)~cancel=Cancel~save=Save count~invalid=Enter a count of zero or more.~offlineSaved=Count saved offline and queued for sync.~saveFailed=The stock count could not be saved.~loadFailed=Stock records could not be loaded.~Critical=Critical~Low=Low~OK=OK~onHand=on hand';

  @override
  String get calendarCopyCatalog =>
      'title=Today\'s field plan~scheduled=scheduled~overdue=Overdue~today=Due today~week=This week~later=Later~inspection=Inspection~maintenance=Maintenance~task=Corrective task~empty=Nothing scheduled~emptyBody=Upcoming inspections, maintenance and corrective tasks will appear here.~loadFailed=The schedule could not be loaded.';

  @override
  String get managementCopyCatalog =>
      'overviewTitle=Fleet Overview~analyticsTitle=Fleet Analytics~reportsTitle=Financial report~reportsSubtitle=Live executive cost and performance~teamTitle=Team~last=Last~days=days~days30=30 days~days90=90 days~year1=1 year~allSites=All sites~tyres=Tyres~vehicles=Vehicles~critical=Critical~openActions=Open actions~highRisk=High risk~inspections30=Inspections (30d)~tyreSpend=Tyre spend~risk=Risk distribution~sites=Top sites~brands=Top brands~analyticsFailed=Analytics could not be loaded.~reportsFailed=Report data could not be loaded.~reportUnavailable=Live report unavailable~reportUnavailableBody=The authoritative server snapshot is not available. No figures were fabricated.~retry=Retry~generated=Generated~costPerformance=Cost and performance~fleet=Fleet~tyre_spend=Tyre spend~accidents=Accidents~open_accidents=Open accidents~claims_claimed=Claims submitted~claims_recovered=Claims recovered~inspections=Inspections~work_orders_open=Open work orders~tyre_cost=Tyre cost~maintenance_cost=Maintenance cost~total_cost=Total cost~km=Kilometres~engine_hours=Engine hours~m3=Production m3~cost_per_km=Cost per km~cost_per_hour=Cost per hour~cost_per_m3=Cost per m3~tyre_cpk=Tyre CPK~severity=Accident severity~accidents_by_site=Accidents by site~tyres_by_site=Tyres by site~claim_status=Claim status~members=members~manage=Manage team~active=Active~pending=Pending~teamSearch=Search name, role or site~noMembers=No team members~trySearch=Try a different search.~teamFailed=The team directory could not be loaded.';

  @override
  String get profileSignOutConfirmTitle => 'Sign out?';

  @override
  String get profileSignOutConfirmMessage =>
      'You will need to sign in again to continue working. Anything already saved on this device stays saved.';

  @override
  String get accidentCopyCatalog =>
      'loadFailed=The accident record could not be loaded. Try again.~notRecorded=Not recorded~dashboardTitle=Accident command centre~dashboardSubtitle=Live register • permission-scoped~reportAction=Report accident~reportShort=Report~loadingRegister=Loading accident register…~dashboardEyebrow=PMV incident control~dashboardHeroTitle=Every case, one accountable trail~dashboardHeroMessage=Fleet, insurance, workshop, QC, handover and recovery remain visible without invented KPIs.~searchHint=Search asset, reference, site or location~allCases=All cases~reportedByMe=Reported by me~anyStatus=Any status~open=Open~closed=Closed~noMatches=No matching cases~noMatchesMessage=Change the filters or create a new accident report.~loadMore=Load more cases~loading=Loading…~detailTitle=Accident detail~loadingFacts=Loading case facts…~notFound=Accident not found~notFoundMessage=This record is outside your access scope or no longer exists.~openFlow=Open accountable case flow~incidentFacts=Incident facts~incidentFactsHint=Reporter evidence and vehicle identity~liability=Liability & payment~liabilityHint=Who was at fault, liable and expected to pay~insurance=Insurance & recovery~insuranceHint=Claim and recovery remain distinct from closure~workshopRelease=Workshop & release~workshopReleaseHint=Assessment, repair, QC and vehicle return~closure=Closure controls~closureHint=Legacy approval and modern case status remain separate~vehicleType=Vehicle type~plate=Plate / fleet number~type=Accident type~severity=Severity~reporter=Reporter~evidenceFiles=Evidence files~description=Description~damage=Damage~fault=Fault status~responsible=Responsible party~liable=Liable party~payer=Payer~insurer=Insurer~policy=Policy~claimNo=Claim number~claimStatus=Claim status~claimed=Claimed amount~approved=Approved amount~recoveryStatus=Recovery status~recovered=Recovered amount~repairType=Repair type~workshop=Workshop~repairCost=Repair cost~expectedRelease=Expected release~actualRelease=Actual release~nextAction=Next action~workflowStage=Workflow stage~caseStatus=Case status~closureRequest=Closure request~closureLevel=Closure level~caseTitle=Case accountability~caseId=Case ID~incidentDateLabel=Incident date~damageMapTitle=Damage map~damageMapHint=Tap a zone to mark damage~damageMapZonesLabel=zone(s) marked~damageMapNoneMarked=No zones marked yet~damageViewFront=Front~damageViewRear=Rear~damageViewLeft=Left side~damageViewRight=Right side~damageViewTop=Top~zoneFrontBumper=Front bumper~zoneHood=Hood~zoneWindshield=Windshield~zoneLeftHeadlight=Left headlight~zoneRightHeadlight=Right headlight~zoneRearBumper=Rear bumper~zoneTailgate=Tailgate~zoneRearWindshield=Rear glass~zoneLeftTailLight=Left tail light~zoneRightTailLight=Right tail light~zoneFrontFender=Front fender~zoneFrontDoor=Front door~zoneRearDoor=Rear door~zoneRearFender=Rear fender~zoneMirror=Side mirror~zoneRoof=Roof~damageMarkSeverityLabel=Severity~damageMarkNoteLabel=Note (optional)~damageMarkSave=Save mark~damageMarkRemove=Remove mark~loadingWorkstreams=Loading case workstreams…~caseNotFound=Case not found~caseNotFoundMessage=This accident is outside your permission scope or no longer exists.~endToEnd=End-to-end case flow~notActivated=Case workflow not activated~notActivatedMessage=The incident exists, but the workstream model is not provisioned. No progress was inferred.~noWorkstreams=No workstreams assigned~noWorkstreamsMessage=The case model is available, but this accident has no routed workstreams yet.~timeline=Accountable timeline~timelineHint=Read-only truth from the case workstream ledger~boundary=Control boundary~boundaryHint=Actions are intentionally not fabricated~boundaryMessage=Insurance, assessment, repair, QC, handover, closure and recovery decisions require verified server actions. This view offers no unsafe direct edits.~done=Done~inProgress=In progress~pending=Pending~notRequired=Not required~reason=Reason~wsIncident=Incident & evidence~wsFleet=Fleet validation~wsLiability=Liability & safety~wsInsurance=Insurance claim~wsAssessment=Workshop assessment~wsRepair=Repair execution~wsQc=Workshop QC~wsHandover=Vehicle handover~wsFinance=Recovery & finance~wsCorrective=Corrective actions~selectAsset=Select fleet asset~changeAsset=Change fleet asset~assetSearch=Asset, fleet number, plate or model~unrecordedAsset=Unrecorded asset~photoFailed=The evidence photo could not be saved. Try again.~workspaceLoading=Your workspace is still loading. Try again.~required=Asset, site, description and at least one evidence photo are required.~fieldsDropped=The report could not preserve every field. Nothing was presented as submitted.~saveFailed=The report could not be saved on this device. Try again.~saved=Report saved~savedTitle=Accident report saved safely~savedMessage=The report and evidence are in the device sync queue and will upload under the active workspace.~backRegister=Back to accident register~reportTitle=Report an accident~reportSubtitle=Offline-safe evidence capture~firstResponse=First response~captureFacts=Capture facts at the scene~captureFactsMessage=Select the asset first so PMV master data can fill its site and identity. At least one evidence photo is mandatory.~assetLocation=1. Asset & location~assetLocationHint=Fleet master is authoritative when available~fleetUnavailable=Fleet lookup is unavailable. Manual entry remains available.~assetNo=Asset number~site=Site~exactLocation=Exact incident location~classification=2. Classification~classificationHint=Initial field classification can be reviewed later~minor=Minor~moderate=Moderate~severe=Severe~fatal=Fatal~collision=Collision~rollover=Rollover~propertyDamage=Property damage~other=Other~whatHappened=What happened?~notes=Immediate notes~evidence=3. Evidence~evidenceAttached=evidence photo(s) attached • minimum 1~camera=Camera~gallery=Gallery~evidencePhoto=Evidence photo~removePhoto=Remove photo~saveReport=Save accident report';

  @override
  String get washEvidenceTitle => 'Checklist and chemicals';

  @override
  String get washEnteredByLabel => 'Entered by';

  @override
  String get washChemicalUseLabel => 'Chemicals used';

  @override
  String get washNotRecorded => 'Not recorded';

  @override
  String get washNoChemical => 'No chemical used';

  @override
  String get washChemicalUsed => 'Chemical used';

  @override
  String get washProductName => 'Product name';

  @override
  String get washManufacturer => 'Manufacturer';

  @override
  String get washQuantity => 'Quantity and unit';

  @override
  String get washDilution => 'Dilution used (per product label)';

  @override
  String get washAddProduct => 'Add product';

  @override
  String get washRemoveProduct => 'Remove product';

  @override
  String get washChecklistTitle => 'Wash checklist';

  @override
  String get washCheckExterior => 'Exterior surfaces';

  @override
  String get washCheckGlass => 'Windows, mirrors and lights';

  @override
  String get washCheckWheels => 'Wheels and wheel arches';

  @override
  String get washCheckCab => 'Cab interior';

  @override
  String get washCheckRinse => 'Final rinse and visible residue';

  @override
  String get washNotChecked => 'Not checked';

  @override
  String get washChecked => 'Checked';

  @override
  String get washIssueFound => 'Issue found';

  @override
  String get washNotApplicable => 'Not applicable';

  @override
  String get washIssueNote => 'Issue details / comment';

  @override
  String get washEvidenceRequired =>
      'Enter product names and describe any checklist issues.';

  @override
  String get washViewRecord => 'View wash record';

  @override
  String get washReceivedAt => 'Received at';

  @override
  String get washSearchHistory => 'Search vehicle, person or site';

  @override
  String get washMyEntries => 'My entries';

  @override
  String get washAllEntries => 'All entries';

  @override
  String get washSavedOnDevice =>
      'Saved on this device. Upload status is available in Sync.';

  @override
  String get washHistoryLimit =>
      'History is too large to load completely. Use the web report.';

  @override
  String get workshopCopyCatalog =>
      'title=My Jobs~onDuty=On duty~offDuty=Off duty~checkIn=Check In~checkOut=Check Out~checkInHint=Check in for your shift before recording work.~myJobs=My jobs~emptyTitle=No open jobs~emptyMessage=No open job is assigned to you right now.~loadError=Your jobs could not be loaded right now.~selectJobTitle=Select a job~selectJobMsg=Pick one of your jobs first.~checkInFirstTitle=Check in first~selectTaskTitle=Select a task~selectTaskMsg=Pick the task you are working on first.~tasks=Tasks~confirmTitle=Complete task?~confirmMsg=This records the task as complete and sends it for inspection.~cancel=Cancel~noteHint=Add a note (optional)~record=Record~queued=Saved on this device. It will sync automatically.~saveFailed=The activity could not be saved on this device. Try again.~todayTitle=My productivity today~productive=Productive~blocked=Blocked~unassigned=Unassigned~breakTime=Break~completed=Tasks completed~due=Due~ok=OK~a_start_job=Start Job~a_pause_job=Pause Job~a_resume_job=Resume Job~a_complete_task=Complete Task~a_request_parts=Request Parts~a_request_assistance=Request Assistance~a_waiting_approval=Waiting for Approval~a_waiting_vehicle=Waiting for Vehicle~a_waiting_tools=Waiting for Tools~a_start_break=Start Break~a_end_break=End Break~a_report_problem=Report Problem~s_working=Working~s_available=Available~s_waiting_parts=Waiting for Parts~s_waiting_approval=Waiting for Approval~s_waiting_tools=Waiting for Tools~s_waiting_vehicle=Waiting for Vehicle~s_on_break=On Break~s_training=Training~s_awaiting_inspection=Awaiting Inspection~s_off_duty=Off Duty~s_absent=Absent~photoLabel=Photo (optional)~takePhoto=Camera~pickPhoto=Gallery~removePhoto=Remove photo~photoLimit=Up to 3 photos~photoNotAttached=Recorded. The photo could not be attached without a connection.';

  @override
  String get homeTodaysWork => 'Today\'s work';

  @override
  String get homeAwaitingSignatureTag => 'Awaiting signature';

  @override
  String get homeResumeInspection => 'Resume inspection';

  @override
  String get homeTyreIssueNeedsAttention => 'Tyre issue needs attention';

  @override
  String get profileSectionWorkspace => 'Workspace';

  @override
  String get profileEmployeeIdLabel => 'Employee ID';

  @override
  String get profileLanguageLabel => 'App language';

  @override
  String get profileSectionDisplay => 'Language & display';

  @override
  String get profileThemeLabel => 'Theme';

  @override
  String get profileThemeLight => 'Light';

  @override
  String get profileThemeDark => 'Dark';

  @override
  String get profileThemeSystem => 'System default';

  @override
  String get profileSectionOffline => 'Offline & data';

  @override
  String get profileUnsyncedFooter =>
      'Unsynced drafts remain safely on this device';

  @override
  String get loginHeroTitle => 'Complete PMV Operations';

  @override
  String get loginSignInSubtitle => 'Sign in to your assigned operations';

  @override
  String get vehiclesInspectNow => 'Inspect now';

  @override
  String get inspectionPreviousTyre => 'Previous';

  @override
  String get inspectionNextTyre => 'Next';

  @override
  String get inspectionProgressTitle => 'Inspection progress';

  @override
  String inspectionPercentComplete(int percent) {
    return '$percent% complete';
  }

  @override
  String inspectionAxleNumber(int number) {
    return 'Axle $number';
  }

  @override
  String get inspectionTyresLabel => 'Tyres';

  @override
  String get inspectionScanAssetButton => 'Scan asset';

  @override
  String get inspectionSelectedAssetTitle => 'Selected asset';

  @override
  String get profileSyncUnknownFooter =>
      'Pending sync could not be checked. Unsynced work may still be on this device';

  @override
  String get homeRecentInspectionsTitle => 'Your recent inspections';

  @override
  String get homeAssetNotChecked => 'Not checked';

  @override
  String get homeNothingForRoleTitle => 'Nothing to check for your role';

  @override
  String get tyreActionRotateSubtitle =>
      'Record that this tyre was moved to another position';

  @override
  String get tyreActionRotateFromLabel => 'Current position';

  @override
  String get tyreActionRotateToLabel => 'New position';

  @override
  String get tyreActionRotateToHint => 'For example RHF1';

  @override
  String get tyreActionRotateNotesLabel => 'Notes (optional)';

  @override
  String get tyreActionRotateNotesHint =>
      'Anything the next fitter should know';

  @override
  String get tyreActionRotateOnlineNote =>
      'Needs a connection. Rotations are saved straight to the server.';

  @override
  String get tyreActionRotateSubmit => 'Record rotation';

  @override
  String get tyreActionRotateToRequiredTitle => 'New position needed';

  @override
  String get tyreActionRotateToRequiredMessage =>
      'Enter the position this tyre was moved to.';

  @override
  String get tyreActionRotateSamePositionMessage =>
      'The new position must be different from the current one.';

  @override
  String get tyreActionRotateSavedTitle => 'Rotation recorded';

  @override
  String get tyreActionRotateSavedMessage =>
      'The rotation is saved in this tyre\'s service history. It does not change the position shown in the tyre register.';

  @override
  String get tyreActionRotateFailedTitle => 'Rotation not saved';

  @override
  String get tyreActionRotateOfflineMessage =>
      'No connection. Rotations are saved online only, so this one was not recorded. Try again when you are connected.';

  @override
  String get tyreActionRotateFailedMessage =>
      'The rotation could not be saved. Try again.';

  @override
  String driverWsTerm(String term) {
    String _temp0 = intl.Intl.selectLogic(
      term,
      {
        'create_driver': 'Add verified driver',
        'link_account': 'Link login account',
        'assign_team': 'Assign team and vehicle',
        'create_fine': 'Issue traffic fine',
        'link_record': 'Link work record',
        'respond_fine': 'Review and sign',
        'review_fine': 'Review response / payment',
        'correct_fine': 'Correct fine',
        'reassign_fine': 'Reassign fine',
        'direct_payment': 'I will pay directly',
        'already_paid': 'Already paid',
        'dispute': 'Dispute / incorrect assignment',
        'company_recovery': 'Request company payment / recovery',
        'instalments': 'Request instalments',
        'approve': 'Approve request',
        'return': 'Return to driver',
        'payment': 'Record verified payment',
        'cancel': 'Cancel fine',
        'reopen': 'Reopen',
        'open': 'Open',
        'settled': 'Settled',
        'cancelled': 'Cancelled',
        'awaiting_response': 'Awaiting response',
        'submitted': 'Response submitted',
        'returned': 'Returned to driver',
        'approved': 'Approved',
        'driver_documents': 'Driver documents',
        'driver_training': 'Driver training',
        'driver_coaching': 'Driver coaching',
        'driver_safety_events': 'Driver safety events',
        'driver_expenses': 'Driver expenses',
        'tyre_records': 'Tyre records',
        'accidents': 'Accidents',
        'wo_tasks': 'Work order tasks',
        'checklist_submissions': 'Checklist submissions',
        'odometer_logs': 'Odometer readings',
        'wash_records': 'Wash records',
        'other': '',
      },
    );
    return '$_temp0';
  }

  @override
  String driverWsRecordField(String field) {
    String _temp0 = intl.Intl.selectLogic(
      field,
      {
        'country': 'Country',
        'site': 'Site',
        'asset_no': 'Asset number',
        'driver_name': 'Driver name',
        'title': 'Title',
        'doc_type': 'Document type',
        'doc_number': 'Document number',
        'expiry_date': 'Expiry date',
        'course_name': 'Course name',
        'result': 'Result',
        'completed_date': 'Completed date',
        'coaching_status': 'Coaching status',
        'period': 'Period',
        'event_type': 'Event type',
        'severity': 'Severity',
        'event_at': 'Event time',
        'category': 'Category',
        'amount': 'Amount',
        'currency': 'Currency',
        'expense_date': 'Expense date',
        'status': 'Status',
        'incident_date': 'Incident date',
        'accident_type': 'Accident type',
        'due_date': 'Due date',
        'created_at': 'Created at',
        'reading_date': 'Reading date',
        'odometer_km': 'Odometer (km)',
        'wash_date': 'Wash date',
        'template_name': 'Checklist name',
        'approval_status': 'Approval status',
        'brand': 'Brand',
        'serial_no': 'Serial number',
        'issue_date': 'Issue date',
        'qty': 'Quantity',
        'cost_per_tyre': 'Cost per tyre',
        'other': '',
      },
    );
    return '$_temp0';
  }

  @override
  String driverWsEvidenceKind(String kind) {
    String _temp0 = intl.Intl.selectLogic(
      kind,
      {
        'payment': 'Payment receipt',
        'supporting': 'Supporting photo',
        'notice': 'Official notice',
        'other': '',
      },
    );
    return '$_temp0';
  }

  @override
  String get driverWsTitle => 'Driver workspace';

  @override
  String get driverWsEntrySubtitle =>
      'My fines, team assignments and verified work';

  @override
  String get driverWsLoadError =>
      'Workspace unavailable. Check connection, account linking and access, then refresh.';

  @override
  String get driverWsRefresh => 'Refresh';

  @override
  String get driverWsSignInRequired => 'Sign in to view your workspace.';

  @override
  String get driverWsOfflineNotice =>
      'Offline cached view. Connect and refresh before responding or reviewing.';

  @override
  String get driverWsTruncatedNotice =>
      'This view is incomplete because it reached the record limit. Export is disabled.';

  @override
  String get driverWsSearchDrivers => 'Search drivers';

  @override
  String get driverWsNoDrivers =>
      'No linked driver or assigned team is available. Ask an authorized manager to verify your account and assignment.';

  @override
  String get driverWsSharePdf => 'Share fine statement PDF';

  @override
  String get driverWsReportShareError =>
      'Report could not be shared. Try again.';

  @override
  String get driverWsTrafficFines => 'Traffic fines';

  @override
  String get driverWsNoFines => 'No fines recorded.';

  @override
  String get driverWsAssignmentHistory => 'Team and vehicle assignment history';

  @override
  String get driverWsNoAssignment => 'No assignment recorded.';

  @override
  String get driverWsAssignmentCurrent => 'Current';

  @override
  String get driverWsAssignmentPrevious => 'Previous';

  @override
  String get driverWsNoVehicle => 'No vehicle';

  @override
  String get driverWsNotAssigned => 'Not assigned';

  @override
  String get driverWsPresent => 'Present';

  @override
  String get driverWsAssignedWork => 'Assigned work';

  @override
  String get driverWsNotSupplied => 'Not supplied';

  @override
  String get driverWsVerifiedRecords => 'Verified work and driver records';

  @override
  String get driverWsUnmatchedNotice =>
      'Unmatched historical records require identity review before they appear here.';

  @override
  String get driverWsRecordUnavailable => 'Record no longer available';

  @override
  String get driverWsActivityHistory => 'Activity history';

  @override
  String get driverWsRecordedUser => 'Recorded user';

  @override
  String get driverWsPhotoError =>
      'Photo could not be attached. Your local photo has not been deleted.';

  @override
  String get driverWsAcknowledgeRespond => 'Acknowledge and respond';

  @override
  String get driverWsReviewPayment => 'Review / record payment';

  @override
  String get driverWsEvidenceOpenError => 'Evidence could not be opened.';

  @override
  String get driverWsAttachReceipt => 'Attach receipt photo';

  @override
  String get driverWsAttachSupporting => 'Attach supporting photo';

  @override
  String get driverWsAttachNotice => 'Attach official notice photo';

  @override
  String get driverWsSignatureUnavailable => 'Signature unavailable.';

  @override
  String get driverWsViewSignature => 'View signed acknowledgment';

  @override
  String get driverWsSignatureDisplayError =>
      'Signature could not be displayed.';

  @override
  String get driverWsReceiptStatement =>
      'I acknowledge receipt and review of this notice and submit the response shown above. Receipt does not mean admission of responsibility. A payment or recovery request does not authorize an automatic payment or payroll deduction.';

  @override
  String get driverWsDraftReadError =>
      'Saved draft could not be read. Nothing has been overwritten.';

  @override
  String get driverWsSubmitError =>
      'Could not submit. Check the required fields and connection. Refresh if the notice changed.';

  @override
  String get driverWsConnectionRequired =>
      'Submission requires a connection so the current notice and your access can be checked.';

  @override
  String get driverWsDraftSaved => 'Draft saved. It has not been submitted.';

  @override
  String get driverWsDraftSaveError => 'Draft could not be saved.';

  @override
  String get driverWsSaveDraft => 'Save draft on this device';

  @override
  String get driverWsReviewDisclaimer =>
      'Approval records the reviewed arrangement. It does not execute payment or payroll deduction. Record only verified payments.';

  @override
  String get driverWsSaving => 'Saving...';

  @override
  String get driverWsSubmit => 'Submit';

  @override
  String get driverWsErrResolution => 'Choose a resolution.';

  @override
  String get driverWsErrExplanation =>
      'Explain your request, including the proposed arrangement.';

  @override
  String get driverWsErrPaymentReference => 'Enter your payment reference.';

  @override
  String get driverWsErrProposedDate => 'Choose your proposed payment date.';

  @override
  String get driverWsErrSignature =>
      'Review the statement and sign before submitting.';

  @override
  String get driverWsOptionsError => 'Options unavailable. Try again.';

  @override
  String get driverWsSearch => 'Search';

  @override
  String get driverWsClearSelection => 'None / clear selection';

  @override
  String get driverWsPreviousOptions => 'Previous options';

  @override
  String get driverWsMoreOptions => 'More options';

  @override
  String get driverWsFieldEmployeeId => 'Employee ID';

  @override
  String get driverWsFieldDriverName => 'Driver name';

  @override
  String get driverWsFieldCountry => 'Country';

  @override
  String get driverWsFieldSite => 'Site';

  @override
  String get driverWsFieldLoginAccount => 'Login account (none removes link)';

  @override
  String get driverWsFieldIdentityReason => 'Identity verification / reason';

  @override
  String get driverWsFieldSupervisor => 'Supervisor';

  @override
  String get driverWsFieldManager => 'Manager';

  @override
  String get driverWsFieldVehicle => 'Vehicle';

  @override
  String get driverWsFieldAssignmentReason => 'Assignment reason';

  @override
  String get driverWsFieldAuthority => 'Issuing authority';

  @override
  String get driverWsFieldNoticeReference => 'Notice reference';

  @override
  String get driverWsFieldIncidentAt =>
      'Incident date and time (YYYY-MM-DDTHH:mm)';

  @override
  String get driverWsFieldDueDate => 'Due date (YYYY-MM-DD)';

  @override
  String get driverWsFieldAmount => 'Fine amount';

  @override
  String get driverWsFieldCurrency => 'Currency code';

  @override
  String get driverWsFieldNoticeDetails => 'Notice details';

  @override
  String get driverWsFieldAssignmentEvidence =>
      'Evidence confirming driver assignment';

  @override
  String get driverWsFieldRecordType => 'Record type';

  @override
  String get driverWsFieldExistingRecord => 'Existing record';

  @override
  String get driverWsFieldIdentityMethod => 'How driver identity was verified';

  @override
  String get driverWsFieldResolution => 'Preferred resolution';

  @override
  String get driverWsFieldExplanation => 'Explanation / proposed arrangement';

  @override
  String get driverWsFieldPaymentReference => 'Payment reference (if paid)';

  @override
  String get driverWsFieldProposedDate => 'Proposed payment date (YYYY-MM-DD)';

  @override
  String get driverWsFieldDecision => 'Decision';

  @override
  String get driverWsFieldReviewReason =>
      'Review reason / approved arrangement';

  @override
  String get driverWsFieldVerifiedReference => 'Verified payment reference';

  @override
  String get driverWsFieldVerifiedAmount => 'Verified payment amount';

  @override
  String get driverWsPdfColNotice => 'Notice';

  @override
  String get driverWsPdfColCurrency => 'Currency';

  @override
  String get driverWsPdfColAmount => 'Amount';

  @override
  String get driverWsPdfColPaid => 'Paid';

  @override
  String get driverWsPdfColStatus => 'Status';

  @override
  String get driverWsPdfColResponse => 'Response';

  @override
  String driverWsDriverSubtitle(String site, String open, String awaiting) {
    return '$site · $open open fines · $awaiting awaiting response';
  }

  @override
  String driverWsOutstanding(String amount, String currency) {
    return 'Outstanding: $amount $currency';
  }

  @override
  String driverWsSupervisorLine(String name) {
    return 'Supervisor: $name';
  }

  @override
  String driverWsManagerLine(String name) {
    return 'Manager: $name';
  }

  @override
  String driverWsAssignmentPeriod(String start, String end) {
    return '$start to $end';
  }

  @override
  String driverWsAssignmentLine(String reason) {
    return 'Assignment: $reason';
  }

  @override
  String driverWsDueLine(String due, String paid) {
    return 'Due: $due · Paid: $paid';
  }

  @override
  String driverWsPdfTitle(String name) {
    return 'Driver statement: $name';
  }

  @override
  String driverWsPdfEmployeeId(String id) {
    return 'Employee ID: $id';
  }

  @override
  String get vehicleClassTransitMixer => 'Transit mixer';

  @override
  String get vehicleClassConcretePump => 'Concrete pump';

  @override
  String get vehicleClassLinePump => 'Truck-mounted line pump';

  @override
  String get vehicleClassStaffBus => 'Staff bus';

  @override
  String get vehicleClassStaffVan => 'Staff van';

  @override
  String get vehicleClassDoubleCabPickup => 'Double-cab pickup';

  @override
  String get vehicleClassWheelLoader => 'Wheel loader';

  @override
  String get vehicleClassSkidSteerLoader => 'Skid-steer loader';

  @override
  String get vehicleClassTowablePump => 'Towable concrete pump';

  @override
  String get vehicleClassStationaryPump => 'Stationary concrete pump';

  @override
  String get vehicleClassGenerator => 'Enclosed generator';

  @override
  String get vehicleClassChiller => 'Industrial chiller';

  @override
  String get vehicleClassWaterChiller => 'Industrial water chiller';

  @override
  String get vehicleClassBatchingPlant => 'Concrete batching plant';

  @override
  String get vehicleClassPlacingBoom => 'Freestanding placing boom';

  @override
  String vehicleClassConcretePumpAxles(int axles) {
    return 'Concrete pump · $axles axle';
  }

  @override
  String vehicleClassLinePumpAxles(int axles) {
    return 'Truck-mounted line pump · $axles axle';
  }

  @override
  String get scannerCameraStartFailedTitle => 'The camera could not start';

  @override
  String get scannerCameraStartFailedMessage =>
      'Another app may be using it, or it stopped unexpectedly. Try again, or type the code below.';

  @override
  String get managementOverviewSiteRollup => 'Sites at a glance';

  @override
  String get managementOverviewSiteRollupEmpty =>
      'No site has recorded tyres in this period.';

  @override
  String get managementOverviewAtRiskShare => 'Tyres at high or critical risk';

  @override
  String get managementReportsShare => 'Share report PDF';

  @override
  String get managementReportsShareError =>
      'The report could not be shared. Try again.';

  @override
  String get managementReportsPdfMetric => 'Metric';

  @override
  String get managementReportsPdfValue => 'Value';

  @override
  String get managementReportsPdfShare => 'Share';

  @override
  String get managementTeamRole => 'Role';

  @override
  String get managementTeamUsername => 'Username';

  @override
  String get managementTeamSite => 'Site';

  @override
  String get managementTeamCountry => 'Country';

  @override
  String get managementTeamPhone => 'Phone';

  @override
  String get managementTeamEmail => 'Email';

  @override
  String get managementTeamStatus => 'Status';

  @override
  String get managementTeamApproved => 'Approved';

  @override
  String get managementTeamLastLogin => 'Last sign-in';

  @override
  String get managementTeamNotRecorded => 'Not recorded';

  @override
  String get managementTeamCall => 'Call';

  @override
  String get managementTeamSendEmail => 'Send email';

  @override
  String get managementTeamActionError =>
      'This action is not available on this device.';

  @override
  String managementOverviewSiteTyres(String count) {
    return '$count tyres';
  }

  @override
  String managementOverviewSiteShare(String percent) {
    return '$percent% of fleet tyres';
  }

  @override
  String managementReportsPdfPeriod(int days) {
    return 'Period: last $days days';
  }

  @override
  String managementReportsPdfCurrency(String code) {
    return 'Currency: $code';
  }

  @override
  String get adminHubTitle => 'Admin console';

  @override
  String get adminHubSubtitle => 'Users, access, approvals and sites';

  @override
  String get adminHubPendingApprovals => 'Pending approvals';

  @override
  String get adminHubPendingSignups => 'Pending sign-ups';

  @override
  String get adminHubLockedUsers => 'Locked users';

  @override
  String get adminHubCountUnavailable => 'Could not load';

  @override
  String get adminHubSectionManage => 'Manage';

  @override
  String get adminHubSectionMore => 'Reports and team';

  @override
  String get adminHubUsersTitle => 'Users';

  @override
  String get adminHubUsersSubtitle => 'Approve, lock and change roles';

  @override
  String get adminHubAccessTitle => 'Mobile access';

  @override
  String get adminHubAccessSubtitle => 'Allow or deny app modules per person';

  @override
  String get adminHubApprovalsTitle => 'Approvals';

  @override
  String get adminHubApprovalsSubtitle =>
      'Inspections and checklists waiting for sign-off';

  @override
  String get adminHubSitesTitle => 'Sites';

  @override
  String get adminHubSitesSubtitle => 'Regions and active status';

  @override
  String get adminHubAiTitle => 'Fleet AI chat';

  @override
  String get adminHubAiSubtitle => 'Ask questions about fleet management';

  @override
  String get adminHubOpenModule => 'Open this module';

  @override
  String get adminModuleInspect => 'New Inspection';

  @override
  String get adminModuleScan => 'Scan';

  @override
  String get adminModuleSerial => 'Serial Search';

  @override
  String get adminModuleTyreChange => 'Tyre Change';

  @override
  String get adminModuleChecklists => 'Checklists';

  @override
  String get adminModuleMeter => 'Meter Log';

  @override
  String get adminModuleWashing => 'Vehicle Washing';

  @override
  String get adminModuleReportIssue => 'Report Issue';

  @override
  String get adminModuleRepairRequest => 'Repair Request';

  @override
  String get adminModuleRecords => 'Tyre Records';

  @override
  String get adminModuleVehicles => 'Vehicles';

  @override
  String get adminModuleHistory => 'History';

  @override
  String get adminModuleAlerts => 'Alerts';

  @override
  String get adminModuleCalendar => 'Calendar';

  @override
  String get adminModuleAccidents => 'Accidents';

  @override
  String get adminModuleReportAccident => 'File Accident';

  @override
  String get adminModuleWorkorders => 'Work Orders';

  @override
  String get adminModuleRca => 'Root Cause';

  @override
  String get adminModuleTasks => 'Tasks';

  @override
  String get adminModuleStock => 'Stock Count';

  @override
  String get adminModulePm => 'Maintenance Due';

  @override
  String get adminModuleWorkshop => 'My Jobs';

  @override
  String get adminModuleOverview => 'Overview';

  @override
  String get adminModuleReports => 'Reports';

  @override
  String get adminModuleAnalytics => 'Analytics';

  @override
  String get adminModuleStockManage => 'Stock Management';

  @override
  String get adminModuleAi => 'Fleet AI';

  @override
  String get adminModuleTeam => 'Team';

  @override
  String get adminModuleApprovals => 'Approvals';

  @override
  String get adminModuleAdmin => 'Admin Console';

  @override
  String get adminModuleUsers => 'User Management';

  @override
  String get adminUsersTitle => 'Users';

  @override
  String adminUsersCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count users',
      one: '1 user',
    );
    return '$_temp0';
  }

  @override
  String get adminUsersSearchHint => 'Search name, username or employee ID';

  @override
  String get adminUsersFilterAll => 'All';

  @override
  String get adminUsersStatusPending => 'Pending';

  @override
  String get adminUsersStatusActive => 'Active';

  @override
  String get adminUsersStatusLocked => 'Locked';

  @override
  String get adminUsersAllRoles => 'All roles';

  @override
  String get adminUsersEmptyTitle => 'No users match';

  @override
  String get adminUsersEmptyMessage => 'Try another search or filter.';

  @override
  String get adminUsersLoadFailed => 'Could not load users.';

  @override
  String get adminUsersReadOnlyNote =>
      'Only a super admin can change users. You can view the list.';

  @override
  String get adminUsersSelfNote =>
      'This is your own account. You cannot lock it or change its role.';

  @override
  String get adminUsersNoName => 'Unnamed user';

  @override
  String get adminUsersNoRole => 'No role assigned';

  @override
  String get adminUsersSuperAdminBadge => 'Super admin';

  @override
  String get adminUsersFieldRole => 'Role';

  @override
  String get adminUsersFieldUsername => 'Username';

  @override
  String get adminUsersFieldEmployeeId => 'Employee ID';

  @override
  String get adminUsersFieldEmail => 'Email';

  @override
  String get adminUsersFieldSite => 'Site';

  @override
  String get adminUsersFieldCountry => 'Country';

  @override
  String get adminUsersFieldJoined => 'Joined';

  @override
  String get adminUsersFieldPendingReason => 'Sign-up note';

  @override
  String get adminUsersActionApprove => 'Approve';

  @override
  String get adminUsersActionLock => 'Lock';

  @override
  String get adminUsersActionUnlock => 'Unlock';

  @override
  String get adminUsersActionDeactivate => 'Deactivate';

  @override
  String get adminUsersActionSetRole => 'Change role';

  @override
  String get adminUsersConfirmApproveTitle => 'Approve this user?';

  @override
  String adminUsersConfirmApproveMessage(String name) {
    return '$name will be able to sign in and use the app.';
  }

  @override
  String get adminUsersConfirmLockTitle => 'Lock this user?';

  @override
  String adminUsersConfirmLockMessage(String name) {
    return '$name will not be able to sign in until unlocked.';
  }

  @override
  String get adminUsersConfirmUnlockTitle => 'Unlock this user?';

  @override
  String adminUsersConfirmUnlockMessage(String name) {
    return '$name will be able to sign in again.';
  }

  @override
  String get adminUsersDeactivateTitle => 'Deactivate this user';

  @override
  String adminUsersDeactivateMessage(String name) {
    return '$name will lose access and be locked. A reason is required.';
  }

  @override
  String get adminUsersSetRoleTitle => 'Change role';

  @override
  String adminUsersSetRoleMessage(String name) {
    return 'Choose the new role for $name. A reason is required.';
  }

  @override
  String get adminUsersReasonLabel => 'Reason';

  @override
  String get adminUsersReasonRequired => 'Enter a reason.';

  @override
  String get adminUsersRoleRequired => 'Choose a role.';

  @override
  String get adminUsersActionDone => 'Saved.';

  @override
  String get adminUsersActionFailed => 'Could not save the change.';

  @override
  String get adminAccessTitle => 'Mobile access';

  @override
  String get adminAccessPickUser => 'Choose a person';

  @override
  String get adminAccessChangeUser => 'Change person';

  @override
  String get adminAccessIntro =>
      'Overrides apply to this person\'s mobile app only. Default follows their role.';

  @override
  String get adminAccessDefault => 'Default';

  @override
  String get adminAccessAllow => 'Allow';

  @override
  String get adminAccessDeny => 'Deny';

  @override
  String get adminAccessRoleDefaultAllowed => 'Role default: allowed';

  @override
  String get adminAccessRoleDefaultDenied => 'Role default: not allowed';

  @override
  String get adminAccessRoleDefaultAdminOnly => 'Admins only by default';

  @override
  String get adminAccessAdminNote =>
      'Admins and super admins always keep full access.';

  @override
  String get adminAccessReadOnlyNote => 'Only a super admin can change access.';

  @override
  String get adminAccessLoadFailed => 'Could not load this person\'s access.';

  @override
  String get adminAccessSaveFailed => 'Could not update access.';

  @override
  String get adminAccessSaved => 'Access updated.';

  @override
  String get adminAccessGroupField => 'Field';

  @override
  String get adminAccessGroupFleet => 'Fleet';

  @override
  String get adminAccessGroupMaintenance => 'Maintenance';

  @override
  String get adminAccessGroupManagement => 'Management';

  @override
  String get adminAccessGroupAdmin => 'Admin';

  @override
  String get adminApprovalsTabInspections => 'Inspections';

  @override
  String get adminApprovalsTabChecklists => 'Checklists';

  @override
  String get adminSitesTitle => 'Sites';

  @override
  String adminSitesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count sites',
      one: '1 site',
    );
    return '$_temp0';
  }

  @override
  String get adminSitesSearchHint => 'Search site, region or code';

  @override
  String get adminSitesActive => 'Active';

  @override
  String get adminSitesInactive => 'Inactive';

  @override
  String get adminSitesNoRegion => 'No region';

  @override
  String get adminSitesEmptyTitle => 'No sites';

  @override
  String get adminSitesEmptyMessage =>
      'No sites are registered for your organisation yet.';

  @override
  String get adminSitesLoadFailed => 'Could not load sites.';

  @override
  String get adminSitesReadOnlyNote =>
      'Only an Admin or Manager can edit sites.';

  @override
  String get adminSitesEditTitle => 'Edit site';

  @override
  String get adminSitesRegionLabel => 'Region';

  @override
  String get adminSitesActiveLabel => 'Active site';

  @override
  String get adminSitesSave => 'Save';

  @override
  String get adminSitesSaved => 'Site updated.';

  @override
  String get adminSitesSaveFailed => 'Could not update the site.';

  @override
  String get adminAiTitle => 'Fleet AI chat';

  @override
  String get adminAiSubtitle =>
      'Answers come from the AI service. Check important figures in the app.';

  @override
  String get adminAiHint => 'Ask about fleet management';

  @override
  String get adminAiSend => 'Send';

  @override
  String get adminAiClear => 'Clear chat';

  @override
  String get adminAiEmptyTitle => 'Ask a question';

  @override
  String get adminAiEmptyMessage =>
      'For example, how to reduce tyre cost per kilometre.';

  @override
  String get adminAiThinking => 'Thinking';

  @override
  String get adminAiYou => 'You';

  @override
  String get adminAiAssistant => 'Fleet AI';

  @override
  String get adminAiErrorDisabled =>
      'AI features are turned off by your administrator.';

  @override
  String get adminAiErrorBudget => 'The monthly AI budget has been reached.';

  @override
  String get adminAiErrorRateLimit =>
      'Too many requests. Wait a moment and try again.';

  @override
  String get adminAiErrorEmpty => 'The AI service returned no answer.';

  @override
  String get adminAiErrorUnavailable =>
      'The AI service is unavailable right now. Try again shortly.';

  @override
  String get extrasFleetAiTitle => 'Fleet AI';

  @override
  String get extrasFleetAiSubtitle => 'Answers from your live fleet data';

  @override
  String get extrasFleetAiSnapshotLoading => 'Reading live fleet data';

  @override
  String get extrasFleetAiNoData =>
      'Live fleet data could not be read, so the assistant cannot answer from your records right now.';

  @override
  String extrasFleetAiGroundedOn(int n) {
    return 'Based on $n of 5 live fleet counts';
  }

  @override
  String get extrasFleetAiEmptyTitle => 'Ask about your fleet';

  @override
  String get extrasFleetAiEmptyMessage =>
      'The assistant answers only from live counts of your fleet. It will say when something is not available here.';

  @override
  String get extrasFleetAiSuggestedTitle => 'Try asking';

  @override
  String get extrasFleetAiSuggestOverview => 'Give me a fleet health overview';

  @override
  String get extrasFleetAiSuggestRisk =>
      'How many tyres are at critical or high risk?';

  @override
  String get extrasFleetAiSuggestActions => 'What needs my attention first?';

  @override
  String get extrasFleetAiSuggestAccidents =>
      'How many accidents were reported in the last 30 days?';

  @override
  String get extrasFleetAiInputHint => 'Ask a question about your fleet';

  @override
  String get extrasFleetAiSend => 'Send';

  @override
  String get extrasFleetAiThinking => 'Thinking';

  @override
  String get extrasFleetAiClear => 'Clear conversation';

  @override
  String get extrasFleetAiDisclaimer =>
      'AI answers can be wrong. Check important figures in the app before acting.';

  @override
  String get extrasFleetAiYou => 'You';

  @override
  String get extrasFleetAiErrDisabled =>
      'AI features are switched off by your administrator.';

  @override
  String get extrasFleetAiErrBudget =>
      'The monthly AI budget has been reached. Contact your administrator.';

  @override
  String get extrasFleetAiErrRateLimited =>
      'Too many questions in a short time. Wait a moment and try again.';

  @override
  String get extrasFleetAiErrOffline =>
      'No connection. Your question was not sent.';

  @override
  String get extrasFleetAiErrUnavailable =>
      'The assistant is unavailable right now. Try again shortly.';

  @override
  String get repairReqCatEngine => 'Engine';

  @override
  String get repairReqCatTransmission => 'Transmission';

  @override
  String get repairReqCatBrakes => 'Brakes';

  @override
  String get repairReqCatTyres => 'Tyres';

  @override
  String get repairReqCatHydraulics => 'Hydraulics';

  @override
  String get repairReqCatElectrical => 'Electrical';

  @override
  String get repairReqCatBody => 'Body';

  @override
  String get repairReqCatDrumMixer => 'Drum / Mixer';

  @override
  String get repairReqCatPump => 'Pump';

  @override
  String get repairReqCatAirSystem => 'Air system';

  @override
  String get repairReqCatCooling => 'Cooling';

  @override
  String get repairReqCatOther => 'Other';

  @override
  String get repairReqTitle => 'Repair request';

  @override
  String get repairReqSubtitle => 'Report a fault to the workshop';

  @override
  String get repairReqMachine => 'Machine';

  @override
  String get repairReqChooseAsset => 'Choose the machine';

  @override
  String get repairReqSelect => 'Select';

  @override
  String get repairReqChange => 'Change';

  @override
  String repairReqPlate(String plate) {
    return 'Plate $plate';
  }

  @override
  String get repairReqErrAsset => 'Choose the machine that has the fault.';

  @override
  String get repairReqSite => 'Site';

  @override
  String get repairReqSiteHint => 'Filled from the machine\'s registered site';

  @override
  String get repairReqCategory => 'What is wrong';

  @override
  String get repairReqDescription => 'Describe the fault';

  @override
  String get repairReqDescriptionHint => 'What happened, what you see or hear';

  @override
  String get repairReqErrDescription => 'Describe the fault before sending.';

  @override
  String get repairReqPriority => 'Priority';

  @override
  String get repairReqOdometer => 'Odometer (km)';

  @override
  String get repairReqEngineHours => 'Engine hours';

  @override
  String get repairReqOptional => 'Optional';

  @override
  String get repairReqErrMeter =>
      'Enter a number of zero or more, or leave it blank.';

  @override
  String get repairReqOnlineNote =>
      'This request is sent straight to the workshop and needs a connection. The office issues the RFR number.';

  @override
  String get repairReqSubmit => 'Send repair request';

  @override
  String get repairReqErrNoProfile =>
      'Your profile is not loaded yet. Try again in a moment.';

  @override
  String get repairReqErrOffline =>
      'No connection. Nothing was sent. Your entries are kept, send again when you have signal.';

  @override
  String get repairReqErrPermission =>
      'Your account is not allowed to raise repair requests. Contact your administrator.';

  @override
  String get repairReqErrFailed =>
      'The request could not be sent. Your entries are kept, try again.';

  @override
  String get repairReqSentTitle => 'Repair request sent';

  @override
  String repairReqSentWithNumber(String rfr) {
    return 'The workshop has it as $rfr.';
  }

  @override
  String get repairReqSentNoNumber =>
      'The workshop has it. The office will issue the RFR number.';

  @override
  String get repairReqAnother => 'Raise another';

  @override
  String get repairReqDone => 'Done';

  @override
  String get repairReqSearchHint => 'Search by asset, plate, type or site';

  @override
  String get repairReqNoAssets => 'No machines are registered for your scope.';

  @override
  String get repairReqNoMatch => 'No machine matches that search.';

  @override
  String repairReqRefineSearch(int n) {
    return '$n machines match. Type more to narrow the list.';
  }

  @override
  String get repairReqCachedList =>
      'Offline: showing the fleet saved on this device.';

  @override
  String get registerTitle => 'Create account';

  @override
  String get registerChecking => 'Checking whether registration is open';

  @override
  String get registerUnreachableTitle => 'Cannot reach the server';

  @override
  String get registerUnreachableMessage =>
      'Registration needs a connection. Check your signal and try again.';

  @override
  String get registerClosedTitle => 'Registration is closed';

  @override
  String get registerClosedMessage =>
      'Accounts are created by your administrator. Contact your administrator to be invited.';

  @override
  String get registerBackToSignIn => 'Back to sign in';

  @override
  String get registerDoneTitle => 'Account created';

  @override
  String get registerDoneMessage =>
      'Your account is waiting for approval. Your administrator will assign your role and site, then you can sign in.';

  @override
  String get registerIntro =>
      'Request an account with your username and employee ID. An administrator approves it and sets your role and site.';

  @override
  String get registerFullName => 'Full name';

  @override
  String get registerOptional => 'Optional';

  @override
  String get registerUsername => 'Username';

  @override
  String get registerUsernameHelp =>
      'At least 3 characters: letters, numbers, dot, underscore or hyphen';

  @override
  String get registerEmployeeId => 'Employee ID';

  @override
  String get registerPassword => 'Password';

  @override
  String registerPasswordHelp(int n) {
    return 'At least $n characters';
  }

  @override
  String get registerConfirm => 'Confirm password';

  @override
  String get registerShowPassword => 'Show password';

  @override
  String get registerHidePassword => 'Hide password';

  @override
  String get registerApprovalNote =>
      'You cannot choose a role or site here. New accounts start pending until an administrator approves them.';

  @override
  String get registerSubmit => 'Request account';

  @override
  String get registerHaveAccount => 'Already have an account? Sign in';

  @override
  String get registerErrUsernameShort =>
      'Enter a username of at least 3 characters.';

  @override
  String get registerErrUsernameChars =>
      'Use only letters, numbers, dot, underscore or hyphen.';

  @override
  String get registerErrEmployeeId => 'Enter your employee ID.';

  @override
  String registerErrPasswordShort(int n) {
    return 'The password needs at least $n characters.';
  }

  @override
  String get registerErrMismatch => 'The passwords do not match.';

  @override
  String get registerErrTaken =>
      'That username or employee ID is already taken. Choose another.';

  @override
  String get registerErrOffline =>
      'No connection. Your account was not created. Try again when you have signal.';

  @override
  String get registerErrFailed =>
      'Your account could not be created. Try again.';

  @override
  String get loginCreateAccount => 'Create an account';
}
