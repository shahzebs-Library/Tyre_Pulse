import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_en.dart';
import 'app_localizations_ur.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en'),
    Locale('ur')
  ];

  /// Application name. Shown in the task switcher.
  ///
  /// In en, this message translates to:
  /// **'Tyre Pulse'**
  String get appTitle;

  /// Leaves the current screen and returns to where the user came from.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get actionBack;

  /// Repeats the operation that just failed.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get actionRetry;

  /// No description provided for @actionClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get actionClose;

  /// No description provided for @actionCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get actionCancel;

  /// No description provided for @actionSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get actionSignIn;

  /// No description provided for @actionSignOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get actionSignOut;

  /// Opens the app store listing so the user can install a newer build.
  ///
  /// In en, this message translates to:
  /// **'Open the store'**
  String get actionOpenStore;

  /// Clears the text typed into a search field.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get actionClear;

  /// Shown where a number would be, when the number was never measured. Spec section 32: never show 0 for something that was not measured.
  ///
  /// In en, this message translates to:
  /// **'Unavailable'**
  String get valueUnavailable;

  /// The placeholder that stands in for an unmeasured value. A hyphen, not a zero.
  ///
  /// In en, this message translates to:
  /// **'-'**
  String get valueNotMeasured;

  /// The only state that is allowed to show a spinner.
  ///
  /// In en, this message translates to:
  /// **'Loading'**
  String get stateLoading;

  /// No description provided for @stateEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'Nothing here yet'**
  String get stateEmptyTitle;

  /// No description provided for @stateEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'When there is something to show, it will appear here.'**
  String get stateEmptyMessage;

  /// No description provided for @stateErrorTitle.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong'**
  String get stateErrorTitle;

  /// No description provided for @stateErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'The last action did not finish. Nothing was changed.'**
  String get stateErrorMessage;

  /// No description provided for @stateOfflineCachedTitle.
  ///
  /// In en, this message translates to:
  /// **'Showing saved data'**
  String get stateOfflineCachedTitle;

  /// No description provided for @stateOfflineCachedMessage.
  ///
  /// In en, this message translates to:
  /// **'You are offline. This is the copy saved on this device, so it may be out of date.'**
  String get stateOfflineCachedMessage;

  /// When the cached copy was taken.
  ///
  /// In en, this message translates to:
  /// **'Saved {timestamp}'**
  String stateOfflineCachedAt(String timestamp);

  /// No description provided for @stateBackendUnavailableTitle.
  ///
  /// In en, this message translates to:
  /// **'The server is not responding'**
  String get stateBackendUnavailableTitle;

  /// No description provided for @stateBackendUnavailableMessage.
  ///
  /// In en, this message translates to:
  /// **'Your work is safe on this device. It will be sent when the connection comes back.'**
  String get stateBackendUnavailableMessage;

  /// No description provided for @stateNotConfiguredTitle.
  ///
  /// In en, this message translates to:
  /// **'Not set up'**
  String get stateNotConfiguredTitle;

  /// No description provided for @stateNotConfiguredMessage.
  ///
  /// In en, this message translates to:
  /// **'This part of the app has not been set up for your organisation. Your administrator can turn it on.'**
  String get stateNotConfiguredMessage;

  /// No description provided for @stateScreenNotAvailableTitle.
  ///
  /// In en, this message translates to:
  /// **'This screen is not built yet'**
  String get stateScreenNotAvailableTitle;

  /// No description provided for @stateScreenNotAvailableMessage.
  ///
  /// In en, this message translates to:
  /// **'The navigation to it works, but the screen itself has not been written. This is a build in progress, not a fault with your account.'**
  String get stateScreenNotAvailableMessage;

  /// A refusal, never a spinner. The production test deniedIsNotASpinner exists because this was got wrong once.
  ///
  /// In en, this message translates to:
  /// **'No access to this screen'**
  String get deniedTitle;

  /// No description provided for @deniedNotGranted.
  ///
  /// In en, this message translates to:
  /// **'You do not have access to this module. Contact your administrator.'**
  String get deniedNotGranted;

  /// No description provided for @deniedAdminOnly.
  ///
  /// In en, this message translates to:
  /// **'This screen is for administrators only.'**
  String get deniedAdminOnly;

  /// No description provided for @deniedSuperAdminOnly.
  ///
  /// In en, this message translates to:
  /// **'This screen is for the platform owner only.'**
  String get deniedSuperAdminOnly;

  /// Ported from the production rule: sensitive modules fail closed when the permission lookup fails, everything else fails open.
  ///
  /// In en, this message translates to:
  /// **'Your permissions could not be read, so this screen is closed until they can be. Everything else still works.'**
  String get deniedPermissionsUnavailable;

  /// No description provided for @offlineTitle.
  ///
  /// In en, this message translates to:
  /// **'Offline'**
  String get offlineTitle;

  /// No description provided for @offlineMessage.
  ///
  /// In en, this message translates to:
  /// **'You can keep working. Everything is saved on this device.'**
  String get offlineMessage;

  /// No description provided for @syncPendingChanges.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No changes waiting} =1{1 change waiting to sync} other{{count} changes waiting to sync}}'**
  String syncPendingChanges(int count);

  /// No description provided for @syncInProgress.
  ///
  /// In en, this message translates to:
  /// **'Syncing {completed} of {total}'**
  String syncInProgress(int completed, int total);

  /// No description provided for @syncAllSynced.
  ///
  /// In en, this message translates to:
  /// **'All changes synced'**
  String get syncAllSynced;

  /// No description provided for @syncNeedsAttention.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Nothing needs attention} =1{1 item needs attention} other{{count} items need attention}}'**
  String syncNeedsAttention(int count);

  /// We could not read connectivity. Different from being offline, and said differently.
  ///
  /// In en, this message translates to:
  /// **'Connection status unknown'**
  String get syncStatusUnknown;

  /// No description provided for @sessionRestoringTitle.
  ///
  /// In en, this message translates to:
  /// **'Opening Tyre Pulse'**
  String get sessionRestoringTitle;

  /// The stored session could not be read in time. Recoverable, and must never be left as a spinner - low end handsets stall on the keystore read.
  ///
  /// In en, this message translates to:
  /// **'This is taking longer than usual'**
  String get sessionTimedOutTitle;

  /// No description provided for @sessionTimedOutMessage.
  ///
  /// In en, this message translates to:
  /// **'We could not open your saved sign in. You can try again, or sign in from the start.'**
  String get sessionTimedOutMessage;

  /// No description provided for @updateRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Update required'**
  String get updateRequiredTitle;

  /// No description provided for @updateRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'This version of Tyre Pulse is too old to keep using. Install the update to carry on.'**
  String get updateRequiredMessage;

  /// No description provided for @profileUnavailableTitle.
  ///
  /// In en, this message translates to:
  /// **'We could not load your profile'**
  String get profileUnavailableTitle;

  /// No description provided for @profileUnavailableMessage.
  ///
  /// In en, this message translates to:
  /// **'Your account details did not load, so the app cannot tell what you are allowed to do. Try again, or sign out and back in.'**
  String get profileUnavailableMessage;

  /// No description provided for @accessBlockedTitle.
  ///
  /// In en, this message translates to:
  /// **'Your account is not active'**
  String get accessBlockedTitle;

  /// No description provided for @accessBlockedMessage.
  ///
  /// In en, this message translates to:
  /// **'Your account is waiting for approval or has been locked. Your administrator can put this right.'**
  String get accessBlockedMessage;

  /// No description provided for @routeNotFoundTitle.
  ///
  /// In en, this message translates to:
  /// **'That screen does not exist'**
  String get routeNotFoundTitle;

  /// No description provided for @routeNotFoundMessage.
  ///
  /// In en, this message translates to:
  /// **'The link you followed does not point anywhere in this app.'**
  String get routeNotFoundMessage;

  /// No description provided for @tabHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get tabHome;

  /// No description provided for @tabInspect.
  ///
  /// In en, this message translates to:
  /// **'Inspect'**
  String get tabInspect;

  /// No description provided for @tabAccidents.
  ///
  /// In en, this message translates to:
  /// **'Accidents'**
  String get tabAccidents;

  /// No description provided for @tabMeter.
  ///
  /// In en, this message translates to:
  /// **'Meter'**
  String get tabMeter;

  /// No description provided for @tabWashing.
  ///
  /// In en, this message translates to:
  /// **'Washing'**
  String get tabWashing;

  /// No description provided for @tabProfile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get tabProfile;

  /// No description provided for @tabHistory.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get tabHistory;

  /// No description provided for @tabChecklists.
  ///
  /// In en, this message translates to:
  /// **'Checklists'**
  String get tabChecklists;

  /// No description provided for @tabApprovals.
  ///
  /// In en, this message translates to:
  /// **'Approvals'**
  String get tabApprovals;

  /// No description provided for @searchHint.
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get searchHint;

  /// No description provided for @dropdownHint.
  ///
  /// In en, this message translates to:
  /// **'Select'**
  String get dropdownHint;

  /// No description provided for @fieldRequired.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get fieldRequired;

  /// No description provided for @statusOk.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get statusOk;

  /// No description provided for @statusWarning.
  ///
  /// In en, this message translates to:
  /// **'Attention'**
  String get statusWarning;

  /// No description provided for @statusCritical.
  ///
  /// In en, this message translates to:
  /// **'Critical'**
  String get statusCritical;

  /// No description provided for @statusInfo.
  ///
  /// In en, this message translates to:
  /// **'Info'**
  String get statusInfo;

  /// No description provided for @statusNeutral.
  ///
  /// In en, this message translates to:
  /// **'Neutral'**
  String get statusNeutral;

  /// Deliberately not the word Unknown on its own. It says that nobody took the reading, which is different from a reading that came back neutral.
  ///
  /// In en, this message translates to:
  /// **'Not measured'**
  String get statusUnknown;

  /// No description provided for @vehiclesTitle.
  ///
  /// In en, this message translates to:
  /// **'Vehicles'**
  String get vehiclesTitle;

  /// The fleet register's row count caption.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No vehicles in fleet} =1{1 vehicle in fleet} other{{count} vehicles in fleet}}'**
  String vehiclesCount(int count);

  /// No description provided for @vehiclesSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search asset, make, type or site'**
  String get vehiclesSearchHint;

  /// The default class-filter chip: equipment classes that carry tyres.
  ///
  /// In en, this message translates to:
  /// **'Tyre assets'**
  String get vehiclesTyreAssetsFilter;

  /// Widens the class filter to every equipment class.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get vehiclesAllFilter;

  /// No description provided for @vehiclesEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No vehicles found'**
  String get vehiclesEmptyTitle;

  /// No description provided for @vehiclesEmptySearchMessage.
  ///
  /// In en, this message translates to:
  /// **'Try a different search term.'**
  String get vehiclesEmptySearchMessage;

  /// No description provided for @vehiclesDetailSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Vehicle details'**
  String get vehiclesDetailSubtitle;

  /// Shown for a row carrying neither an asset number nor a fleet number.
  ///
  /// In en, this message translates to:
  /// **'Unknown vehicle'**
  String get vehiclesUnknownAsset;

  /// No description provided for @vehiclesFieldFleetNo.
  ///
  /// In en, this message translates to:
  /// **'Fleet number'**
  String get vehiclesFieldFleetNo;

  /// No description provided for @vehiclesFieldType.
  ///
  /// In en, this message translates to:
  /// **'Type'**
  String get vehiclesFieldType;

  /// No description provided for @vehiclesFieldMakeModel.
  ///
  /// In en, this message translates to:
  /// **'Make and model'**
  String get vehiclesFieldMakeModel;

  /// No description provided for @vehiclesFieldYear.
  ///
  /// In en, this message translates to:
  /// **'Year'**
  String get vehiclesFieldYear;

  /// No description provided for @vehiclesFieldCurrentKm.
  ///
  /// In en, this message translates to:
  /// **'Current odometer'**
  String get vehiclesFieldCurrentKm;

  /// No description provided for @vehiclesFieldOperator.
  ///
  /// In en, this message translates to:
  /// **'Operator'**
  String get vehiclesFieldOperator;

  /// No description provided for @vehiclesFieldDepartment.
  ///
  /// In en, this message translates to:
  /// **'Department'**
  String get vehiclesFieldDepartment;

  /// No description provided for @vehiclesFieldSite.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get vehiclesFieldSite;

  /// No description provided for @vehiclesFieldRegion.
  ///
  /// In en, this message translates to:
  /// **'Region'**
  String get vehiclesFieldRegion;

  /// No description provided for @vehiclesFieldCountry.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get vehiclesFieldCountry;

  /// No description provided for @vehiclesFieldTyreSize.
  ///
  /// In en, this message translates to:
  /// **'Tyre size'**
  String get vehiclesFieldTyreSize;

  /// No description provided for @vehiclesFieldRegistration.
  ///
  /// In en, this message translates to:
  /// **'Registration'**
  String get vehiclesFieldRegistration;

  /// No description provided for @vehiclesStartInspection.
  ///
  /// In en, this message translates to:
  /// **'Start inspection'**
  String get vehiclesStartInspection;

  /// No description provided for @vehiclesNotFoundTitle.
  ///
  /// In en, this message translates to:
  /// **'Vehicle not found'**
  String get vehiclesNotFoundTitle;

  /// No description provided for @vehiclesNotFoundMessage.
  ///
  /// In en, this message translates to:
  /// **'This vehicle could not be found in the fleet register. It may have been removed or reassigned to another country.'**
  String get vehiclesNotFoundMessage;

  /// Shown when the paged read hit its row cap, so the list may not be the whole fleet. Must never be silently dropped.
  ///
  /// In en, this message translates to:
  /// **'Showing part of the fleet. Narrow your search to find a specific vehicle.'**
  String get vehiclesTruncatedNotice;

  /// No description provided for @serialSearchTitle.
  ///
  /// In en, this message translates to:
  /// **'Serial Number Search'**
  String get serialSearchTitle;

  /// No description provided for @serialSearchSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Find a tyre by its serial number'**
  String get serialSearchSubtitle;

  /// No description provided for @serialSearchLabel.
  ///
  /// In en, this message translates to:
  /// **'Tyre serial number'**
  String get serialSearchLabel;

  /// No description provided for @serialSearchPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Type or paste a serial number'**
  String get serialSearchPlaceholder;

  /// No description provided for @serialSearchHelp.
  ///
  /// In en, this message translates to:
  /// **'Scanned labels, links and QR text are unwrapped automatically.'**
  String get serialSearchHelp;

  /// No description provided for @serialSearchSearching.
  ///
  /// In en, this message translates to:
  /// **'Searching for tyre...'**
  String get serialSearchSearching;

  /// No description provided for @serialSearchFound.
  ///
  /// In en, this message translates to:
  /// **'Tyre found'**
  String get serialSearchFound;

  /// No description provided for @serialSearchBrand.
  ///
  /// In en, this message translates to:
  /// **'Brand'**
  String get serialSearchBrand;

  /// No description provided for @serialSearchSize.
  ///
  /// In en, this message translates to:
  /// **'Size'**
  String get serialSearchSize;

  /// No description provided for @serialSearchPosition.
  ///
  /// In en, this message translates to:
  /// **'Position'**
  String get serialSearchPosition;

  /// No description provided for @serialSearchAsset.
  ///
  /// In en, this message translates to:
  /// **'Asset'**
  String get serialSearchAsset;

  /// No description provided for @serialSearchSite.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get serialSearchSite;

  /// No description provided for @serialSearchLastReading.
  ///
  /// In en, this message translates to:
  /// **'Last reading'**
  String get serialSearchLastReading;

  /// No description provided for @serialSearchInspectThis.
  ///
  /// In en, this message translates to:
  /// **'Inspect this tyre'**
  String get serialSearchInspectThis;

  /// No description provided for @serialSearchNoAssetNote.
  ///
  /// In en, this message translates to:
  /// **'This tyre is not fitted to an asset, so an inspection cannot be started from here.'**
  String get serialSearchNoAssetNote;

  /// No description provided for @serialSearchEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No tyre found for that serial'**
  String get serialSearchEmptyTitle;

  /// No description provided for @serialSearchEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Check the serial number and try again. It may belong to another site, or it may not be recorded yet.'**
  String get serialSearchEmptyMessage;

  /// No description provided for @serialSearchIdleTitle.
  ///
  /// In en, this message translates to:
  /// **'Search a tyre serial number'**
  String get serialSearchIdleTitle;

  /// No description provided for @serialSearchIdleMessage.
  ///
  /// In en, this message translates to:
  /// **'Enter a serial number above to see the tyre\'s brand, size, fitted position and last reading.'**
  String get serialSearchIdleMessage;

  /// No description provided for @serialSearchScrappedBadge.
  ///
  /// In en, this message translates to:
  /// **'Scrapped'**
  String get serialSearchScrappedBadge;

  /// No description provided for @serialSearchScrapReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get serialSearchScrapReasonLabel;

  /// No description provided for @serialSearchScrapReasonPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Why is this tyre being scrapped?'**
  String get serialSearchScrapReasonPlaceholder;

  /// Opens the scrap confirmation sheet. Does not itself scrap anything - see serialSearchConfirmScrap.
  ///
  /// In en, this message translates to:
  /// **'Mark as scrap'**
  String get serialSearchMarkScrap;

  /// No description provided for @serialSearchUndoScrap.
  ///
  /// In en, this message translates to:
  /// **'Undo scrap'**
  String get serialSearchUndoScrap;

  /// No description provided for @serialSearchScrapModalTitle.
  ///
  /// In en, this message translates to:
  /// **'Scrap this tyre'**
  String get serialSearchScrapModalTitle;

  /// The explicit confirmation step inside the scrap sheet. This is the button that actually performs the scrap.
  ///
  /// In en, this message translates to:
  /// **'Confirm scrap'**
  String get serialSearchConfirmScrap;

  /// No description provided for @serialSearchUndoConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Undo this scrap?'**
  String get serialSearchUndoConfirmTitle;

  /// No description provided for @serialSearchUndoConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'This tyre will be marked active again.'**
  String get serialSearchUndoConfirmMessage;

  /// The scanner screen's app bar title.
  ///
  /// In en, this message translates to:
  /// **'Scan'**
  String get scannerTitle;

  /// Shown in place of a live camera preview when this build has no scanning package.
  ///
  /// In en, this message translates to:
  /// **'Camera scanning is not available in this build'**
  String get scannerCameraUnavailableTitle;

  /// Explains that manual entry is the real, working path today.
  ///
  /// In en, this message translates to:
  /// **'Type or paste the code from the label instead. Everything below works the same as a scan.'**
  String get scannerCameraUnavailableMessage;

  /// The reason shown by TpPermissionDeniedState once a real camera package can report a declined permission.
  ///
  /// In en, this message translates to:
  /// **'Camera access was declined. Type or paste the code from the label instead.'**
  String get scannerCameraPermissionDeniedReason;

  /// Heading above the manual code entry field.
  ///
  /// In en, this message translates to:
  /// **'Enter a code'**
  String get scannerManualEntryLabel;

  /// No description provided for @scannerCodeFieldLabel.
  ///
  /// In en, this message translates to:
  /// **'Asset or tyre code'**
  String get scannerCodeFieldLabel;

  /// No description provided for @scannerCodeFieldHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. TM514 or a tyre serial'**
  String get scannerCodeFieldHint;

  /// Submits the manually entered code for resolution.
  ///
  /// In en, this message translates to:
  /// **'Look up'**
  String get scannerLookUpAction;

  /// No description provided for @scannerNoMatchTitle.
  ///
  /// In en, this message translates to:
  /// **'No match for that code'**
  String get scannerNoMatchTitle;

  /// No description provided for @scannerNoMatchMessage.
  ///
  /// In en, this message translates to:
  /// **'Check the code and try again, or open Serial Search to look further.'**
  String get scannerNoMatchMessage;

  /// The manual-entry fallback destination for a miss, a failure, or an unresolved code.
  ///
  /// In en, this message translates to:
  /// **'Open Serial Search'**
  String get scannerOpenSerialSearchAction;

  /// Returns the scanner to its idle state after a match was shown.
  ///
  /// In en, this message translates to:
  /// **'Look up another'**
  String get scannerScanAnotherAction;

  /// No description provided for @scannerViewAssetAction.
  ///
  /// In en, this message translates to:
  /// **'View asset'**
  String get scannerViewAssetAction;

  /// No description provided for @scannerStartInspectionAction.
  ///
  /// In en, this message translates to:
  /// **'Start inspection'**
  String get scannerStartInspectionAction;

  /// No description provided for @scannerViewTyreAction.
  ///
  /// In en, this message translates to:
  /// **'View tyre'**
  String get scannerViewTyreAction;

  /// Title of the admin-only tyre records register.
  ///
  /// In en, this message translates to:
  /// **'Tyre Records'**
  String get recordsTitle;

  /// How many rows are currently loaded in the register. Deliberately a loaded count, not a total: the app never requests an exact row count from the server, so it must not imply one.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No tyre records} =1{1 tyre record shown} other{{count} tyre records shown}}'**
  String recordsShownCount(int count);

  /// No description provided for @recordsSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search asset, serial or brand'**
  String get recordsSearchHint;

  /// No description provided for @recordsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No records found'**
  String get recordsEmptyTitle;

  /// No description provided for @recordsEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Try a different search or clear your filters.'**
  String get recordsEmptyMessage;

  /// Shown in the list footer when a page AFTER the first fails. Distinct from the full-screen error state, which only covers the first page.
  ///
  /// In en, this message translates to:
  /// **'Could not load more records.'**
  String get recordsLoadMoreError;

  /// Shown in the list footer once no further page remains.
  ///
  /// In en, this message translates to:
  /// **'You have reached the end of the list.'**
  String get recordsEndOfList;

  /// No description provided for @recordsFilterTitle.
  ///
  /// In en, this message translates to:
  /// **'Filter records'**
  String get recordsFilterTitle;

  /// No description provided for @recordsRiskLevel.
  ///
  /// In en, this message translates to:
  /// **'Risk level'**
  String get recordsRiskLevel;

  /// No description provided for @recordsSite.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get recordsSite;

  /// No description provided for @recordsApplyFilters.
  ///
  /// In en, this message translates to:
  /// **'Apply filters'**
  String get recordsApplyFilters;

  /// No description provided for @recordsClearFilters.
  ///
  /// In en, this message translates to:
  /// **'Clear filters'**
  String get recordsClearFilters;

  /// Accessibility value announced for the filter button.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No active filters} =1{1 active filter} other{{count} active filters}}'**
  String recordsActiveFilters(int count);

  /// No description provided for @recordsSerialNo.
  ///
  /// In en, this message translates to:
  /// **'Serial number'**
  String get recordsSerialNo;

  /// No description provided for @recordsIssueDate.
  ///
  /// In en, this message translates to:
  /// **'Issue date'**
  String get recordsIssueDate;

  /// No description provided for @recordsCategory.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get recordsCategory;

  /// No description provided for @recordsCostPerTyre.
  ///
  /// In en, this message translates to:
  /// **'Cost per tyre'**
  String get recordsCostPerTyre;

  /// No description provided for @recordsKmFitment.
  ///
  /// In en, this message translates to:
  /// **'Km at fitment'**
  String get recordsKmFitment;

  /// No description provided for @recordsKmRemoval.
  ///
  /// In en, this message translates to:
  /// **'Km at removal'**
  String get recordsKmRemoval;

  /// No description provided for @recordsTyreLife.
  ///
  /// In en, this message translates to:
  /// **'Tyre life (km)'**
  String get recordsTyreLife;

  /// No description provided for @recordsCountry.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get recordsCountry;

  /// No description provided for @recordsDescription.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get recordsDescription;

  /// No description provided for @recordsRemarks.
  ///
  /// In en, this message translates to:
  /// **'Remarks'**
  String get recordsRemarks;

  /// Detail sheet title when the record has no asset number.
  ///
  /// In en, this message translates to:
  /// **'Tyre record'**
  String get recordsDetailFallbackTitle;

  /// Compass label above the vehicle tyre diagram.
  ///
  /// In en, this message translates to:
  /// **'FRONT'**
  String get tyreDiagramFrontLabel;

  /// No description provided for @tyreDiagramTapHint.
  ///
  /// In en, this message translates to:
  /// **'Tap a tyre to record its condition'**
  String get tyreDiagramTapHint;

  /// Tyre count appended after the vehicle type in the diagram caption.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No tyres} =1{1 tyre} other{{count} tyres}}'**
  String tyreDiagramTyreCount(int count);

  /// Lead-in above the row of chips naming which wheels are outstanding.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 tyre still needs details} other{{count} tyres still need details}}'**
  String tyreDiagramPendingLeadIn(int count);

  /// No description provided for @tyreDiagramTyrelessMessage.
  ///
  /// In en, this message translates to:
  /// **'Stationary equipment, no tyres to inspect.'**
  String get tyreDiagramTyrelessMessage;

  /// No description provided for @tyreDiagramEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'No tyre positions to display.'**
  String get tyreDiagramEmptyMessage;

  /// Appended to a wheel's accessibility label when a pressure reading is recorded.
  ///
  /// In en, this message translates to:
  /// **'pressure {value} psi'**
  String tyreDiagramPressureDetail(String value);

  /// No description provided for @tyreConditionGood.
  ///
  /// In en, this message translates to:
  /// **'Good'**
  String get tyreConditionGood;

  /// No description provided for @tyreConditionWorn.
  ///
  /// In en, this message translates to:
  /// **'Worn'**
  String get tyreConditionWorn;

  /// No description provided for @tyreConditionDamaged.
  ///
  /// In en, this message translates to:
  /// **'Damaged'**
  String get tyreConditionDamaged;

  /// No description provided for @tyreConditionPuncture.
  ///
  /// In en, this message translates to:
  /// **'Puncture'**
  String get tyreConditionPuncture;

  /// No description provided for @tyreConditionFlat.
  ///
  /// In en, this message translates to:
  /// **'Flat'**
  String get tyreConditionFlat;

  /// No description provided for @tyreConditionMissing.
  ///
  /// In en, this message translates to:
  /// **'Missing'**
  String get tyreConditionMissing;

  /// App bar title on the header step of the inspection capture wizard.
  ///
  /// In en, this message translates to:
  /// **'New inspection'**
  String get inspectionNavTitle;

  /// Step-track label for the header step (vehicle and site).
  ///
  /// In en, this message translates to:
  /// **'1'**
  String get inspectionStep1Label;

  /// Step-track label for the tyres step.
  ///
  /// In en, this message translates to:
  /// **'2'**
  String get inspectionStep2Label;

  /// Step-track label for the review and submit step.
  ///
  /// In en, this message translates to:
  /// **'3'**
  String get inspectionStep3Label;

  /// Heading above the list of draft inspections that have not yet been submitted.
  ///
  /// In en, this message translates to:
  /// **'Continue unfinished work'**
  String get inspectionResumeTitle;

  /// Progress line on a resumable draft row.
  ///
  /// In en, this message translates to:
  /// **'{filled} of {total} tyres recorded'**
  String inspectionResumeProgress(int filled, int total);

  /// Lets the inspector pick a different vehicle after one has already been selected.
  ///
  /// In en, this message translates to:
  /// **'Change'**
  String get inspectionChangeVehicleButton;

  /// No description provided for @inspectionSiteLabel.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get inspectionSiteLabel;

  /// Hint shown when no site list could be loaded, so the site is typed by hand instead.
  ///
  /// In en, this message translates to:
  /// **'Type the site name'**
  String get inspectionTypeSiteName;

  /// No description provided for @inspectionOdometerLabel.
  ///
  /// In en, this message translates to:
  /// **'Odometer (km)'**
  String get inspectionOdometerLabel;

  /// No description provided for @inspectionOdometerHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get inspectionOdometerHint;

  /// No description provided for @inspectionHourMeterLabel.
  ///
  /// In en, this message translates to:
  /// **'Hour meter'**
  String get inspectionHourMeterLabel;

  /// No description provided for @inspectionHourMeterHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get inspectionHourMeterHint;

  /// No description provided for @inspectionNextButton.
  ///
  /// In en, this message translates to:
  /// **'Next: tyre positions'**
  String get inspectionNextButton;

  /// No description provided for @inspectionVehicleSearchPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Search by asset number or type'**
  String get inspectionVehicleSearchPlaceholder;

  /// No description provided for @inspectionSearchToBeginHint.
  ///
  /// In en, this message translates to:
  /// **'Start typing to search the fleet.'**
  String get inspectionSearchToBeginHint;

  /// No description provided for @inspectionVehicleNoMatch.
  ///
  /// In en, this message translates to:
  /// **'No vehicle matches that search.'**
  String get inspectionVehicleNoMatch;

  /// No description provided for @inspectionEnterAssetManually.
  ///
  /// In en, this message translates to:
  /// **'Enter an asset number manually'**
  String get inspectionEnterAssetManually;

  /// No description provided for @inspectionManualAssetLabel.
  ///
  /// In en, this message translates to:
  /// **'Asset number'**
  String get inspectionManualAssetLabel;

  /// No description provided for @inspectionManualUseButton.
  ///
  /// In en, this message translates to:
  /// **'Use this asset'**
  String get inspectionManualUseButton;

  /// No description provided for @inspectionTyrePositionsTitle.
  ///
  /// In en, this message translates to:
  /// **'Tyre positions'**
  String get inspectionTyrePositionsTitle;

  /// Shown on a wheel position row that has not been touched.
  ///
  /// In en, this message translates to:
  /// **'Not recorded yet'**
  String get inspectionNotRecordedYet;

  /// No description provided for @inspectionValidationRecordTyre.
  ///
  /// In en, this message translates to:
  /// **'Record at least one tyre before continuing.'**
  String get inspectionValidationRecordTyre;

  /// No description provided for @inspectionTyresIncompleteLead.
  ///
  /// In en, this message translates to:
  /// **'{count} of {total} tyres still need details before you can continue.'**
  String inspectionTyresIncompleteLead(int count, int total);

  /// No description provided for @inspectionReviewButton.
  ///
  /// In en, this message translates to:
  /// **'Review and sign'**
  String get inspectionReviewButton;

  /// No description provided for @inspectionGpsCaptured.
  ///
  /// In en, this message translates to:
  /// **'Location captured'**
  String get inspectionGpsCaptured;

  /// No description provided for @inspectionGpsCapturing.
  ///
  /// In en, this message translates to:
  /// **'Getting location...'**
  String get inspectionGpsCapturing;

  /// No description provided for @inspectionGpsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Location not available'**
  String get inspectionGpsUnavailable;

  /// Retries capturing the GPS fix. Never blocks the wizard when this is not pressed.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get inspectionGpsRetry;

  /// No description provided for @inspectionReviewTitle.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get inspectionReviewTitle;

  /// No description provided for @inspectionPositionsRecorded.
  ///
  /// In en, this message translates to:
  /// **'{touched} of {total} tyre positions recorded'**
  String inspectionPositionsRecorded(int touched, int total);

  /// No description provided for @inspectionObservationsLabel.
  ///
  /// In en, this message translates to:
  /// **'Observations'**
  String get inspectionObservationsLabel;

  /// No description provided for @inspectionObservationsPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Anything else worth noting about this inspection'**
  String get inspectionObservationsPlaceholder;

  /// No description provided for @inspectionInspectorSignatureLabel.
  ///
  /// In en, this message translates to:
  /// **'Inspector signature'**
  String get inspectionInspectorSignatureLabel;

  /// No description provided for @inspectionSubmitForApproval.
  ///
  /// In en, this message translates to:
  /// **'Submit for approval'**
  String get inspectionSubmitForApproval;

  /// No description provided for @inspectionSignatureRequiredMsg.
  ///
  /// In en, this message translates to:
  /// **'A signature is required before this inspection can be submitted.'**
  String get inspectionSignatureRequiredMsg;

  /// No description provided for @inspectionSubmittedForApprovalTitle.
  ///
  /// In en, this message translates to:
  /// **'Submitted for approval'**
  String get inspectionSubmittedForApprovalTitle;

  /// Shown when the inspection could not reach the server immediately (most likely offline) but is safely queued.
  ///
  /// In en, this message translates to:
  /// **'Saved on this device'**
  String get inspectionQueuedTitle;

  /// Shown when the device was online but the server gave a definitive refusal. Still queued for retry.
  ///
  /// In en, this message translates to:
  /// **'Saved, but the server did not accept it yet'**
  String get inspectionQueuedWithWarningTitle;

  /// No description provided for @inspectionBackHome.
  ///
  /// In en, this message translates to:
  /// **'Back to Home'**
  String get inspectionBackHome;

  /// No description provided for @inspectionNewInspection.
  ///
  /// In en, this message translates to:
  /// **'New inspection'**
  String get inspectionNewInspection;

  /// No description provided for @inspectionConditionLabel.
  ///
  /// In en, this message translates to:
  /// **'Condition'**
  String get inspectionConditionLabel;

  /// No description provided for @inspectionPressureLabel.
  ///
  /// In en, this message translates to:
  /// **'Pressure (psi)'**
  String get inspectionPressureLabel;

  /// No description provided for @inspectionPressureHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 110'**
  String get inspectionPressureHint;

  /// No description provided for @inspectionTreadLabel.
  ///
  /// In en, this message translates to:
  /// **'Tread depth (mm)'**
  String get inspectionTreadLabel;

  /// No description provided for @inspectionTreadHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 8.5'**
  String get inspectionTreadHint;

  /// No description provided for @inspectionSerialLabel.
  ///
  /// In en, this message translates to:
  /// **'Tyre serial number'**
  String get inspectionSerialLabel;

  /// No description provided for @inspectionPhotoLabel.
  ///
  /// In en, this message translates to:
  /// **'Photo'**
  String get inspectionPhotoLabel;

  /// No description provided for @inspectionPhotoNone.
  ///
  /// In en, this message translates to:
  /// **'No photo taken'**
  String get inspectionPhotoNone;

  /// No description provided for @inspectionPhotoCamera.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get inspectionPhotoCamera;

  /// No description provided for @inspectionPhotoGallery.
  ///
  /// In en, this message translates to:
  /// **'Gallery'**
  String get inspectionPhotoGallery;

  /// No description provided for @inspectionNotesLabel.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get inspectionNotesLabel;

  /// No description provided for @inspectionSignatureSavedLabel.
  ///
  /// In en, this message translates to:
  /// **'Signature saved'**
  String get inspectionSignatureSavedLabel;

  /// Replaces a previously-saved signature preview with a live drawing surface. Drawing again is required before the new mark counts.
  ///
  /// In en, this message translates to:
  /// **'Draw a new signature'**
  String get inspectionSignatureRedraw;

  /// No description provided for @inspectionDetailTitle.
  ///
  /// In en, this message translates to:
  /// **'Inspection'**
  String get inspectionDetailTitle;

  /// No description provided for @inspectionNotFoundTitle.
  ///
  /// In en, this message translates to:
  /// **'Inspection not found'**
  String get inspectionNotFoundTitle;

  /// No description provided for @inspectionNotFoundMessage.
  ///
  /// In en, this message translates to:
  /// **'This inspection could not be found on this device or on the server.'**
  String get inspectionNotFoundMessage;

  /// No description provided for @inspectionStatusUnknown.
  ///
  /// In en, this message translates to:
  /// **'Unknown'**
  String get inspectionStatusUnknown;

  /// No description provided for @inspectionInspectorUnknown.
  ///
  /// In en, this message translates to:
  /// **'Inspector not recorded'**
  String get inspectionInspectorUnknown;

  /// No description provided for @inspectionSignatureMissing.
  ///
  /// In en, this message translates to:
  /// **'No signature recorded'**
  String get inspectionSignatureMissing;

  /// No description provided for @inspectionGpsSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Location'**
  String get inspectionGpsSectionTitle;

  /// Latitude and longitude, already formatted by the caller.
  ///
  /// In en, this message translates to:
  /// **'{lat}, {lng}'**
  String inspectionGpsCoordinates(String lat, String lng);

  /// No description provided for @inspectionQueueFailedLabel.
  ///
  /// In en, this message translates to:
  /// **'Sync failed'**
  String get inspectionQueueFailedLabel;

  /// No description provided for @inspectionQueuePendingLabel.
  ///
  /// In en, this message translates to:
  /// **'Waiting to sync'**
  String get inspectionQueuePendingLabel;

  /// No description provided for @inspectionRetrySyncButton.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get inspectionRetrySyncButton;

  /// No description provided for @inspectionStatusSynced.
  ///
  /// In en, this message translates to:
  /// **'Synced'**
  String get inspectionStatusSynced;

  /// No description provided for @inspectionHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'My Inspections'**
  String get inspectionHistoryTitle;

  /// No description provided for @inspectionHistoryEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No inspections yet'**
  String get inspectionHistoryEmptyTitle;

  /// No description provided for @inspectionHistoryEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Inspections you start or submit will appear here.'**
  String get inspectionHistoryEmptyMessage;

  /// No description provided for @inspectionHistoryInProgressSection.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get inspectionHistoryInProgressSection;

  /// No description provided for @inspectionHistorySubmittedSection.
  ///
  /// In en, this message translates to:
  /// **'Submitted'**
  String get inspectionHistorySubmittedSection;

  /// No description provided for @checklistAddPhotoTitle.
  ///
  /// In en, this message translates to:
  /// **'Add a photo'**
  String get checklistAddPhotoTitle;

  /// No description provided for @checklistPhotoSourceCamera.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get checklistPhotoSourceCamera;

  /// No description provided for @checklistPhotoSourceGallery.
  ///
  /// In en, this message translates to:
  /// **'Choose from gallery'**
  String get checklistPhotoSourceGallery;

  /// Label on a checklist field's remark box when a mark demands one.
  ///
  /// In en, this message translates to:
  /// **'Remark (required)'**
  String get checklistNoteRequiredLabel;

  /// No description provided for @checklistNoteLabel.
  ///
  /// In en, this message translates to:
  /// **'Remark'**
  String get checklistNoteLabel;

  /// The affirmative choice on a boolean checklist field.
  ///
  /// In en, this message translates to:
  /// **'Yes'**
  String get checklistYes;

  /// The negative choice on a boolean checklist field.
  ///
  /// In en, this message translates to:
  /// **'No'**
  String get checklistNo;

  /// No description provided for @checklistSignatureSavedLabel.
  ///
  /// In en, this message translates to:
  /// **'Signature saved'**
  String get checklistSignatureSavedLabel;

  /// No description provided for @checklistSignatureRedraw.
  ///
  /// In en, this message translates to:
  /// **'Draw a new signature'**
  String get checklistSignatureRedraw;

  /// No description provided for @checklistsHomeTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklists'**
  String get checklistsHomeTitle;

  /// No description provided for @checklistsHistoryAction.
  ///
  /// In en, this message translates to:
  /// **'My checklist history'**
  String get checklistsHistoryAction;

  /// No description provided for @checklistsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'Nothing to fill yet'**
  String get checklistsEmptyTitle;

  /// No description provided for @checklistsEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'No checklists, assignments or unfinished sheets are available for you right now.'**
  String get checklistsEmptyMessage;

  /// No description provided for @checklistsUnfinishedSection.
  ///
  /// In en, this message translates to:
  /// **'Unfinished work'**
  String get checklistsUnfinishedSection;

  /// No description provided for @checklistsAssignmentsSection.
  ///
  /// In en, this message translates to:
  /// **'Assignments due'**
  String get checklistsAssignmentsSection;

  /// No description provided for @checklistsAvailableSection.
  ///
  /// In en, this message translates to:
  /// **'Available checklists'**
  String get checklistsAvailableSection;

  /// No description provided for @checklistNoAssetLabel.
  ///
  /// In en, this message translates to:
  /// **'No asset picked yet'**
  String get checklistNoAssetLabel;

  /// Progress line on a resumable checklist draft row.
  ///
  /// In en, this message translates to:
  /// **'{filled} of {total} answered'**
  String checklistResumeProgress(int filled, int total);

  /// No description provided for @checklistHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklist history'**
  String get checklistHistoryTitle;

  /// No description provided for @checklistHistorySearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search by document, template, asset or site'**
  String get checklistHistorySearchHint;

  /// No description provided for @checklistHistoryFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get checklistHistoryFilterAll;

  /// No description provided for @checklistHistoryFilterWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting'**
  String get checklistHistoryFilterWaiting;

  /// No description provided for @checklistHistoryFilterClosed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get checklistHistoryFilterClosed;

  /// No description provided for @checklistHistoryFilterSentBack.
  ///
  /// In en, this message translates to:
  /// **'Sent back'**
  String get checklistHistoryFilterSentBack;

  /// No description provided for @checklistHistoryEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No checklist history yet'**
  String get checklistHistoryEmptyTitle;

  /// No description provided for @checklistHistoryEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Sheets you fill in will appear here, whether they are still on their way to the server or already confirmed.'**
  String get checklistHistoryEmptyMessage;

  /// No description provided for @checklistHistoryQueuedSection.
  ///
  /// In en, this message translates to:
  /// **'Still on this device'**
  String get checklistHistoryQueuedSection;

  /// No description provided for @checklistHistoryCompletedSection.
  ///
  /// In en, this message translates to:
  /// **'Confirmed'**
  String get checklistHistoryCompletedSection;

  /// No description provided for @checklistQueueFailedLabel.
  ///
  /// In en, this message translates to:
  /// **'Needs attention'**
  String get checklistQueueFailedLabel;

  /// No description provided for @checklistQueuePendingLabel.
  ///
  /// In en, this message translates to:
  /// **'Waiting to sync'**
  String get checklistQueuePendingLabel;

  /// No description provided for @checklistHistoryStatusClosed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get checklistHistoryStatusClosed;

  /// No description provided for @checklistHistoryStatusSentBack.
  ///
  /// In en, this message translates to:
  /// **'Sent back'**
  String get checklistHistoryStatusSentBack;

  /// No description provided for @checklistHistoryStatusWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting for approval'**
  String get checklistHistoryStatusWaiting;

  /// No description provided for @checklistHistoryStatusNoApproval.
  ///
  /// In en, this message translates to:
  /// **'No approval needed'**
  String get checklistHistoryStatusNoApproval;

  /// No description provided for @checklistFillLoadingTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklist'**
  String get checklistFillLoadingTitle;

  /// No description provided for @checklistSubmittedTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklist submitted'**
  String get checklistSubmittedTitle;

  /// No description provided for @checklistSubmittedMessage.
  ///
  /// In en, this message translates to:
  /// **'Your sheet is saved. It will reach the server as soon as this device is online.'**
  String get checklistSubmittedMessage;

  /// No description provided for @checklistLastSubmissionKnown.
  ///
  /// In en, this message translates to:
  /// **'This machine has a previous submission for this checklist.'**
  String get checklistLastSubmissionKnown;

  /// Advisory shown when the machine was checked on this sheet recently.
  ///
  /// In en, this message translates to:
  /// **'This machine was last checked {daysAgo} day(s) ago on this checklist.'**
  String checklistLastSubmissionDaysAgo(int daysAgo);

  /// No description provided for @checklistPrimarySignatureLabel.
  ///
  /// In en, this message translates to:
  /// **'Sign-off signature'**
  String get checklistPrimarySignatureLabel;

  /// No description provided for @checklistSubmitAction.
  ///
  /// In en, this message translates to:
  /// **'Submit checklist'**
  String get checklistSubmitAction;

  /// No description provided for @checklistSiteLabel.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get checklistSiteLabel;

  /// No description provided for @checklistPrintedNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Printed name'**
  String get checklistPrintedNameLabel;

  /// No description provided for @checklistPrintedNamePlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Type your full name'**
  String get checklistPrintedNamePlaceholder;

  /// Submit-gate summary line: how many answers are invalid or missing.
  ///
  /// In en, this message translates to:
  /// **'{count} field(s) need attention'**
  String checklistGateFieldErrors(int count);

  /// No description provided for @checklistGateSignatureErrors.
  ///
  /// In en, this message translates to:
  /// **'{count} signature(s) are required'**
  String checklistGateSignatureErrors(int count);

  /// No description provided for @checklistGateMissingNotes.
  ///
  /// In en, this message translates to:
  /// **'{count} item(s) need a remark explaining the mark'**
  String checklistGateMissingNotes(int count);

  /// No description provided for @checklistGateUnsatisfiedGroups.
  ///
  /// In en, this message translates to:
  /// **'{count} reading group(s) need at least one value'**
  String checklistGateUnsatisfiedGroups(int count);

  /// No description provided for @checklistGatePrimarySignature.
  ///
  /// In en, this message translates to:
  /// **'A signature is required to submit this sheet'**
  String get checklistGatePrimarySignature;

  /// No description provided for @inspectionApprovalsTitle.
  ///
  /// In en, this message translates to:
  /// **'Inspection Approvals'**
  String get inspectionApprovalsTitle;

  /// No description provided for @inspectionApprovalsAwaitingCount.
  ///
  /// In en, this message translates to:
  /// **'{count} awaiting sign-off'**
  String inspectionApprovalsAwaitingCount(int count);

  /// No description provided for @inspectionApprovalsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'Nothing awaiting approval'**
  String get inspectionApprovalsEmptyTitle;

  /// No description provided for @inspectionApprovalsEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Every inspection has been reviewed. Pull down to check again.'**
  String get inspectionApprovalsEmptyMessage;

  /// No description provided for @inspectionApprovalsLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Approvals could not be loaded. Check your connection and try again.'**
  String get inspectionApprovalsLoadErrorMessage;

  /// No description provided for @inspectionApprovalsPendingBadge.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get inspectionApprovalsPendingBadge;

  /// No description provided for @inspectionApprovalFallbackTitle.
  ///
  /// In en, this message translates to:
  /// **'Inspection'**
  String get inspectionApprovalFallbackTitle;

  /// No description provided for @inspectionApprovalReviewTitle.
  ///
  /// In en, this message translates to:
  /// **'Approval'**
  String get inspectionApprovalReviewTitle;

  /// No description provided for @inspectionApprovalLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'This inspection could not be loaded. Check your connection and try again.'**
  String get inspectionApprovalLoadErrorMessage;

  /// No description provided for @inspectionApprovalNotFoundMessage.
  ///
  /// In en, this message translates to:
  /// **'This inspection could not be found. It may already have been reviewed or removed.'**
  String get inspectionApprovalNotFoundMessage;

  /// No description provided for @inspectionApprovalTyreConditionsTitle.
  ///
  /// In en, this message translates to:
  /// **'Tyre conditions ({count})'**
  String inspectionApprovalTyreConditionsTitle(int count);

  /// No description provided for @inspectionApprovalNoTyreConditions.
  ///
  /// In en, this message translates to:
  /// **'No tyre conditions recorded.'**
  String get inspectionApprovalNoTyreConditions;

  /// No description provided for @inspectionApprovalYourDecisionTitle.
  ///
  /// In en, this message translates to:
  /// **'Your decision'**
  String get inspectionApprovalYourDecisionTitle;

  /// No description provided for @inspectionApprovalDecisionTitle.
  ///
  /// In en, this message translates to:
  /// **'Decision'**
  String get inspectionApprovalDecisionTitle;

  /// No description provided for @inspectionApprovalDecisionApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get inspectionApprovalDecisionApproved;

  /// No description provided for @inspectionApprovalDecisionReturned.
  ///
  /// In en, this message translates to:
  /// **'Returned to the field'**
  String get inspectionApprovalDecisionReturned;

  /// No description provided for @inspectionApprovalApprovedBy.
  ///
  /// In en, this message translates to:
  /// **'Approved by {name}'**
  String inspectionApprovalApprovedBy(String name);

  /// No description provided for @inspectionApprovalReturnedBy.
  ///
  /// In en, this message translates to:
  /// **'Returned by {name}'**
  String inspectionApprovalReturnedBy(String name);

  /// No description provided for @inspectionApprovalApproverSignatureLabel.
  ///
  /// In en, this message translates to:
  /// **'Approver signature'**
  String get inspectionApprovalApproverSignatureLabel;

  /// No description provided for @inspectionApprovalSigningAs.
  ///
  /// In en, this message translates to:
  /// **'Signing as {name}'**
  String inspectionApprovalSigningAs(String name);

  /// No description provided for @inspectionApprovalNoteLabel.
  ///
  /// In en, this message translates to:
  /// **'Note (required to return)'**
  String get inspectionApprovalNoteLabel;

  /// No description provided for @inspectionApprovalNoteHint.
  ///
  /// In en, this message translates to:
  /// **'Reason if returning to the inspector'**
  String get inspectionApprovalNoteHint;

  /// No description provided for @inspectionApprovalApproveButton.
  ///
  /// In en, this message translates to:
  /// **'Approve'**
  String get inspectionApprovalApproveButton;

  /// No description provided for @inspectionApprovalReturnButton.
  ///
  /// In en, this message translates to:
  /// **'Return'**
  String get inspectionApprovalReturnButton;

  /// No description provided for @inspectionApprovalSignatureRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Signature required'**
  String get inspectionApprovalSignatureRequiredTitle;

  /// No description provided for @inspectionApprovalSignatureRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Sign in the approver box to approve this inspection.'**
  String get inspectionApprovalSignatureRequiredMessage;

  /// No description provided for @inspectionApprovalReasonRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Reason required'**
  String get inspectionApprovalReasonRequiredTitle;

  /// No description provided for @inspectionApprovalReasonRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Add a short note so the inspector knows what to fix.'**
  String get inspectionApprovalReasonRequiredMessage;

  /// No description provided for @inspectionApprovalApprovedOutcomeTitle.
  ///
  /// In en, this message translates to:
  /// **'Inspection approved'**
  String get inspectionApprovalApprovedOutcomeTitle;

  /// No description provided for @inspectionApprovalReturnedOutcomeTitle.
  ///
  /// In en, this message translates to:
  /// **'Inspection returned'**
  String get inspectionApprovalReturnedOutcomeTitle;

  /// No description provided for @inspectionApprovalApprovedOutcomeMessage.
  ///
  /// In en, this message translates to:
  /// **'The inspection has been approved. You can review it here, or go back to the list.'**
  String get inspectionApprovalApprovedOutcomeMessage;

  /// No description provided for @inspectionApprovalReturnedOutcomeMessage.
  ///
  /// In en, this message translates to:
  /// **'The inspection has been returned to the field. You can review it here, or go back to the list.'**
  String get inspectionApprovalReturnedOutcomeMessage;

  /// No description provided for @inspectionApprovalStayHereAction.
  ///
  /// In en, this message translates to:
  /// **'Stay here'**
  String get inspectionApprovalStayHereAction;

  /// No description provided for @inspectionApprovalBackToListAction.
  ///
  /// In en, this message translates to:
  /// **'Back to list'**
  String get inspectionApprovalBackToListAction;

  /// No description provided for @inspectionApprovalSaveFailedTitle.
  ///
  /// In en, this message translates to:
  /// **'Could not save decision'**
  String get inspectionApprovalSaveFailedTitle;

  /// No description provided for @inspectionApprovalDecideGenericError.
  ///
  /// In en, this message translates to:
  /// **'Please try again.'**
  String get inspectionApprovalDecideGenericError;

  /// No description provided for @inspectionApprovalSignatureSavedLabel.
  ///
  /// In en, this message translates to:
  /// **'Signature saved'**
  String get inspectionApprovalSignatureSavedLabel;

  /// No description provided for @inspectionApprovalSignatureRedraw.
  ///
  /// In en, this message translates to:
  /// **'Draw a new signature'**
  String get inspectionApprovalSignatureRedraw;

  /// No description provided for @checklistApprovalsTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklist Approvals'**
  String get checklistApprovalsTitle;

  /// No description provided for @checklistApprovalsAwaitingCount.
  ///
  /// In en, this message translates to:
  /// **'{count} awaiting sign-off'**
  String checklistApprovalsAwaitingCount(int count);

  /// No description provided for @checklistApprovalsLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Approvals could not be loaded. Check your connection and try again.'**
  String get checklistApprovalsLoadErrorMessage;

  /// No description provided for @checklistApprovalsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'Nothing awaiting approval'**
  String get checklistApprovalsEmptyTitle;

  /// No description provided for @checklistApprovalsEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Every checklist has been reviewed. Pull down to check again.'**
  String get checklistApprovalsEmptyMessage;

  /// No description provided for @checklistApprovalsEmptyMineTitle.
  ///
  /// In en, this message translates to:
  /// **'Nothing needs you right now'**
  String get checklistApprovalsEmptyMineTitle;

  /// No description provided for @checklistApprovalsEmptyMineMessage.
  ///
  /// In en, this message translates to:
  /// **'No checklist in this queue is waiting on your signature at the moment.'**
  String get checklistApprovalsEmptyMineMessage;

  /// No description provided for @checklistApprovalsFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get checklistApprovalsFilterAll;

  /// No description provided for @checklistApprovalsFilterMine.
  ///
  /// In en, this message translates to:
  /// **'Needs me'**
  String get checklistApprovalsFilterMine;

  /// No description provided for @checklistApprovalsYourTurn.
  ///
  /// In en, this message translates to:
  /// **'Your turn'**
  String get checklistApprovalsYourTurn;

  /// No description provided for @checklistApprovalFallbackTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklist'**
  String get checklistApprovalFallbackTitle;

  /// No description provided for @checklistApprovalsBlockedTitle.
  ///
  /// In en, this message translates to:
  /// **'{count} decision(s) need attention'**
  String checklistApprovalsBlockedTitle(int count);

  /// No description provided for @checklistApprovalsBlockedMessage.
  ///
  /// In en, this message translates to:
  /// **'These decisions could not be delivered and will not be tried again automatically. Try again below, or reopen the checklist to decide again.'**
  String get checklistApprovalsBlockedMessage;

  /// No description provided for @checklistApprovalsStatusClosed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get checklistApprovalsStatusClosed;

  /// No description provided for @checklistApprovalsStatusSentBack.
  ///
  /// In en, this message translates to:
  /// **'Sent back'**
  String get checklistApprovalsStatusSentBack;

  /// No description provided for @checklistApprovalsStatusWaitingAreaManager.
  ///
  /// In en, this message translates to:
  /// **'Waiting for the area manager'**
  String get checklistApprovalsStatusWaitingAreaManager;

  /// No description provided for @checklistApprovalsStatusWaitingSupervisor.
  ///
  /// In en, this message translates to:
  /// **'Waiting for a supervisor'**
  String get checklistApprovalsStatusWaitingSupervisor;

  /// No description provided for @checklistApprovalsStatusWaitingApproval.
  ///
  /// In en, this message translates to:
  /// **'Waiting for approval'**
  String get checklistApprovalsStatusWaitingApproval;

  /// No description provided for @checklistApprovalsStatusNoApproval.
  ///
  /// In en, this message translates to:
  /// **'No approval needed'**
  String get checklistApprovalsStatusNoApproval;

  /// No description provided for @checklistApprovalReviewTitle.
  ///
  /// In en, this message translates to:
  /// **'Approval'**
  String get checklistApprovalReviewTitle;

  /// No description provided for @checklistApprovalLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'This checklist could not be loaded. Check your connection and try again.'**
  String get checklistApprovalLoadErrorMessage;

  /// No description provided for @checklistApprovalNotFoundTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklist not found'**
  String get checklistApprovalNotFoundTitle;

  /// No description provided for @checklistApprovalNotFoundMessage.
  ///
  /// In en, this message translates to:
  /// **'This checklist could not be found. It may already have been reviewed or removed.'**
  String get checklistApprovalNotFoundMessage;

  /// No description provided for @checklistApprovalSignOffsTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign-offs'**
  String get checklistApprovalSignOffsTitle;

  /// No description provided for @checklistApprovalResponsesTitle.
  ///
  /// In en, this message translates to:
  /// **'Responses'**
  String get checklistApprovalResponsesTitle;

  /// No description provided for @checklistApprovalNoResponses.
  ///
  /// In en, this message translates to:
  /// **'No responses recorded.'**
  String get checklistApprovalNoResponses;

  /// No description provided for @checklistApprovalStageFilledBy.
  ///
  /// In en, this message translates to:
  /// **'Filled by'**
  String get checklistApprovalStageFilledBy;

  /// No description provided for @checklistApprovalStageSupervisor.
  ///
  /// In en, this message translates to:
  /// **'Supervisor sign-off'**
  String get checklistApprovalStageSupervisor;

  /// No description provided for @checklistApprovalStageAreaManager.
  ///
  /// In en, this message translates to:
  /// **'Area manager approval'**
  String get checklistApprovalStageAreaManager;

  /// No description provided for @checklistApprovalStageApproval.
  ///
  /// In en, this message translates to:
  /// **'Approval'**
  String get checklistApprovalStageApproval;

  /// No description provided for @checklistApprovalNotSignedYet.
  ///
  /// In en, this message translates to:
  /// **'Not signed yet'**
  String get checklistApprovalNotSignedYet;

  /// No description provided for @checklistApprovalYourDecisionTitle.
  ///
  /// In en, this message translates to:
  /// **'Your decision'**
  String get checklistApprovalYourDecisionTitle;

  /// No description provided for @checklistApprovalSupervisorSignatureLabel.
  ///
  /// In en, this message translates to:
  /// **'Supervisor signature'**
  String get checklistApprovalSupervisorSignatureLabel;

  /// No description provided for @checklistApprovalAreaManagerSignatureLabel.
  ///
  /// In en, this message translates to:
  /// **'Area manager signature'**
  String get checklistApprovalAreaManagerSignatureLabel;

  /// No description provided for @checklistApprovalYourNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Your name'**
  String get checklistApprovalYourNameLabel;

  /// No description provided for @checklistApprovalYourNamePlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Type your name'**
  String get checklistApprovalYourNamePlaceholder;

  /// No description provided for @checklistApprovalNoteLabel.
  ///
  /// In en, this message translates to:
  /// **'Note (required to send back)'**
  String get checklistApprovalNoteLabel;

  /// No description provided for @checklistApprovalNoteHint.
  ///
  /// In en, this message translates to:
  /// **'Reason if sending this back'**
  String get checklistApprovalNoteHint;

  /// No description provided for @checklistApprovalReturnButton.
  ///
  /// In en, this message translates to:
  /// **'Send back'**
  String get checklistApprovalReturnButton;

  /// No description provided for @checklistApprovalSignOffButton.
  ///
  /// In en, this message translates to:
  /// **'Sign off'**
  String get checklistApprovalSignOffButton;

  /// No description provided for @checklistApprovalApproveAndCloseButton.
  ///
  /// In en, this message translates to:
  /// **'Approve and close'**
  String get checklistApprovalApproveAndCloseButton;

  /// No description provided for @checklistApprovalRequirementTitle.
  ///
  /// In en, this message translates to:
  /// **'Cannot sign off'**
  String get checklistApprovalRequirementTitle;

  /// No description provided for @checklistApprovalReasonRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Reason required'**
  String get checklistApprovalReasonRequiredTitle;

  /// No description provided for @checklistApprovalReasonRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Add a short note so the person who filled this in knows what to fix.'**
  String get checklistApprovalReasonRequiredMessage;

  /// No description provided for @checklistApprovalNameRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Enter your name to sign this off.'**
  String get checklistApprovalNameRequiredMessage;

  /// No description provided for @checklistApprovalSignatureRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Sign in the box above to sign this off.'**
  String get checklistApprovalSignatureRequiredMessage;

  /// No description provided for @checklistApprovalNothingToDecide.
  ///
  /// In en, this message translates to:
  /// **'This checklist has nothing left to decide.'**
  String get checklistApprovalNothingToDecide;

  /// No description provided for @checklistApprovalNotYourRung.
  ///
  /// In en, this message translates to:
  /// **'This is not for you to decide. {status}'**
  String checklistApprovalNotYourRung(String status);

  /// No description provided for @checklistApprovalSaveFailedTitle.
  ///
  /// In en, this message translates to:
  /// **'Could not save decision'**
  String get checklistApprovalSaveFailedTitle;

  /// No description provided for @checklistApprovalDecideGenericError.
  ///
  /// In en, this message translates to:
  /// **'Please try again.'**
  String get checklistApprovalDecideGenericError;

  /// No description provided for @checklistApprovalSentBackTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklist sent back'**
  String get checklistApprovalSentBackTitle;

  /// No description provided for @checklistApprovalSentBackMessage.
  ///
  /// In en, this message translates to:
  /// **'This checklist has been sent back to the field. You can review it here, or go back to the list.'**
  String get checklistApprovalSentBackMessage;

  /// No description provided for @checklistApprovalSignedOffTitle.
  ///
  /// In en, this message translates to:
  /// **'Signed off'**
  String get checklistApprovalSignedOffTitle;

  /// No description provided for @checklistApprovalSignedOffMessage.
  ///
  /// In en, this message translates to:
  /// **'Your signature has been recorded. This checklist now waits for the area manager. You can review it here, or go back to the list.'**
  String get checklistApprovalSignedOffMessage;

  /// No description provided for @checklistApprovalApprovedTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklist approved'**
  String get checklistApprovalApprovedTitle;

  /// No description provided for @checklistApprovalApprovedMessage.
  ///
  /// In en, this message translates to:
  /// **'This checklist has been approved and closed. You can review it here, or go back to the list.'**
  String get checklistApprovalApprovedMessage;

  /// No description provided for @checklistApprovalStayHereAction.
  ///
  /// In en, this message translates to:
  /// **'Stay here'**
  String get checklistApprovalStayHereAction;

  /// No description provided for @checklistApprovalBackToListAction.
  ///
  /// In en, this message translates to:
  /// **'Back to list'**
  String get checklistApprovalBackToListAction;

  /// No description provided for @checklistApprovalQueuedTitle.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get checklistApprovalQueuedTitle;

  /// No description provided for @checklistApprovalQueuedOffline.
  ///
  /// In en, this message translates to:
  /// **'Your decision is saved on this device and will be sent when you are back online.'**
  String get checklistApprovalQueuedOffline;

  /// No description provided for @checklistApprovalScoreLine.
  ///
  /// In en, this message translates to:
  /// **'Score: {pct}% ({status})'**
  String checklistApprovalScoreLine(int pct, String status);

  /// No description provided for @checklistApprovalScorePassed.
  ///
  /// In en, this message translates to:
  /// **'Passed'**
  String get checklistApprovalScorePassed;

  /// No description provided for @checklistApprovalScoreFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get checklistApprovalScoreFailed;

  /// No description provided for @checklistApprovalSignatureSavedLabel.
  ///
  /// In en, this message translates to:
  /// **'Signature saved'**
  String get checklistApprovalSignatureSavedLabel;

  /// No description provided for @checklistApprovalSignatureRedraw.
  ///
  /// In en, this message translates to:
  /// **'Draw a new signature'**
  String get checklistApprovalSignatureRedraw;

  /// No description provided for @meterLogNavTitle.
  ///
  /// In en, this message translates to:
  /// **'Daily Meter Log'**
  String get meterLogNavTitle;

  /// No description provided for @meterLogWorkspaceLoadingMessage.
  ///
  /// In en, this message translates to:
  /// **'Your workspace is still loading. Try again in a moment.'**
  String get meterLogWorkspaceLoadingMessage;

  /// No description provided for @meterLogAssetLabel.
  ///
  /// In en, this message translates to:
  /// **'Asset'**
  String get meterLogAssetLabel;

  /// No description provided for @meterLogAssetHint.
  ///
  /// In en, this message translates to:
  /// **'Type or scan the asset number'**
  String get meterLogAssetHint;

  /// No description provided for @meterLogSiteLabel.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get meterLogSiteLabel;

  /// No description provided for @meterLogSiteHint.
  ///
  /// In en, this message translates to:
  /// **'Where this reading was taken'**
  String get meterLogSiteHint;

  /// No description provided for @meterLogSiteHelp.
  ///
  /// In en, this message translates to:
  /// **'Filled in automatically from the fleet record. Change it if this reading is from a different site.'**
  String get meterLogSiteHelp;

  /// No description provided for @meterLogLastReadingChecking.
  ///
  /// In en, this message translates to:
  /// **'Checking the last reading...'**
  String get meterLogLastReadingChecking;

  /// No description provided for @meterLogLastReadingUnknown.
  ///
  /// In en, this message translates to:
  /// **'No previous reading is recorded for this asset.'**
  String get meterLogLastReadingUnknown;

  /// No description provided for @meterLogLastReadingKnown.
  ///
  /// In en, this message translates to:
  /// **'Last reading: {km} km on {date}'**
  String meterLogLastReadingKnown(String km, String date);

  /// No description provided for @meterLogOdometerLabel.
  ///
  /// In en, this message translates to:
  /// **'Odometer (km)'**
  String get meterLogOdometerLabel;

  /// No description provided for @meterLogOdometerHint.
  ///
  /// In en, this message translates to:
  /// **'Enter the reading'**
  String get meterLogOdometerHint;

  /// No description provided for @meterLogEngineHoursLabel.
  ///
  /// In en, this message translates to:
  /// **'Engine hours'**
  String get meterLogEngineHoursLabel;

  /// No description provided for @meterLogEngineHoursHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get meterLogEngineHoursHint;

  /// No description provided for @meterLogEngineHoursHelpWithHours.
  ///
  /// In en, this message translates to:
  /// **'A photo of the hour meter will be requested on the next step.'**
  String get meterLogEngineHoursHelpWithHours;

  /// No description provided for @meterLogEngineHoursHelpWithoutHours.
  ///
  /// In en, this message translates to:
  /// **'Leave this blank if the vehicle has no hour meter.'**
  String get meterLogEngineHoursHelpWithoutHours;

  /// No description provided for @meterLogNotesLabel.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get meterLogNotesLabel;

  /// No description provided for @meterLogNotesHint.
  ///
  /// In en, this message translates to:
  /// **'Anything worth recording'**
  String get meterLogNotesHint;

  /// No description provided for @meterLogSignatureLabel.
  ///
  /// In en, this message translates to:
  /// **'Signature'**
  String get meterLogSignatureLabel;

  /// No description provided for @meterLogSignatureSavedLabel.
  ///
  /// In en, this message translates to:
  /// **'Signature saved'**
  String get meterLogSignatureSavedLabel;

  /// No description provided for @meterLogSignatureRedraw.
  ///
  /// In en, this message translates to:
  /// **'Draw a new signature'**
  String get meterLogSignatureRedraw;

  /// No description provided for @meterLogContinueAction.
  ///
  /// In en, this message translates to:
  /// **'Review & Save'**
  String get meterLogContinueAction;

  /// No description provided for @meterLogAssetRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Asset needed'**
  String get meterLogAssetRequiredTitle;

  /// No description provided for @meterLogAssetRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Enter the asset before continuing.'**
  String get meterLogAssetRequiredMessage;

  /// No description provided for @meterLogReadingRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Reading needed'**
  String get meterLogReadingRequiredTitle;

  /// No description provided for @meterLogReadingRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Enter the odometer reading before continuing.'**
  String get meterLogReadingRequiredMessage;

  /// No description provided for @meterLogInvalidReadingTitle.
  ///
  /// In en, this message translates to:
  /// **'That reading does not look right'**
  String get meterLogInvalidReadingTitle;

  /// No description provided for @meterLogInvalidReadingMessage.
  ///
  /// In en, this message translates to:
  /// **'The odometer reading cannot be a negative number.'**
  String get meterLogInvalidReadingMessage;

  /// No description provided for @meterLogBelowLastTitle.
  ///
  /// In en, this message translates to:
  /// **'This reading is lower than the last one'**
  String get meterLogBelowLastTitle;

  /// No description provided for @meterLogBelowLastMessage.
  ///
  /// In en, this message translates to:
  /// **'The last reading recorded for this asset was {km} km. Saving this reading will flag it for admin review.'**
  String meterLogBelowLastMessage(String km);

  /// No description provided for @meterLogRecheckAction.
  ///
  /// In en, this message translates to:
  /// **'Re-check'**
  String get meterLogRecheckAction;

  /// No description provided for @meterLogSaveAndFlagAction.
  ///
  /// In en, this message translates to:
  /// **'Save anyway'**
  String get meterLogSaveAndFlagAction;

  /// No description provided for @meterLogBigJumpTitle.
  ///
  /// In en, this message translates to:
  /// **'That is a large jump'**
  String get meterLogBigJumpTitle;

  /// No description provided for @meterLogBigJumpMessage.
  ///
  /// In en, this message translates to:
  /// **'This is {km} km more than the last reading.'**
  String meterLogBigJumpMessage(String km);

  /// No description provided for @meterLogLogAnywayAction.
  ///
  /// In en, this message translates to:
  /// **'Log anyway'**
  String get meterLogLogAnywayAction;

  /// No description provided for @meterLogReviewTitle.
  ///
  /// In en, this message translates to:
  /// **'Confirm reading'**
  String get meterLogReviewTitle;

  /// No description provided for @meterLogPhotographGaugeLabel.
  ///
  /// In en, this message translates to:
  /// **'Photograph the gauge'**
  String get meterLogPhotographGaugeLabel;

  /// No description provided for @meterLogPhotoCamera.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get meterLogPhotoCamera;

  /// No description provided for @meterLogPhotoGallery.
  ///
  /// In en, this message translates to:
  /// **'Gallery'**
  String get meterLogPhotoGallery;

  /// No description provided for @meterLogPhotoNone.
  ///
  /// In en, this message translates to:
  /// **'No photo taken'**
  String get meterLogPhotoNone;

  /// No description provided for @meterLogPhotoRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Photo needed'**
  String get meterLogPhotoRequiredTitle;

  /// No description provided for @meterLogPhotoRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'A photo of the odometer is required before saving.'**
  String get meterLogPhotoRequiredMessage;

  /// No description provided for @meterLogSaveReadingAction.
  ///
  /// In en, this message translates to:
  /// **'Save Reading'**
  String get meterLogSaveReadingAction;

  /// No description provided for @meterLogFlaggedNote.
  ///
  /// In en, this message translates to:
  /// **'This reading is below the last one and will be flagged for admin review.'**
  String get meterLogFlaggedNote;

  /// No description provided for @meterLogSavedMessage.
  ///
  /// In en, this message translates to:
  /// **'Reading saved. It will sync automatically.'**
  String get meterLogSavedMessage;

  /// No description provided for @meterLogSavedAndFlaggedMessage.
  ///
  /// In en, this message translates to:
  /// **'Reading saved and flagged for admin review because it is below the last one.'**
  String get meterLogSavedAndFlaggedMessage;

  /// No description provided for @meterLogTryAgainFallback.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Try again.'**
  String get meterLogTryAgainFallback;

  /// No description provided for @meterLogRecentTitle.
  ///
  /// In en, this message translates to:
  /// **'Recent readings'**
  String get meterLogRecentTitle;

  /// No description provided for @meterLogRecentEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'No readings recorded yet.'**
  String get meterLogRecentEmptyMessage;

  /// No description provided for @meterLogRecentLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Recent readings could not be loaded.'**
  String get meterLogRecentLoadErrorMessage;

  /// No description provided for @meterLogRecentKmValue.
  ///
  /// In en, this message translates to:
  /// **'{km} km'**
  String meterLogRecentKmValue(String km);

  /// No description provided for @washNavTitle.
  ///
  /// In en, this message translates to:
  /// **'Vehicle Washing'**
  String get washNavTitle;

  /// No description provided for @washWorkspaceLoadingMessage.
  ///
  /// In en, this message translates to:
  /// **'Your workspace is still loading. Try again in a moment.'**
  String get washWorkspaceLoadingMessage;

  /// No description provided for @washDueTitle.
  ///
  /// In en, this message translates to:
  /// **'Due for wash'**
  String get washDueTitle;

  /// No description provided for @washDueNone.
  ///
  /// In en, this message translates to:
  /// **'Nothing is due for a wash.'**
  String get washDueNone;

  /// No description provided for @washDueToday.
  ///
  /// In en, this message translates to:
  /// **'Due today'**
  String get washDueToday;

  /// No description provided for @washDueOverdue.
  ///
  /// In en, this message translates to:
  /// **'{days} days overdue'**
  String washDueOverdue(int days);

  /// No description provided for @washDueLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'The due list could not be checked right now.'**
  String get washDueLoadErrorMessage;

  /// No description provided for @washAssetLabel.
  ///
  /// In en, this message translates to:
  /// **'Asset'**
  String get washAssetLabel;

  /// No description provided for @washAssetHint.
  ///
  /// In en, this message translates to:
  /// **'Type or scan the asset number'**
  String get washAssetHint;

  /// No description provided for @washMasterFleetNumber.
  ///
  /// In en, this message translates to:
  /// **'Fleet {fleetNo}'**
  String washMasterFleetNumber(String fleetNo);

  /// No description provided for @washSiteLabel.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get washSiteLabel;

  /// No description provided for @washSiteHint.
  ///
  /// In en, this message translates to:
  /// **'Where the vehicle is washed'**
  String get washSiteHint;

  /// No description provided for @washSiteHelp.
  ///
  /// In en, this message translates to:
  /// **'Filled in automatically from the fleet record. Change it if this wash happened at a different site.'**
  String get washSiteHelp;

  /// No description provided for @washDateLabel.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get washDateLabel;

  /// No description provided for @washDateTodayLine.
  ///
  /// In en, this message translates to:
  /// **'Today · {date}'**
  String washDateTodayLine(String date);

  /// No description provided for @washTypeLabel.
  ///
  /// In en, this message translates to:
  /// **'Wash type'**
  String get washTypeLabel;

  /// No description provided for @washTypeExterior.
  ///
  /// In en, this message translates to:
  /// **'Exterior'**
  String get washTypeExterior;

  /// No description provided for @washTypeInterior.
  ///
  /// In en, this message translates to:
  /// **'Interior'**
  String get washTypeInterior;

  /// No description provided for @washTypeFull.
  ///
  /// In en, this message translates to:
  /// **'Full'**
  String get washTypeFull;

  /// No description provided for @washTypeEngineBay.
  ///
  /// In en, this message translates to:
  /// **'Engine Bay'**
  String get washTypeEngineBay;

  /// No description provided for @washTypeUndercarriage.
  ///
  /// In en, this message translates to:
  /// **'Undercarriage'**
  String get washTypeUndercarriage;

  /// No description provided for @washTypeSteam.
  ///
  /// In en, this message translates to:
  /// **'Steam'**
  String get washTypeSteam;

  /// No description provided for @washTypeWaterless.
  ///
  /// In en, this message translates to:
  /// **'Waterless'**
  String get washTypeWaterless;

  /// No description provided for @washStatusLabel.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get washStatusLabel;

  /// No description provided for @washStatusInProgress.
  ///
  /// In en, this message translates to:
  /// **'In Progress'**
  String get washStatusInProgress;

  /// No description provided for @washStatusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get washStatusCompleted;

  /// No description provided for @washPhotosLabel.
  ///
  /// In en, this message translates to:
  /// **'Photos'**
  String get washPhotosLabel;

  /// No description provided for @washAddPhoto.
  ///
  /// In en, this message translates to:
  /// **'Add photo'**
  String get washAddPhoto;

  /// No description provided for @washPhotoCamera.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get washPhotoCamera;

  /// No description provided for @washPhotoGallery.
  ///
  /// In en, this message translates to:
  /// **'Gallery'**
  String get washPhotoGallery;

  /// No description provided for @washDetailsLabel.
  ///
  /// In en, this message translates to:
  /// **'Details'**
  String get washDetailsLabel;

  /// No description provided for @washOperatorLabel.
  ///
  /// In en, this message translates to:
  /// **'Operator name'**
  String get washOperatorLabel;

  /// No description provided for @washOperatorHint.
  ///
  /// In en, this message translates to:
  /// **'Who washed the vehicle'**
  String get washOperatorHint;

  /// No description provided for @washBayLabel.
  ///
  /// In en, this message translates to:
  /// **'Bay'**
  String get washBayLabel;

  /// No description provided for @washBayHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get washBayHint;

  /// No description provided for @washOdometerLabel.
  ///
  /// In en, this message translates to:
  /// **'Odometer (km)'**
  String get washOdometerLabel;

  /// No description provided for @washOdometerHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get washOdometerHint;

  /// No description provided for @washNotesLabel.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get washNotesLabel;

  /// No description provided for @washNotesHint.
  ///
  /// In en, this message translates to:
  /// **'Anything worth recording'**
  String get washNotesHint;

  /// No description provided for @washTypeRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Wash type needed'**
  String get washTypeRequiredTitle;

  /// No description provided for @washTypeRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Choose a wash type before saving.'**
  String get washTypeRequiredMessage;

  /// No description provided for @washAssetRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Asset needed'**
  String get washAssetRequiredTitle;

  /// No description provided for @washAssetRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Enter the asset before saving.'**
  String get washAssetRequiredMessage;

  /// No description provided for @washSaveAction.
  ///
  /// In en, this message translates to:
  /// **'Save Wash'**
  String get washSaveAction;

  /// No description provided for @washSavedMessage.
  ///
  /// In en, this message translates to:
  /// **'Wash logged. It will sync automatically.'**
  String get washSavedMessage;

  /// No description provided for @washSaveFailedTitle.
  ///
  /// In en, this message translates to:
  /// **'Could not save the wash'**
  String get washSaveFailedTitle;

  /// No description provided for @washTryAgainFallback.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Try again.'**
  String get washTryAgainFallback;

  /// No description provided for @washRecentTitle.
  ///
  /// In en, this message translates to:
  /// **'Recent washes'**
  String get washRecentTitle;

  /// No description provided for @washRecentEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'No washes recorded yet.'**
  String get washRecentEmptyMessage;

  /// No description provided for @washRecentLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Recent washes could not be loaded.'**
  String get washRecentLoadErrorMessage;

  /// No description provided for @homeNavTitle.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get homeNavTitle;

  /// No description provided for @homeGreeting.
  ///
  /// In en, this message translates to:
  /// **'Welcome back'**
  String get homeGreeting;

  /// No description provided for @homeFieldSectionHeading.
  ///
  /// In en, this message translates to:
  /// **'Field'**
  String get homeFieldSectionHeading;

  /// No description provided for @homeFleetSectionHeading.
  ///
  /// In en, this message translates to:
  /// **'Fleet'**
  String get homeFleetSectionHeading;

  /// No description provided for @homeMaintenanceSectionHeading.
  ///
  /// In en, this message translates to:
  /// **'Maintenance'**
  String get homeMaintenanceSectionHeading;

  /// No description provided for @homeSyncStatLabel.
  ///
  /// In en, this message translates to:
  /// **'Pending sync'**
  String get homeSyncStatLabel;

  /// No description provided for @homeSiteStatLabel.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get homeSiteStatLabel;

  /// No description provided for @homeSiteStatUnavailable.
  ///
  /// In en, this message translates to:
  /// **'No site on file'**
  String get homeSiteStatUnavailable;

  /// No description provided for @homeFleetSizeStatLabel.
  ///
  /// In en, this message translates to:
  /// **'Fleet size'**
  String get homeFleetSizeStatLabel;

  /// No description provided for @homeStatLoadingCaption.
  ///
  /// In en, this message translates to:
  /// **'Checking'**
  String get homeStatLoadingCaption;

  /// No description provided for @homeStatUnavailableCaption.
  ///
  /// In en, this message translates to:
  /// **'Could not check'**
  String get homeStatUnavailableCaption;

  /// No description provided for @homeNoQuickActionsMessage.
  ///
  /// In en, this message translates to:
  /// **'Nothing is available to you here yet. Contact your administrator if you need access to a feature.'**
  String get homeNoQuickActionsMessage;

  /// No description provided for @workOrdersNavTitle.
  ///
  /// In en, this message translates to:
  /// **'Work Orders'**
  String get workOrdersNavTitle;

  /// No description provided for @workOrdersActiveCount.
  ///
  /// In en, this message translates to:
  /// **'{count} active'**
  String workOrdersActiveCount(int count);

  /// No description provided for @workOrdersFilterActive.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get workOrdersFilterActive;

  /// No description provided for @workOrdersFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get workOrdersFilterAll;

  /// No description provided for @workOrdersEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No work orders'**
  String get workOrdersEmptyTitle;

  /// No description provided for @workOrdersEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Work orders logged for this fleet will appear here.'**
  String get workOrdersEmptyMessage;

  /// No description provided for @workOrdersLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Work orders could not be loaded right now.'**
  String get workOrdersLoadErrorMessage;

  /// Shown on a status badge when work_orders.status is blank or null.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get workOrdersStatusOpenFallback;

  /// Shown in place of work_orders.work_type when it is blank or null.
  ///
  /// In en, this message translates to:
  /// **'General work'**
  String get workOrdersWorkTypeFallback;

  /// No description provided for @workOrderNewTitle.
  ///
  /// In en, this message translates to:
  /// **'New work order'**
  String get workOrderNewTitle;

  /// No description provided for @workOrderAssetLabel.
  ///
  /// In en, this message translates to:
  /// **'Asset'**
  String get workOrderAssetLabel;

  /// No description provided for @workOrderAssetHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. TM514'**
  String get workOrderAssetHint;

  /// No description provided for @workOrderAssetRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Enter the asset before saving.'**
  String get workOrderAssetRequiredMessage;

  /// No description provided for @workOrderWorkTypeLabel.
  ///
  /// In en, this message translates to:
  /// **'Work type'**
  String get workOrderWorkTypeLabel;

  /// No description provided for @workOrderPriorityLabel.
  ///
  /// In en, this message translates to:
  /// **'Priority'**
  String get workOrderPriorityLabel;

  /// No description provided for @workOrderDescriptionLabel.
  ///
  /// In en, this message translates to:
  /// **'Details'**
  String get workOrderDescriptionLabel;

  /// No description provided for @workOrderDescriptionHint.
  ///
  /// In en, this message translates to:
  /// **'Anything worth recording'**
  String get workOrderDescriptionHint;

  /// No description provided for @workOrderCreateAction.
  ///
  /// In en, this message translates to:
  /// **'Create work order'**
  String get workOrderCreateAction;

  /// No description provided for @workOrderSavedMessage.
  ///
  /// In en, this message translates to:
  /// **'Work order logged. It will sync automatically.'**
  String get workOrderSavedMessage;

  /// No description provided for @workOrderSaveFailedMessage.
  ///
  /// In en, this message translates to:
  /// **'Could not save. Try again.'**
  String get workOrderSaveFailedMessage;

  /// No description provided for @workOrderWorkspaceLoadingMessage.
  ///
  /// In en, this message translates to:
  /// **'Your workspace is still loading. Try again in a moment.'**
  String get workOrderWorkspaceLoadingMessage;

  /// Create-form work type option. The saved value is this exact English word - see work_order_badges.dart's own library comment.
  ///
  /// In en, this message translates to:
  /// **'Tyre Change'**
  String get workOrderWorkTypeTyreChange;

  /// No description provided for @workOrderWorkTypeRepair.
  ///
  /// In en, this message translates to:
  /// **'Repair'**
  String get workOrderWorkTypeRepair;

  /// No description provided for @workOrderWorkTypeRotation.
  ///
  /// In en, this message translates to:
  /// **'Rotation'**
  String get workOrderWorkTypeRotation;

  /// No description provided for @workOrderWorkTypeAlignment.
  ///
  /// In en, this message translates to:
  /// **'Alignment'**
  String get workOrderWorkTypeAlignment;

  /// No description provided for @workOrderWorkTypeInspection.
  ///
  /// In en, this message translates to:
  /// **'Inspection'**
  String get workOrderWorkTypeInspection;

  /// No description provided for @workOrderWorkTypeOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get workOrderWorkTypeOther;

  /// Create-form priority option. The saved value is this exact English word.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get workOrderPriorityLow;

  /// No description provided for @workOrderPriorityMedium.
  ///
  /// In en, this message translates to:
  /// **'Medium'**
  String get workOrderPriorityMedium;

  /// No description provided for @workOrderPriorityHigh.
  ///
  /// In en, this message translates to:
  /// **'High'**
  String get workOrderPriorityHigh;

  /// No description provided for @workOrderPriorityCritical.
  ///
  /// In en, this message translates to:
  /// **'Critical'**
  String get workOrderPriorityCritical;

  /// The advance button's label when the next status is In Progress - names the state it moves the work order to, matching the reference button's own wording.
  ///
  /// In en, this message translates to:
  /// **'In Progress'**
  String get workOrderAdvanceToInProgress;

  /// No description provided for @workOrderAdvanceToCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get workOrderAdvanceToCompleted;

  /// No description provided for @workOrderStatusQueuedMessage.
  ///
  /// In en, this message translates to:
  /// **'Status update saved. It will sync automatically.'**
  String get workOrderStatusQueuedMessage;

  /// Detail screen app bar title fallback, used only when the work order carries no asset number.
  ///
  /// In en, this message translates to:
  /// **'Work order'**
  String get workOrderDetailTitle;

  /// No description provided for @workOrderNotFoundTitle.
  ///
  /// In en, this message translates to:
  /// **'Work order not found'**
  String get workOrderNotFoundTitle;

  /// No description provided for @workOrderNotFoundMessage.
  ///
  /// In en, this message translates to:
  /// **'This work order could not be found, or you no longer have access to it.'**
  String get workOrderNotFoundMessage;

  /// No description provided for @workOrderLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'This work order could not be loaded right now.'**
  String get workOrderLoadErrorMessage;

  /// No description provided for @workOrderFieldWorkOrderNo.
  ///
  /// In en, this message translates to:
  /// **'Work order no.'**
  String get workOrderFieldWorkOrderNo;

  /// No description provided for @workOrderFieldWorkType.
  ///
  /// In en, this message translates to:
  /// **'Work type'**
  String get workOrderFieldWorkType;

  /// No description provided for @workOrderFieldSite.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get workOrderFieldSite;

  /// No description provided for @workOrderFieldCountry.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get workOrderFieldCountry;

  /// No description provided for @workOrderFieldOpened.
  ///
  /// In en, this message translates to:
  /// **'Opened'**
  String get workOrderFieldOpened;

  /// No description provided for @workOrderFieldStarted.
  ///
  /// In en, this message translates to:
  /// **'Started'**
  String get workOrderFieldStarted;

  /// No description provided for @workOrderFieldCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get workOrderFieldCompleted;

  /// No description provided for @workOrderFieldDescription.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get workOrderFieldDescription;

  /// No description provided for @tyreReplaceNavTitle.
  ///
  /// In en, this message translates to:
  /// **'Tyre Replacement'**
  String get tyreReplaceNavTitle;

  /// No description provided for @tyreReplaceWorkspaceLoadingMessage.
  ///
  /// In en, this message translates to:
  /// **'Your workspace is still loading. Try again in a moment.'**
  String get tyreReplaceWorkspaceLoadingMessage;

  /// No description provided for @tyreReplaceAssetLabel.
  ///
  /// In en, this message translates to:
  /// **'Asset'**
  String get tyreReplaceAssetLabel;

  /// No description provided for @tyreReplaceAssetHint.
  ///
  /// In en, this message translates to:
  /// **'Type or scan the asset number'**
  String get tyreReplaceAssetHint;

  /// No description provided for @tyreReplaceMasterFleetNumber.
  ///
  /// In en, this message translates to:
  /// **'Fleet {fleetNo}'**
  String tyreReplaceMasterFleetNumber(String fleetNo);

  /// No description provided for @tyreReplaceSiteLabel.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get tyreReplaceSiteLabel;

  /// No description provided for @tyreReplaceSiteHint.
  ///
  /// In en, this message translates to:
  /// **'Where the tyre was replaced'**
  String get tyreReplaceSiteHint;

  /// No description provided for @tyreReplaceSiteHelp.
  ///
  /// In en, this message translates to:
  /// **'Filled in automatically from the fleet record. Change it if this replacement happened at a different site.'**
  String get tyreReplaceSiteHelp;

  /// No description provided for @tyreReplacePositionLabel.
  ///
  /// In en, this message translates to:
  /// **'Position'**
  String get tyreReplacePositionLabel;

  /// No description provided for @tyreReplacePositionHint.
  ///
  /// In en, this message translates to:
  /// **'Tap a position for this vehicle, or type your own below.'**
  String get tyreReplacePositionHint;

  /// No description provided for @tyreReplacePositionInputLabel.
  ///
  /// In en, this message translates to:
  /// **'Position code'**
  String get tyreReplacePositionInputLabel;

  /// No description provided for @tyreReplaceBrandLabel.
  ///
  /// In en, this message translates to:
  /// **'Brand'**
  String get tyreReplaceBrandLabel;

  /// No description provided for @tyreReplaceBrandHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get tyreReplaceBrandHint;

  /// No description provided for @tyreReplaceSizeLabel.
  ///
  /// In en, this message translates to:
  /// **'Size'**
  String get tyreReplaceSizeLabel;

  /// No description provided for @tyreReplaceSizeHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 315/80R22.5'**
  String get tyreReplaceSizeHint;

  /// No description provided for @tyreReplaceSerialLabel.
  ///
  /// In en, this message translates to:
  /// **'Serial number'**
  String get tyreReplaceSerialLabel;

  /// No description provided for @tyreReplaceSerialHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get tyreReplaceSerialHint;

  /// No description provided for @tyreReplaceCostLabel.
  ///
  /// In en, this message translates to:
  /// **'Cost'**
  String get tyreReplaceCostLabel;

  /// No description provided for @tyreReplaceCostHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get tyreReplaceCostHint;

  /// No description provided for @tyreReplaceOdometerLabel.
  ///
  /// In en, this message translates to:
  /// **'Odometer (km)'**
  String get tyreReplaceOdometerLabel;

  /// No description provided for @tyreReplaceOdometerHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get tyreReplaceOdometerHint;

  /// No description provided for @tyreReplaceTreadLabel.
  ///
  /// In en, this message translates to:
  /// **'Tread depth (mm)'**
  String get tyreReplaceTreadLabel;

  /// No description provided for @tyreReplaceTreadHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get tyreReplaceTreadHint;

  /// No description provided for @tyreReplaceReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason for removal'**
  String get tyreReplaceReasonLabel;

  /// No description provided for @tyreReplaceReasonHint.
  ///
  /// In en, this message translates to:
  /// **'Optional - why the old tyre came off'**
  String get tyreReplaceReasonHint;

  /// No description provided for @tyreReplacePhotosLabel.
  ///
  /// In en, this message translates to:
  /// **'Photos'**
  String get tyreReplacePhotosLabel;

  /// No description provided for @tyreReplaceAddPhoto.
  ///
  /// In en, this message translates to:
  /// **'Add photo'**
  String get tyreReplaceAddPhoto;

  /// No description provided for @tyreReplacePhotoCamera.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get tyreReplacePhotoCamera;

  /// No description provided for @tyreReplacePhotoGallery.
  ///
  /// In en, this message translates to:
  /// **'Gallery'**
  String get tyreReplacePhotoGallery;

  /// No description provided for @tyreReplaceSaveAction.
  ///
  /// In en, this message translates to:
  /// **'Save Tyre Replacement'**
  String get tyreReplaceSaveAction;

  /// No description provided for @tyreReplaceAssetRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Asset needed'**
  String get tyreReplaceAssetRequiredTitle;

  /// No description provided for @tyreReplaceAssetRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Enter the asset before saving.'**
  String get tyreReplaceAssetRequiredMessage;

  /// No description provided for @tyreReplacePositionRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Position needed'**
  String get tyreReplacePositionRequiredTitle;

  /// No description provided for @tyreReplacePositionRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Choose or type a position before saving.'**
  String get tyreReplacePositionRequiredMessage;

  /// No description provided for @tyreReplaceSavedTitle.
  ///
  /// In en, this message translates to:
  /// **'Tyre replacement saved'**
  String get tyreReplaceSavedTitle;

  /// No description provided for @tyreReplaceSavedMessage.
  ///
  /// In en, this message translates to:
  /// **'It will sync automatically.'**
  String get tyreReplaceSavedMessage;

  /// No description provided for @tyreReplaceAddAnotherAction.
  ///
  /// In en, this message translates to:
  /// **'Add another'**
  String get tyreReplaceAddAnotherAction;

  /// No description provided for @tyreReplaceDoneAction.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get tyreReplaceDoneAction;

  /// No description provided for @tyreReplaceSaveFailedTitle.
  ///
  /// In en, this message translates to:
  /// **'Could not save the tyre replacement'**
  String get tyreReplaceSaveFailedTitle;

  /// No description provided for @tyreReplaceTryAgainFallback.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Try again.'**
  String get tyreReplaceTryAgainFallback;

  /// No description provided for @globalSearchTitle.
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get globalSearchTitle;

  /// No description provided for @globalSearchSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Find an asset, tyre, work order or inspection'**
  String get globalSearchSubtitle;

  /// No description provided for @globalSearchPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Asset, registration, chassis, fleet no, serial, work order...'**
  String get globalSearchPlaceholder;

  /// No description provided for @globalSearchHelp.
  ///
  /// In en, this message translates to:
  /// **'Matches asset number, registration, chassis number, fleet number, tyre serial, work order number or inspection reference.'**
  String get globalSearchHelp;

  /// No description provided for @globalSearchSearching.
  ///
  /// In en, this message translates to:
  /// **'Searching...'**
  String get globalSearchSearching;

  /// No description provided for @globalSearchIdleTitle.
  ///
  /// In en, this message translates to:
  /// **'Search across your fleet'**
  String get globalSearchIdleTitle;

  /// No description provided for @globalSearchIdleMessage.
  ///
  /// In en, this message translates to:
  /// **'Type an asset number, registration, chassis number, fleet number, tyre serial, work order number or inspection reference to search everything at once.'**
  String get globalSearchIdleMessage;

  /// No description provided for @globalSearchEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No matches found'**
  String get globalSearchEmptyTitle;

  /// No description provided for @globalSearchEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Nothing matched that term across assets, tyres, work orders or inspections. Check the spelling and try again.'**
  String get globalSearchEmptyMessage;

  /// No description provided for @globalSearchRecentSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Recent searches'**
  String get globalSearchRecentSectionTitle;

  /// Total row count across every matched identifier type.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No results} =1{1 result} other{{count} results}}'**
  String globalSearchResultsCount(int count);

  /// No description provided for @globalSearchSectionAssets.
  ///
  /// In en, this message translates to:
  /// **'Assets'**
  String get globalSearchSectionAssets;

  /// No description provided for @globalSearchSectionTyres.
  ///
  /// In en, this message translates to:
  /// **'Tyres'**
  String get globalSearchSectionTyres;

  /// No description provided for @globalSearchSectionWorkOrders.
  ///
  /// In en, this message translates to:
  /// **'Work orders'**
  String get globalSearchSectionWorkOrders;

  /// No description provided for @globalSearchSectionInspections.
  ///
  /// In en, this message translates to:
  /// **'Inspections'**
  String get globalSearchSectionInspections;

  /// Shown when one of the four identifier-type lookups failed while at least one other succeeded - see GlobalSearchState.failedSources.
  ///
  /// In en, this message translates to:
  /// **'Some results could not be checked right now. Pull to refresh or try again.'**
  String get globalSearchSourceFailedNotice;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en', 'ur'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'en':
      return AppLocalizationsEn();
    case 'ur':
      return AppLocalizationsUr();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
