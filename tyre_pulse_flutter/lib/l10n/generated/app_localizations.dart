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
  /// **'Search asset, serial, make, type or site'**
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
  /// **'Vehicle 360°'**
  String get vehiclesDetailSubtitle;

  /// Heading above the generated front, rear, top, left and right asset board.
  ///
  /// In en, this message translates to:
  /// **'Vehicle views'**
  String get vehiclesMultiViewTitle;

  /// Explains the five viewpoints represented in the asset board.
  ///
  /// In en, this message translates to:
  /// **'Front · Rear · Top · Left · Right'**
  String get vehiclesMultiViewHint;

  /// Invites the user to open the five-view vehicle board at full size.
  ///
  /// In en, this message translates to:
  /// **'Tap to zoom'**
  String get vehiclesMultiViewZoom;

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

  /// No description provided for @vehiclesFieldSerialNo.
  ///
  /// In en, this message translates to:
  /// **'Equipment serial'**
  String get vehiclesFieldSerialNo;

  /// No description provided for @vehiclesFieldEngineNo.
  ///
  /// In en, this message translates to:
  /// **'Engine number'**
  String get vehiclesFieldEngineNo;

  /// No description provided for @vehiclesFieldCapacity.
  ///
  /// In en, this message translates to:
  /// **'Capacity'**
  String get vehiclesFieldCapacity;

  /// No description provided for @vehiclesFieldOperationalStatus.
  ///
  /// In en, this message translates to:
  /// **'Operational status'**
  String get vehiclesFieldOperationalStatus;

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

  /// Truthful count of tyre positions the inspector deliberately checked. This is workflow progress, not an inspection result.
  ///
  /// In en, this message translates to:
  /// **'{filled} of {total} checked'**
  String inspectionResumeProgress(int filled, int total);

  /// Workflow state before the inspector has checked any tyre. Never represents a tyre condition result.
  ///
  /// In en, this message translates to:
  /// **'Not started'**
  String get inspectionWorkflowNotStarted;

  /// Workflow state after at least one but not all required tyre positions have been checked.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get inspectionWorkflowInProgress;

  /// Workflow state once the tyre-position completeness gate permits review.
  ///
  /// In en, this message translates to:
  /// **'Ready for review'**
  String get inspectionWorkflowReadyForReview;

  /// One-line workflow state and checked-position count on a resumable inspection row.
  ///
  /// In en, this message translates to:
  /// **'{status} • {progress}'**
  String inspectionWorkflowResumeSummary(String status, String progress);

  /// Instruction shown before the first tyre position is checked.
  ///
  /// In en, this message translates to:
  /// **'Tap a tyre to add inspection details.'**
  String get inspectionWorkflowTapTyre;

  /// Instruction shown while a tyre inspection is in progress but has not passed its completeness gate.
  ///
  /// In en, this message translates to:
  /// **'Continue checking tyre positions until each has enough detail.'**
  String get inspectionWorkflowContinueChecking;

  /// Confirmation shown when every required tyre position has enough detail to proceed to review.
  ///
  /// In en, this message translates to:
  /// **'All tyre positions are checked. Review and sign is ready.'**
  String get inspectionWorkflowAllChecked;

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

  /// No description provided for @inspectionDraftLabel.
  ///
  /// In en, this message translates to:
  /// **'Draft'**
  String get inspectionDraftLabel;

  /// No description provided for @inspectionTyreConfiguration.
  ///
  /// In en, this message translates to:
  /// **'{count}-Tyre Configuration'**
  String inspectionTyreConfiguration(int count);

  /// No description provided for @inspectionStepOfTotal.
  ///
  /// In en, this message translates to:
  /// **'Step {step} of {total}'**
  String inspectionStepOfTotal(int step, int total);

  /// No description provided for @inspectionRearLabel.
  ///
  /// In en, this message translates to:
  /// **'REAR'**
  String get inspectionRearLabel;

  /// No description provided for @inspectionSelectedTyre.
  ///
  /// In en, this message translates to:
  /// **'Selected Tyre'**
  String get inspectionSelectedTyre;

  /// No description provided for @inspectionPressureShort.
  ///
  /// In en, this message translates to:
  /// **'Pressure'**
  String get inspectionPressureShort;

  /// No description provided for @inspectionTreadDepthShort.
  ///
  /// In en, this message translates to:
  /// **'Tread Depth'**
  String get inspectionTreadDepthShort;

  /// No description provided for @inspectionAddEvidencePhoto.
  ///
  /// In en, this message translates to:
  /// **'Add Evidence (Photo)'**
  String get inspectionAddEvidencePhoto;

  /// No description provided for @inspectionSaveAndNext.
  ///
  /// In en, this message translates to:
  /// **'Save & Next'**
  String get inspectionSaveAndNext;

  /// No description provided for @inspectionFrontLeft.
  ///
  /// In en, this message translates to:
  /// **'Front Left'**
  String get inspectionFrontLeft;

  /// No description provided for @inspectionFrontRight.
  ///
  /// In en, this message translates to:
  /// **'Front Right'**
  String get inspectionFrontRight;

  /// No description provided for @inspectionInnerLeft.
  ///
  /// In en, this message translates to:
  /// **'Inner Left'**
  String get inspectionInnerLeft;

  /// No description provided for @inspectionOuterLeft.
  ///
  /// In en, this message translates to:
  /// **'Outer Left'**
  String get inspectionOuterLeft;

  /// No description provided for @inspectionInnerRight.
  ///
  /// In en, this message translates to:
  /// **'Inner Right'**
  String get inspectionInnerRight;

  /// No description provided for @inspectionOuterRight.
  ///
  /// In en, this message translates to:
  /// **'Outer Right'**
  String get inspectionOuterRight;

  /// No description provided for @inspectionRearLeft.
  ///
  /// In en, this message translates to:
  /// **'Rear Left'**
  String get inspectionRearLeft;

  /// No description provided for @inspectionRearRight.
  ///
  /// In en, this message translates to:
  /// **'Rear Right'**
  String get inspectionRearRight;

  /// No description provided for @inspectionTyrePositionFallback.
  ///
  /// In en, this message translates to:
  /// **'Tyre position'**
  String get inspectionTyrePositionFallback;

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

  /// No description provided for @inspectionDetailLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'This inspection could not be loaded. Check your connection and try again.'**
  String get inspectionDetailLoadErrorMessage;

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

  /// No description provided for @inspectionHistoryQueueReadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Some queued inspections could not be read from this device. They have not been lost—try again shortly.'**
  String get inspectionHistoryQueueReadErrorMessage;

  /// No description provided for @inspectionHistoryLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Your inspections could not be loaded. Pull down to try again.'**
  String get inspectionHistoryLoadErrorMessage;

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

  /// No description provided for @checklistWorkspaceLoadingMessage.
  ///
  /// In en, this message translates to:
  /// **'Your workspace is still loading. Try again in a moment.'**
  String get checklistWorkspaceLoadingMessage;

  /// No description provided for @checklistsLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Checklists could not be loaded. Pull down to try again.'**
  String get checklistsLoadErrorMessage;

  /// No description provided for @checklistsLibraryTitle.
  ///
  /// In en, this message translates to:
  /// **'Inspection library'**
  String get checklistsLibraryTitle;

  /// No description provided for @checklistsLibrarySubtitle.
  ///
  /// In en, this message translates to:
  /// **'Choose the correct workflow for the asset'**
  String get checklistsLibrarySubtitle;

  /// No description provided for @checklistsAssetSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Scan QR or enter asset number'**
  String get checklistsAssetSearchHint;

  /// No description provided for @checklistsLanguageStorageHint.
  ///
  /// In en, this message translates to:
  /// **'Answers are stored consistently across languages'**
  String get checklistsLanguageStorageHint;

  /// No description provided for @checklistsRequiredForAsset.
  ///
  /// In en, this message translates to:
  /// **'Required for this asset'**
  String get checklistsRequiredForAsset;

  /// No description provided for @checklistsGeneralLibraryTitle.
  ///
  /// In en, this message translates to:
  /// **'General checklist library'**
  String get checklistsGeneralLibraryTitle;

  /// No description provided for @checklistsGeneralLibrarySubtitle.
  ///
  /// In en, this message translates to:
  /// **'Safety, shift, equipment and washing checklists'**
  String get checklistsGeneralLibrarySubtitle;

  /// No description provided for @checklistsTyreInspectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Tyre inspection'**
  String get checklistsTyreInspectionTitle;

  /// No description provided for @checklistsTyreInspectionSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Dedicated axle/inner/outer tyre workflow'**
  String get checklistsTyreInspectionSubtitle;

  /// No description provided for @checklistsAssetHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklist history for {assetNo}'**
  String checklistsAssetHistoryTitle(String assetNo);

  /// No description provided for @checklistsMasterDataVerified.
  ///
  /// In en, this message translates to:
  /// **'Master data verified'**
  String get checklistsMasterDataVerified;

  /// No description provided for @checklistsAvailableCount.
  ///
  /// In en, this message translates to:
  /// **'{count} available'**
  String checklistsAvailableCount(int count);

  /// No description provided for @checklistItemCount.
  ///
  /// In en, this message translates to:
  /// **'{count} items'**
  String checklistItemCount(int count);

  /// No description provided for @checklistPositionCount.
  ///
  /// In en, this message translates to:
  /// **'{count} positions'**
  String checklistPositionCount(int count);

  /// No description provided for @checklistPhotosOnFailure.
  ///
  /// In en, this message translates to:
  /// **'Photos required on failed items'**
  String get checklistPhotosOnFailure;

  /// No description provided for @checklistStartAction.
  ///
  /// In en, this message translates to:
  /// **'Start'**
  String get checklistStartAction;

  /// No description provided for @checklistResumeAction.
  ///
  /// In en, this message translates to:
  /// **'Resume'**
  String get checklistResumeAction;

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

  /// No description provided for @myPlansNavTitle.
  ///
  /// In en, this message translates to:
  /// **'My plans'**
  String get myPlansNavTitle;

  /// No description provided for @myPlansSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Inspections assigned to you'**
  String get myPlansSubtitle;

  /// No description provided for @myPlansLoadingMessage.
  ///
  /// In en, this message translates to:
  /// **'Loading your plans'**
  String get myPlansLoadingMessage;

  /// No description provided for @myPlansEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'Nothing planned for you'**
  String get myPlansEmptyTitle;

  /// No description provided for @myPlansEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'When a supervisor schedules an inspection for you, it will appear here. You can still start an inspection at any time without a plan.'**
  String get myPlansEmptyMessage;

  /// No description provided for @myPlansTruncatedNotice.
  ///
  /// In en, this message translates to:
  /// **'This list may not be complete. The server returned as many plans as it will send at once, so some may be missing. Check with your supervisor before treating this as your full workload.'**
  String get myPlansTruncatedNotice;

  /// No description provided for @myPlansStateMissed.
  ///
  /// In en, this message translates to:
  /// **'Missed'**
  String get myPlansStateMissed;

  /// No description provided for @myPlansStateDue.
  ///
  /// In en, this message translates to:
  /// **'Due now'**
  String get myPlansStateDue;

  /// No description provided for @myPlansStateStarted.
  ///
  /// In en, this message translates to:
  /// **'Started'**
  String get myPlansStateStarted;

  /// No description provided for @myPlansStateUpcoming.
  ///
  /// In en, this message translates to:
  /// **'Upcoming'**
  String get myPlansStateUpcoming;

  /// No description provided for @myPlansStateDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get myPlansStateDone;

  /// No description provided for @myPlansStateCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get myPlansStateCancelled;

  /// No description provided for @myPlansStateUnknown.
  ///
  /// In en, this message translates to:
  /// **'Not recognised'**
  String get myPlansStateUnknown;

  /// No description provided for @myPlansNoLocation.
  ///
  /// In en, this message translates to:
  /// **'No location recorded'**
  String get myPlansNoLocation;

  /// No description provided for @myPlansCoveredBy.
  ///
  /// In en, this message translates to:
  /// **'Covered by {name}'**
  String myPlansCoveredBy(String name);

  /// No description provided for @myPlansCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get myPlansCompleted;

  /// No description provided for @myPlansCompletedOn.
  ///
  /// In en, this message translates to:
  /// **'Completed {date}'**
  String myPlansCompletedOn(String date);

  /// No description provided for @myPlansOverdue.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{1 day overdue - it still needs doing} other{{days} days overdue - it still needs doing}}'**
  String myPlansOverdue(int days);

  /// No description provided for @checklistHistoryLoadErrorMessage.
  ///
  /// In en, this message translates to:
  /// **'Your checklist history could not be loaded. Pull down to try again.'**
  String get checklistHistoryLoadErrorMessage;

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

  /// No description provided for @checklistFillNotFoundMessage.
  ///
  /// In en, this message translates to:
  /// **'This checklist could not be found. It may have been unpublished.'**
  String get checklistFillNotFoundMessage;

  /// No description provided for @checklistFillSaveFailedMessage.
  ///
  /// In en, this message translates to:
  /// **'This checklist could not be saved. It has not been lost—try again.'**
  String get checklistFillSaveFailedMessage;

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

  /// No description provided for @inspectionApprovalsApprovedTab.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get inspectionApprovalsApprovedTab;

  /// No description provided for @inspectionApprovalsReturnedTab.
  ///
  /// In en, this message translates to:
  /// **'Returned'**
  String get inspectionApprovalsReturnedTab;

  /// No description provided for @dateGroupToday.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get dateGroupToday;

  /// No description provided for @dateGroupTomorrow.
  ///
  /// In en, this message translates to:
  /// **'Tomorrow'**
  String get dateGroupTomorrow;

  /// No description provided for @dateGroupYesterday.
  ///
  /// In en, this message translates to:
  /// **'Yesterday'**
  String get dateGroupYesterday;

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
  /// **'Checklist approval'**
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

  /// No description provided for @checklistApprovalCannotCloseTitle.
  ///
  /// In en, this message translates to:
  /// **'This sheet cannot be closed yet'**
  String get checklistApprovalCannotCloseTitle;

  /// No description provided for @checklistApprovalCannotCloseMessage.
  ///
  /// In en, this message translates to:
  /// **'Some items are still recorded as a fault. Send the sheet back to have them fixed, then close it.'**
  String get checklistApprovalCannotCloseMessage;

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
  /// **'Record meter reading'**
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
  /// **'Log vehicle wash'**
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

  /// No description provided for @homeGoodMorning.
  ///
  /// In en, this message translates to:
  /// **'Good morning,'**
  String get homeGoodMorning;

  /// No description provided for @homeGoodAfternoon.
  ///
  /// In en, this message translates to:
  /// **'Good afternoon,'**
  String get homeGoodAfternoon;

  /// No description provided for @homeGoodEvening.
  ///
  /// In en, this message translates to:
  /// **'Good evening,'**
  String get homeGoodEvening;

  /// No description provided for @homeFallbackUser.
  ///
  /// In en, this message translates to:
  /// **'Team member'**
  String get homeFallbackUser;

  /// No description provided for @homeSearchAssetsHint.
  ///
  /// In en, this message translates to:
  /// **'Search asset, tyre, job...'**
  String get homeSearchAssetsHint;

  /// No description provided for @homeAttentionRequired.
  ///
  /// In en, this message translates to:
  /// **'Attention required'**
  String get homeAttentionRequired;

  /// No description provided for @homeViewAll.
  ///
  /// In en, this message translates to:
  /// **'View all'**
  String get homeViewAll;

  /// No description provided for @homeApprovalsMetric.
  ///
  /// In en, this message translates to:
  /// **'Approvals'**
  String get homeApprovalsMetric;

  /// No description provided for @homeOverdueMetric.
  ///
  /// In en, this message translates to:
  /// **'Overdue'**
  String get homeOverdueMetric;

  /// No description provided for @homeCriticalMetric.
  ///
  /// In en, this message translates to:
  /// **'Critical'**
  String get homeCriticalMetric;

  /// No description provided for @homeTyreIssueDetected.
  ///
  /// In en, this message translates to:
  /// **'Tyre issue detected'**
  String get homeTyreIssueDetected;

  /// No description provided for @homeNoCriticalIssueTitle.
  ///
  /// In en, this message translates to:
  /// **'No critical tyre issue'**
  String get homeNoCriticalIssueTitle;

  /// No description provided for @homeNoCriticalIssueMessage.
  ///
  /// In en, this message translates to:
  /// **'No active critical tyre alert was found.'**
  String get homeNoCriticalIssueMessage;

  /// No description provided for @homeReviewAction.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get homeReviewAction;

  /// No description provided for @homeMyWork.
  ///
  /// In en, this message translates to:
  /// **'My work'**
  String get homeMyWork;

  /// No description provided for @homeQuickActions.
  ///
  /// In en, this message translates to:
  /// **'Quick actions'**
  String get homeQuickActions;

  /// No description provided for @homeInspectAction.
  ///
  /// In en, this message translates to:
  /// **'Inspect'**
  String get homeInspectAction;

  /// No description provided for @homeAssetAction.
  ///
  /// In en, this message translates to:
  /// **'Asset'**
  String get homeAssetAction;

  /// No description provided for @homeReportIssueAction.
  ///
  /// In en, this message translates to:
  /// **'Report issue'**
  String get homeReportIssueAction;

  /// No description provided for @homeOpenAction.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get homeOpenAction;

  /// No description provided for @homeNoUrgentWorkTitle.
  ///
  /// In en, this message translates to:
  /// **'No urgent work'**
  String get homeNoUrgentWorkTitle;

  /// No description provided for @homeNoUrgentWorkMessage.
  ///
  /// In en, this message translates to:
  /// **'No overdue or high-priority task is assigned.'**
  String get homeNoUrgentWorkMessage;

  /// No description provided for @homeMoreAction.
  ///
  /// In en, this message translates to:
  /// **'More'**
  String get homeMoreAction;

  /// No description provided for @homeAlertsAction.
  ///
  /// In en, this message translates to:
  /// **'Alerts'**
  String get homeAlertsAction;

  /// No description provided for @homeMenuTooltip.
  ///
  /// In en, this message translates to:
  /// **'Open services'**
  String get homeMenuTooltip;

  /// No description provided for @homeNotificationsTooltip.
  ///
  /// In en, this message translates to:
  /// **'Open tyre alerts'**
  String get homeNotificationsTooltip;

  /// No description provided for @homeSiteSelectorTooltip.
  ///
  /// In en, this message translates to:
  /// **'View current site'**
  String get homeSiteSelectorTooltip;

  /// No description provided for @homeReportIssueSheetTitle.
  ///
  /// In en, this message translates to:
  /// **'Report an issue'**
  String get homeReportIssueSheetTitle;

  /// No description provided for @homeReportAccidentAction.
  ///
  /// In en, this message translates to:
  /// **'Report an accident'**
  String get homeReportAccidentAction;

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

  /// No description provided for @tyreDiagramModeLayout.
  ///
  /// In en, this message translates to:
  /// **'Layout view'**
  String get tyreDiagramModeLayout;

  /// No description provided for @tyreDiagramModeList.
  ///
  /// In en, this message translates to:
  /// **'List view'**
  String get tyreDiagramModeList;

  /// No description provided for @tyreDiagramStatTotal.
  ///
  /// In en, this message translates to:
  /// **'Total tyres'**
  String get tyreDiagramStatTotal;

  /// No description provided for @tyreDiagramStatOk.
  ///
  /// In en, this message translates to:
  /// **'OK'**
  String get tyreDiagramStatOk;

  /// No description provided for @tyreDiagramStatMonitor.
  ///
  /// In en, this message translates to:
  /// **'Monitor'**
  String get tyreDiagramStatMonitor;

  /// No description provided for @tyreDiagramStatCritical.
  ///
  /// In en, this message translates to:
  /// **'Critical'**
  String get tyreDiagramStatCritical;

  /// Caption under the Total tyres stat tile - how many of the vehicle's wheels have no reading at all.
  ///
  /// In en, this message translates to:
  /// **'{count} not yet recorded'**
  String tyreDiagramStatUnrecordedCaption(int count);

  /// A pressure reading shown in the tyre position list, already formatted by the caller.
  ///
  /// In en, this message translates to:
  /// **'{value} psi'**
  String tyreDiagramListPressureValue(String value);

  /// A tread depth reading shown in the tyre position list, already formatted by the caller.
  ///
  /// In en, this message translates to:
  /// **'{value} mm'**
  String tyreDiagramListTreadValue(String value);

  /// No description provided for @tyreDiagramListNotRecorded.
  ///
  /// In en, this message translates to:
  /// **'Not recorded'**
  String get tyreDiagramListNotRecorded;

  /// No description provided for @tyreDiagramListEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'Nothing recorded yet'**
  String get tyreDiagramListEmptyTitle;

  /// No description provided for @tyreDiagramListEmptyMessage.
  ///
  /// In en, this message translates to:
  /// **'Switch to Layout view and tap a tyre to record its condition.'**
  String get tyreDiagramListEmptyMessage;

  /// No description provided for @tyreDetailTitle.
  ///
  /// In en, this message translates to:
  /// **'Tyre detail'**
  String get tyreDetailTitle;

  /// No description provided for @tyreDetailStatTread.
  ///
  /// In en, this message translates to:
  /// **'Tread depth'**
  String get tyreDetailStatTread;

  /// No description provided for @tyreDetailStatPressure.
  ///
  /// In en, this message translates to:
  /// **'Pressure'**
  String get tyreDetailStatPressure;

  /// No description provided for @tyreDetailStatTemperature.
  ///
  /// In en, this message translates to:
  /// **'Temperature'**
  String get tyreDetailStatTemperature;

  /// No description provided for @tyreDetailFieldNotRecorded.
  ///
  /// In en, this message translates to:
  /// **'Not recorded'**
  String get tyreDetailFieldNotRecorded;

  /// No description provided for @tyreDetailNotRecordedCaption.
  ///
  /// In en, this message translates to:
  /// **'Not recorded for this inspection'**
  String get tyreDetailNotRecordedCaption;

  /// No description provided for @tyreDetailSectionOverview.
  ///
  /// In en, this message translates to:
  /// **'Overview'**
  String get tyreDetailSectionOverview;

  /// No description provided for @tyreDetailSectionAdditionalInfo.
  ///
  /// In en, this message translates to:
  /// **'Additional info'**
  String get tyreDetailSectionAdditionalInfo;

  /// No description provided for @tyreDetailBrandLabel.
  ///
  /// In en, this message translates to:
  /// **'Brand / pattern'**
  String get tyreDetailBrandLabel;

  /// No description provided for @tyreDetailSizeLabel.
  ///
  /// In en, this message translates to:
  /// **'Size'**
  String get tyreDetailSizeLabel;

  /// No description provided for @tyreDetailInstalledKmLabel.
  ///
  /// In en, this message translates to:
  /// **'Installed at'**
  String get tyreDetailInstalledKmLabel;

  /// No description provided for @tyreDetailRunningKmLabel.
  ///
  /// In en, this message translates to:
  /// **'Running distance'**
  String get tyreDetailRunningKmLabel;

  /// No description provided for @tyreDetailAssetLabel.
  ///
  /// In en, this message translates to:
  /// **'Asset'**
  String get tyreDetailAssetLabel;

  /// No description provided for @tyreDetailSiteLabel.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get tyreDetailSiteLabel;

  /// No description provided for @tyreDetailTakeActionButton.
  ///
  /// In en, this message translates to:
  /// **'Take action'**
  String get tyreDetailTakeActionButton;

  /// No description provided for @tyreDetailAddDetailsButton.
  ///
  /// In en, this message translates to:
  /// **'Add details'**
  String get tyreDetailAddDetailsButton;

  /// No description provided for @tyreDetailEditDetailsButton.
  ///
  /// In en, this message translates to:
  /// **'Edit details'**
  String get tyreDetailEditDetailsButton;

  /// No description provided for @tyreDetailRemainingKmLabel.
  ///
  /// In en, this message translates to:
  /// **'Remaining life'**
  String get tyreDetailRemainingKmLabel;

  /// No description provided for @tyreDetailRemainingKmCaption.
  ///
  /// In en, this message translates to:
  /// **'Fleet life projection'**
  String get tyreDetailRemainingKmCaption;

  /// No description provided for @tyreDetailRemainingKmUnavailable.
  ///
  /// In en, this message translates to:
  /// **'No measured life projection'**
  String get tyreDetailRemainingKmUnavailable;

  /// No description provided for @tyreDetailNoEvidenceMessage.
  ///
  /// In en, this message translates to:
  /// **'Nobody has recorded anything for this wheel yet.'**
  String get tyreDetailNoEvidenceMessage;

  /// No description provided for @takeActionTitle.
  ///
  /// In en, this message translates to:
  /// **'Take action'**
  String get takeActionTitle;

  /// No description provided for @takeActionReplaceTyre.
  ///
  /// In en, this message translates to:
  /// **'Replace tyre'**
  String get takeActionReplaceTyre;

  /// No description provided for @takeActionReplaceTyreSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Record the new tyre fitted to this wheel'**
  String get takeActionReplaceTyreSubtitle;

  /// No description provided for @takeActionReportDefect.
  ///
  /// In en, this message translates to:
  /// **'Repair (Puncture / Damage)'**
  String get takeActionReportDefect;

  /// No description provided for @takeActionReportDefectSubtitle.
  ///
  /// In en, this message translates to:
  /// **'File a repair job for this tyre'**
  String get takeActionReportDefectSubtitle;

  /// No description provided for @takeActionAdjustReading.
  ///
  /// In en, this message translates to:
  /// **'Adjust reading'**
  String get takeActionAdjustReading;

  /// No description provided for @takeActionAdjustReadingSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Update pressure, tread depth or condition'**
  String get takeActionAdjustReadingSubtitle;

  /// No description provided for @takeActionAdjustReadingUnavailableCaption.
  ///
  /// In en, this message translates to:
  /// **'Only available while filling in this inspection'**
  String get takeActionAdjustReadingUnavailableCaption;

  /// No description provided for @takeActionRotateTyre.
  ///
  /// In en, this message translates to:
  /// **'Rotate tyre'**
  String get takeActionRotateTyre;

  /// No description provided for @takeActionRemoveTyre.
  ///
  /// In en, this message translates to:
  /// **'Remove tyre'**
  String get takeActionRemoveTyre;

  /// No description provided for @takeActionSendToRetread.
  ///
  /// In en, this message translates to:
  /// **'Send to retread'**
  String get takeActionSendToRetread;

  /// No description provided for @takeActionMarkAsSpare.
  ///
  /// In en, this message translates to:
  /// **'Mark as spare'**
  String get takeActionMarkAsSpare;

  /// No description provided for @takeActionComingSoonCaption.
  ///
  /// In en, this message translates to:
  /// **'Not available in this build yet'**
  String get takeActionComingSoonCaption;

  /// No description provided for @reportDefectTitle.
  ///
  /// In en, this message translates to:
  /// **'Report a defect'**
  String get reportDefectTitle;

  /// No description provided for @reportDefectTitleFieldLabel.
  ///
  /// In en, this message translates to:
  /// **'Title'**
  String get reportDefectTitleFieldLabel;

  /// No description provided for @reportDefectTitleFieldHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Puncture on outer rear tyre'**
  String get reportDefectTitleFieldHint;

  /// No description provided for @reportDefectDescriptionLabel.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get reportDefectDescriptionLabel;

  /// No description provided for @reportDefectDescriptionHint.
  ///
  /// In en, this message translates to:
  /// **'What is wrong with this tyre?'**
  String get reportDefectDescriptionHint;

  /// No description provided for @reportDefectDamageReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Damage reason'**
  String get reportDefectDamageReasonLabel;

  /// No description provided for @reportDefectDamageReasonHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get reportDefectDamageReasonHint;

  /// No description provided for @reportDefectPriorityLabel.
  ///
  /// In en, this message translates to:
  /// **'Priority'**
  String get reportDefectPriorityLabel;

  /// No description provided for @reportDefectSubmitAction.
  ///
  /// In en, this message translates to:
  /// **'Submit repair request'**
  String get reportDefectSubmitAction;

  /// No description provided for @reportDefectTitleRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Title needed'**
  String get reportDefectTitleRequiredTitle;

  /// No description provided for @reportDefectTitleRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'Add a short title before saving.'**
  String get reportDefectTitleRequiredMessage;

  /// No description provided for @reportDefectSavedTitle.
  ///
  /// In en, this message translates to:
  /// **'Repair request saved'**
  String get reportDefectSavedTitle;

  /// No description provided for @reportDefectSavedMessage.
  ///
  /// In en, this message translates to:
  /// **'It will sync automatically.'**
  String get reportDefectSavedMessage;

  /// No description provided for @reportDefectSaveFailedTitle.
  ///
  /// In en, this message translates to:
  /// **'Could not save the repair request'**
  String get reportDefectSaveFailedTitle;

  /// No description provided for @damageReasonPuncture.
  ///
  /// In en, this message translates to:
  /// **'Puncture'**
  String get damageReasonPuncture;

  /// No description provided for @damageReasonSidewall.
  ///
  /// In en, this message translates to:
  /// **'Sidewall damage'**
  String get damageReasonSidewall;

  /// No description provided for @damageReasonTreadWear.
  ///
  /// In en, this message translates to:
  /// **'Tread wear'**
  String get damageReasonTreadWear;

  /// No description provided for @damageReasonBlowout.
  ///
  /// In en, this message translates to:
  /// **'Blowout'**
  String get damageReasonBlowout;

  /// No description provided for @damageReasonImpact.
  ///
  /// In en, this message translates to:
  /// **'Impact damage'**
  String get damageReasonImpact;

  /// No description provided for @damageReasonOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get damageReasonOther;

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

  /// Small line under the app name on the sign-in screen.
  ///
  /// In en, this message translates to:
  /// **'Inspector App'**
  String get loginAppSubtitle;

  /// Footer line at the bottom of the sign-in screen.
  ///
  /// In en, this message translates to:
  /// **'Fleet · Workshop · Inspections · Tyres · Safety'**
  String get loginTagline;

  /// No description provided for @loginCardTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign In'**
  String get loginCardTitle;

  /// No description provided for @loginCardSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Use your email, username, or Employee ID'**
  String get loginCardSubtitle;

  /// No description provided for @loginIdentifierLabel.
  ///
  /// In en, this message translates to:
  /// **'Email or employee ID'**
  String get loginIdentifierLabel;

  /// No description provided for @loginIdentifierPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Enter email, username, or ID'**
  String get loginIdentifierPlaceholder;

  /// No description provided for @loginPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get loginPasswordLabel;

  /// No description provided for @loginPasswordPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Enter password'**
  String get loginPasswordPlaceholder;

  /// Icon-button tooltip that reveals the typed password.
  ///
  /// In en, this message translates to:
  /// **'Show password'**
  String get loginShowPassword;

  /// Icon-button tooltip that masks the typed password again.
  ///
  /// In en, this message translates to:
  /// **'Hide password'**
  String get loginHidePassword;

  /// Client-side validation before a sign-in attempt is even sent.
  ///
  /// In en, this message translates to:
  /// **'Please enter your login and password.'**
  String get loginErrorRequired;

  /// SignInLocked - the server-enforced account lockout (system_config.max_login_attempts) refused this attempt outright, without checking the credentials just supplied.
  ///
  /// In en, this message translates to:
  /// **'{minutes, plural, =1{Too many failed attempts. Try again in 1 minute.} other{Too many failed attempts. Try again in {minutes} minutes.}}'**
  String loginErrorLocked(int minutes);

  /// Generic product description on every country-specific login screen. PMV is the product's established operational acronym.
  ///
  /// In en, this message translates to:
  /// **'One platform for every PMV asset'**
  String get loginOperationsTitle;

  /// No description provided for @loginWelcomeTitle.
  ///
  /// In en, this message translates to:
  /// **'Welcome back'**
  String get loginWelcomeTitle;

  /// No description provided for @loginWelcomeSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Access your assigned fleet, workshop and field tasks'**
  String get loginWelcomeSubtitle;

  /// No description provided for @loginSelectCountryTitle.
  ///
  /// In en, this message translates to:
  /// **'Select your country'**
  String get loginSelectCountryTitle;

  /// No description provided for @loginSelectCountrySubtitle.
  ///
  /// In en, this message translates to:
  /// **'Choose the country for your assigned operations.'**
  String get loginSelectCountrySubtitle;

  /// No description provided for @loginChangeCountryAction.
  ///
  /// In en, this message translates to:
  /// **'Change country'**
  String get loginChangeCountryAction;

  /// No description provided for @loginCountrySaudiArabia.
  ///
  /// In en, this message translates to:
  /// **'Saudi Arabia'**
  String get loginCountrySaudiArabia;

  /// No description provided for @loginCountryUnitedArabEmirates.
  ///
  /// In en, this message translates to:
  /// **'United Arab Emirates'**
  String get loginCountryUnitedArabEmirates;

  /// No description provided for @loginCountryEgypt.
  ///
  /// In en, this message translates to:
  /// **'Egypt'**
  String get loginCountryEgypt;

  /// Accessibility label for the control that opens the country selector.
  ///
  /// In en, this message translates to:
  /// **'Country selector'**
  String get loginCountrySelectorSemantics;

  /// Accessibility value announced for the currently selected login country.
  ///
  /// In en, this message translates to:
  /// **'Selected country: {country}'**
  String loginSelectedCountrySemantics(String country);

  /// Concise capability label on the login screen; it names the fleet and asset registers without implying any live count.
  ///
  /// In en, this message translates to:
  /// **'Fleet & assets'**
  String get loginScopeFleetAssets;

  /// Concise capability label on the login screen.
  ///
  /// In en, this message translates to:
  /// **'Inspections & checklists'**
  String get loginScopeInspectionsChecklists;

  /// Concise capability label on the login screen.
  ///
  /// In en, this message translates to:
  /// **'Maintenance & workshop'**
  String get loginScopeMaintenanceWorkshop;

  /// Complete copy catalogue for the security and help controls on the latest login composition.
  ///
  /// In en, this message translates to:
  /// **'secure=Secure company workspace · %country%~forgot=Forgot password?~access=Need access? Contact your administrator~or=or~biometric=Use device biometrics~authorized=Authorized PMV personnel only~audited=Activity is audited~version=Version %version%~biometricReason=Confirm your identity to sign in to Tyre Pulse~biometricUnavailable=Device biometrics are unavailable or not enrolled.~biometricLocked=Device biometrics are temporarily locked. Use your password.~biometricFailed=Device verification could not be completed.~credentialsRequired=Enter your email or employee ID and password before using device biometrics.~helpTitle=Sign-in help~forgotHelp=Password resets are managed by your Tyre Pulse administrator. Contact your administrator to restore access.~accessHelp=Your Tyre Pulse administrator manages mobile access and account approval.'**
  String get loginSecurityCopyCatalog;

  /// No description provided for @profileNavTitle.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profileNavTitle;

  /// No description provided for @profileRoleLabel.
  ///
  /// In en, this message translates to:
  /// **'Role'**
  String get profileRoleLabel;

  /// Shown on the profile screen only when profiles.is_super_admin is true.
  ///
  /// In en, this message translates to:
  /// **'Platform administrator'**
  String get profileSuperAdminBadge;

  /// No description provided for @accidentReportCaptureSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Private evidence capture'**
  String get accidentReportCaptureSubtitle;

  /// No description provided for @accidentSubmitUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Submission is unavailable until the protected sync pipeline guarantees every private evidence photo is uploaded before the accident row. Captured photos remain on this device.'**
  String get accidentSubmitUnavailable;

  /// No description provided for @accidentOverviewAppBarTitle.
  ///
  /// In en, this message translates to:
  /// **'Accident'**
  String get accidentOverviewAppBarTitle;

  /// No description provided for @accidentCaseAppBarTitle.
  ///
  /// In en, this message translates to:
  /// **'Case Details'**
  String get accidentCaseAppBarTitle;

  /// No description provided for @accidentViewCaseDetailsAction.
  ///
  /// In en, this message translates to:
  /// **'View Case Details'**
  String get accidentViewCaseDetailsAction;

  /// No description provided for @accidentUpdateCaseAction.
  ///
  /// In en, this message translates to:
  /// **'Update Case'**
  String get accidentUpdateCaseAction;

  /// No description provided for @accidentReportedOnLabel.
  ///
  /// In en, this message translates to:
  /// **'Reported on'**
  String get accidentReportedOnLabel;

  /// No description provided for @accidentProgressSection.
  ///
  /// In en, this message translates to:
  /// **'Progress'**
  String get accidentProgressSection;

  /// No description provided for @accidentDueDateLabel.
  ///
  /// In en, this message translates to:
  /// **'Due Date'**
  String get accidentDueDateLabel;

  /// No description provided for @accidentCaseInfoSection.
  ///
  /// In en, this message translates to:
  /// **'Case Info'**
  String get accidentCaseInfoSection;

  /// No description provided for @accidentCaseAssetLabel.
  ///
  /// In en, this message translates to:
  /// **'Asset'**
  String get accidentCaseAssetLabel;

  /// No description provided for @accidentCaseLocationLabel.
  ///
  /// In en, this message translates to:
  /// **'Location'**
  String get accidentCaseLocationLabel;

  /// No description provided for @accidentCaseReportedByLabel.
  ///
  /// In en, this message translates to:
  /// **'Reported By'**
  String get accidentCaseReportedByLabel;

  /// No description provided for @tasksCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'title=My Work~today=Today~assignedTab=Assigned~dueToday=Due today~inProgress=In Progress~completed=Completed~urgent=Urgent~upcoming=Upcoming~open=open~emptyTitle=No tasks~emptyMessage=No work matches this view.~loadError=My work could not be loaded right now.~due=Due~assigned=Assigned to~unassigned=Unassigned~normal=Normal~overdue=Overdue~details=Task details~description=Description~site=Site~asset=Asset~priority=Priority~status=Status~view=View~reportIssue=Report an issue~retry=Retry'**
  String get tasksCopyCatalog;

  /// No description provided for @alertsCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'title=Tyre Alerts~all=All~critical=Critical~warnings=Warnings~info=Info~flagged=flagged~criticalCount=critical~emptyTitle=No active alerts~emptyFilter=No alerts match this filter.~loadError=Could not load alerts. Pull down to retry.~unknownAsset=Unknown asset~pressureLow=Tyre pressure is low~treadLow=Tread depth is low~position=Position~serial=Serial~tread=Tread~retry=Retry'**
  String get alertsCopyCatalog;

  /// No description provided for @notificationInboxCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'title=Notifications~markAll=Mark all read~fallbackTitle=Notification~emptyTitle=You\'re all caught up~emptyBody=Assignments, approvals and operational updates will appear here.~loadFailed=Could not load notifications. Pull down to retry.~markFailed=Could not mark this notification as read.~markAllFailed=Could not mark all notifications as read.~justNow=Just now~minutesAgo=%count%m ago~hoursAgo=%count%h ago~daysAgo=%count%d ago'**
  String get notificationInboxCopyCatalog;

  /// No description provided for @reportIssueCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'title=Report an issue~problem=What is wrong?~problemHint=Briefly describe the issue~priority=Priority~low=Low~medium=Medium~high=High~critical=Critical~site=Site~siteHint=Where the issue was found~asset=Asset~assetHint=Asset number~due=Due in~noDate=No date~threeDays=3 days~oneWeek=1 week~twoWeeks=2 weeks~details=Description~detailsHint=Add symptoms, exact location and any immediate action taken~photos=Evidence~optional=(optional)~addPhoto=Add photo~camera=Camera~gallery=From gallery~photoFailed=The photo could not be added.~submit=Submit issue~titleRequired=Enter what is wrong before saving.~workspaceUnavailable=Your workspace is still loading. Try again in a moment.~savedTitle=Issue saved~savedBody=The issue is in My Work and will sync automatically.~stay=Stay here~viewTasks=View My Work~saveFailed=The issue could not be saved. Try again.~category=Issue category~mechanical=Mechanical~electrical=Electrical~hydraulic=Hydraulic~tyre=Tyre~body=Body~washing=Washing~safety=Safety~other=Other~operation=Can the asset operate safely?~yes=Yes~restricted=Restricted~no=No~restriction=Operating restriction~saveDraft=Save draft~draftSaved=Draft saved~createWorkOrder=Create work order after supervisor review~notifyTeam=Will notify Fleet Supervisor and Workshop team'**
  String get reportIssueCopyCatalog;

  /// No description provided for @rcaCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'title=Root Cause Analysis~records=records~newRecord=New RCA~none=No RCA records~noneBody=Completed root-cause records will appear here.~unknown=Unknown asset~asset=Asset~serial=Tyre serial~brand=Brand~site=Site~km=Kilometres at failure~factors=Contributing factors~rootCause=Root cause~photos=Evidence photos~photo=Photo~addPhoto=Add photo~camera=Camera~gallery=Gallery~photoFailed=The photo could not be added.~save=Save RCA~missingCause=Enter the root cause before saving.~invalidKm=Enter a valid kilometre reading.~loadFailed=The RCA records could not be loaded.~saveFailed=The RCA could not be saved. Try again.'**
  String get rcaCopyCatalog;

  /// No description provided for @pmCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'title=Maintenance Control Center~subtitle=Control today\'s maintenance workload~createWorkOrder=Create work order~pmDue=PM due~priorityQueue=Priority work queue~viewAll=View all~allWorkOrders=View all work orders~quickAccess=Quick access~workOrders=Work orders~workOrdersHint=Create & manage~pmSchedule=PM schedule~pmScheduleHint=Plan & track PM~inspections=Inspections~inspectionsHint=Check & report~parts=Parts~partsHint=Stock & requests~tyres=Tyres~tyresHint=Records, rotation & replacements~overdue=Overdue~dueSoon=Due soon~active=Active plans~due=Due now~all=All plans~empty=No maintenance plans~emptyDue=No preventive maintenance is due in the next 14 days.~emptyAll=No active preventive maintenance plans are available.~plan=Maintenance plan~daysOverdue=days overdue~daysLeft=days left~noDate=No due date~record=Record service~meter=Meter reading~performedBy=Performed by~workshop=Workshop~partsCost=Parts cost~labourCost=Labour cost~findings=Findings~completed=Completed~partial=Partially completed~deferred=Deferred~failed=Failed~save=Save service~invalidNumber=Enter valid numeric values.~loadFailed=The maintenance plans could not be loaded.~saveFailed=The service record could not be saved. Try again.~openBreakdowns=Open breakdowns~activeWorkOrders=Active work orders~breakdown=Breakdown~workOrder=Work order~dueToday=Due today~since=Since~opened=Opened~queueEmpty=Nothing needs attention~woLoadFailed=Open work orders could not be loaded.~retry=Retry~countFailed=This count could not be loaded. Tap to retry.'**
  String get pmCopyCatalog;

  /// No description provided for @stockCountCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'title=Stock Count~items=Items~reorder=Need reorder~notToday=Not counted~search=Search description or site~all=All~low=Low stock~stale=Not counted today~empty=No stock items~emptyBody=No stock records match these filters.~count=Count~stockItem=Stock item~physicalCount=Physical count~reason=Reason (optional)~cancel=Cancel~save=Save count~invalid=Enter a count of zero or more.~offlineSaved=Count saved offline and queued for sync.~saveFailed=The stock count could not be saved.~loadFailed=Stock records could not be loaded.~Critical=Critical~Low=Low~OK=OK~onHand=on hand'**
  String get stockCountCopyCatalog;

  /// No description provided for @calendarCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'title=Today\'s field plan~scheduled=scheduled~overdue=Overdue~today=Due today~week=This week~later=Later~inspection=Inspection~maintenance=Maintenance~task=Corrective task~empty=Nothing scheduled~emptyBody=Upcoming inspections, maintenance and corrective tasks will appear here.~loadFailed=The schedule could not be loaded.'**
  String get calendarCopyCatalog;

  /// No description provided for @managementCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'overviewTitle=Fleet Overview~analyticsTitle=Fleet Analytics~reportsTitle=Financial report~reportsSubtitle=Live executive cost and performance~teamTitle=Team~last=Last~days=days~days30=30 days~days90=90 days~year1=1 year~allSites=All sites~tyres=Tyres~vehicles=Vehicles~critical=Critical~openActions=Open actions~highRisk=High risk~inspections30=Inspections (30d)~tyreSpend=Tyre spend~risk=Risk distribution~sites=Top sites~brands=Top brands~analyticsFailed=Analytics could not be loaded.~reportsFailed=Report data could not be loaded.~reportUnavailable=Live report unavailable~reportUnavailableBody=The authoritative server snapshot is not available. No figures were fabricated.~retry=Retry~generated=Generated~costPerformance=Cost and performance~fleet=Fleet~tyre_spend=Tyre spend~accidents=Accidents~open_accidents=Open accidents~claims_claimed=Claims submitted~claims_recovered=Claims recovered~inspections=Inspections~work_orders_open=Open work orders~tyre_cost=Tyre cost~maintenance_cost=Maintenance cost~total_cost=Total cost~km=Kilometres~engine_hours=Engine hours~m3=Production m3~cost_per_km=Cost per km~cost_per_hour=Cost per hour~cost_per_m3=Cost per m3~tyre_cpk=Tyre CPK~severity=Accident severity~accidents_by_site=Accidents by site~tyres_by_site=Tyres by site~claim_status=Claim status~members=members~manage=Manage team~active=Active~pending=Pending~teamSearch=Search name, role or site~noMembers=No team members~trySearch=Try a different search.~teamFailed=The team directory could not be loaded.'**
  String get managementCopyCatalog;

  /// No description provided for @profileSignOutConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign out?'**
  String get profileSignOutConfirmTitle;

  /// Reassures the field worker that signing out does not touch the offline command queue or any draft - see AuthController.signOut's own library comment for exactly what it does and does not clear.
  ///
  /// In en, this message translates to:
  /// **'You will need to sign in again to continue working. Anything already saved on this device stays saved.'**
  String get profileSignOutConfirmMessage;

  /// No description provided for @accidentCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'loadFailed=The accident record could not be loaded. Try again.~notRecorded=Not recorded~dashboardTitle=Accident command centre~dashboardSubtitle=Live register • permission-scoped~reportAction=Report accident~reportShort=Report~loadingRegister=Loading accident register…~dashboardEyebrow=PMV incident control~dashboardHeroTitle=Every case, one accountable trail~dashboardHeroMessage=Fleet, insurance, workshop, QC, handover and recovery remain visible without invented KPIs.~searchHint=Search asset, reference, site or location~allCases=All cases~reportedByMe=Reported by me~anyStatus=Any status~open=Open~closed=Closed~noMatches=No matching cases~noMatchesMessage=Change the filters or create a new accident report.~loadMore=Load more cases~loading=Loading…~detailTitle=Accident detail~loadingFacts=Loading case facts…~notFound=Accident not found~notFoundMessage=This record is outside your access scope or no longer exists.~openFlow=Open accountable case flow~incidentFacts=Incident facts~incidentFactsHint=Reporter evidence and vehicle identity~liability=Liability & payment~liabilityHint=Who was at fault, liable and expected to pay~insurance=Insurance & recovery~insuranceHint=Claim and recovery remain distinct from closure~workshopRelease=Workshop & release~workshopReleaseHint=Assessment, repair, QC and vehicle return~closure=Closure controls~closureHint=Legacy approval and modern case status remain separate~vehicleType=Vehicle type~plate=Plate / fleet number~type=Accident type~severity=Severity~reporter=Reporter~evidenceFiles=Evidence files~description=Description~damage=Damage~fault=Fault status~responsible=Responsible party~liable=Liable party~payer=Payer~insurer=Insurer~policy=Policy~claimNo=Claim number~claimStatus=Claim status~claimed=Claimed amount~approved=Approved amount~recoveryStatus=Recovery status~recovered=Recovered amount~repairType=Repair type~workshop=Workshop~repairCost=Repair cost~expectedRelease=Expected release~actualRelease=Actual release~nextAction=Next action~workflowStage=Workflow stage~caseStatus=Case status~closureRequest=Closure request~closureLevel=Closure level~caseTitle=Case accountability~caseId=Case ID~incidentDateLabel=Incident date~damageMapTitle=Damage map~damageMapHint=Tap a zone to mark damage~damageMapZonesLabel=zone(s) marked~damageMapNoneMarked=No zones marked yet~damageViewFront=Front~damageViewRear=Rear~damageViewLeft=Left side~damageViewRight=Right side~damageViewTop=Top~zoneFrontBumper=Front bumper~zoneHood=Hood~zoneWindshield=Windshield~zoneLeftHeadlight=Left headlight~zoneRightHeadlight=Right headlight~zoneRearBumper=Rear bumper~zoneTailgate=Tailgate~zoneRearWindshield=Rear glass~zoneLeftTailLight=Left tail light~zoneRightTailLight=Right tail light~zoneFrontFender=Front fender~zoneFrontDoor=Front door~zoneRearDoor=Rear door~zoneRearFender=Rear fender~zoneMirror=Side mirror~zoneRoof=Roof~damageMarkSeverityLabel=Severity~damageMarkNoteLabel=Note (optional)~damageMarkSave=Save mark~damageMarkRemove=Remove mark~loadingWorkstreams=Loading case workstreams…~caseNotFound=Case not found~caseNotFoundMessage=This accident is outside your permission scope or no longer exists.~endToEnd=End-to-end case flow~notActivated=Case workflow not activated~notActivatedMessage=The incident exists, but the workstream model is not provisioned. No progress was inferred.~noWorkstreams=No workstreams assigned~noWorkstreamsMessage=The case model is available, but this accident has no routed workstreams yet.~timeline=Accountable timeline~timelineHint=Read-only truth from the case workstream ledger~boundary=Control boundary~boundaryHint=Actions are intentionally not fabricated~boundaryMessage=Insurance, assessment, repair, QC, handover, closure and recovery decisions require verified server actions. This view offers no unsafe direct edits.~done=Done~inProgress=In progress~pending=Pending~notRequired=Not required~reason=Reason~wsIncident=Incident & evidence~wsFleet=Fleet validation~wsLiability=Liability & safety~wsInsurance=Insurance claim~wsAssessment=Workshop assessment~wsRepair=Repair execution~wsQc=Workshop QC~wsHandover=Vehicle handover~wsFinance=Recovery & finance~wsCorrective=Corrective actions~selectAsset=Select fleet asset~changeAsset=Change fleet asset~assetSearch=Asset, fleet number, plate or model~unrecordedAsset=Unrecorded asset~photoFailed=The evidence photo could not be saved. Try again.~workspaceLoading=Your workspace is still loading. Try again.~required=Asset, site, description and at least one evidence photo are required.~fieldsDropped=The report could not preserve every field. Nothing was presented as submitted.~saveFailed=The report could not be saved on this device. Try again.~saved=Report saved~savedTitle=Accident report saved safely~savedMessage=The report and evidence are in the device sync queue and will upload under the active workspace.~backRegister=Back to accident register~reportTitle=Report an accident~reportSubtitle=Offline-safe evidence capture~firstResponse=First response~captureFacts=Capture facts at the scene~captureFactsMessage=Select the asset first so PMV master data can fill its site and identity. At least one evidence photo is mandatory.~assetLocation=1. Asset & location~assetLocationHint=Fleet master is authoritative when available~fleetUnavailable=Fleet lookup is unavailable. Manual entry remains available.~assetNo=Asset number~site=Site~exactLocation=Exact incident location~classification=2. Classification~classificationHint=Initial field classification can be reviewed later~minor=Minor~moderate=Moderate~severe=Severe~fatal=Fatal~collision=Collision~rollover=Rollover~propertyDamage=Property damage~other=Other~whatHappened=What happened?~notes=Immediate notes~evidence=3. Evidence~evidenceAttached=evidence photo(s) attached • minimum 1~camera=Camera~gallery=Gallery~evidencePhoto=Evidence photo~removePhoto=Remove photo~saveReport=Save accident report'**
  String get accidentCopyCatalog;

  /// No description provided for @washEvidenceTitle.
  ///
  /// In en, this message translates to:
  /// **'Checklist and chemicals'**
  String get washEvidenceTitle;

  /// No description provided for @washEnteredByLabel.
  ///
  /// In en, this message translates to:
  /// **'Entered by'**
  String get washEnteredByLabel;

  /// No description provided for @washChemicalUseLabel.
  ///
  /// In en, this message translates to:
  /// **'Chemicals used'**
  String get washChemicalUseLabel;

  /// No description provided for @washNotRecorded.
  ///
  /// In en, this message translates to:
  /// **'Not recorded'**
  String get washNotRecorded;

  /// No description provided for @washNoChemical.
  ///
  /// In en, this message translates to:
  /// **'No chemical used'**
  String get washNoChemical;

  /// No description provided for @washChemicalUsed.
  ///
  /// In en, this message translates to:
  /// **'Chemical used'**
  String get washChemicalUsed;

  /// No description provided for @washProductName.
  ///
  /// In en, this message translates to:
  /// **'Product name'**
  String get washProductName;

  /// No description provided for @washManufacturer.
  ///
  /// In en, this message translates to:
  /// **'Manufacturer'**
  String get washManufacturer;

  /// No description provided for @washQuantity.
  ///
  /// In en, this message translates to:
  /// **'Quantity and unit'**
  String get washQuantity;

  /// No description provided for @washDilution.
  ///
  /// In en, this message translates to:
  /// **'Dilution used (per product label)'**
  String get washDilution;

  /// No description provided for @washAddProduct.
  ///
  /// In en, this message translates to:
  /// **'Add product'**
  String get washAddProduct;

  /// No description provided for @washRemoveProduct.
  ///
  /// In en, this message translates to:
  /// **'Remove product'**
  String get washRemoveProduct;

  /// No description provided for @washChecklistTitle.
  ///
  /// In en, this message translates to:
  /// **'Wash checklist'**
  String get washChecklistTitle;

  /// No description provided for @washCheckExterior.
  ///
  /// In en, this message translates to:
  /// **'Exterior surfaces'**
  String get washCheckExterior;

  /// No description provided for @washCheckGlass.
  ///
  /// In en, this message translates to:
  /// **'Windows, mirrors and lights'**
  String get washCheckGlass;

  /// No description provided for @washCheckWheels.
  ///
  /// In en, this message translates to:
  /// **'Wheels and wheel arches'**
  String get washCheckWheels;

  /// No description provided for @washCheckCab.
  ///
  /// In en, this message translates to:
  /// **'Cab interior'**
  String get washCheckCab;

  /// No description provided for @washCheckRinse.
  ///
  /// In en, this message translates to:
  /// **'Final rinse and visible residue'**
  String get washCheckRinse;

  /// No description provided for @washNotChecked.
  ///
  /// In en, this message translates to:
  /// **'Not checked'**
  String get washNotChecked;

  /// No description provided for @washChecked.
  ///
  /// In en, this message translates to:
  /// **'Checked'**
  String get washChecked;

  /// No description provided for @washIssueFound.
  ///
  /// In en, this message translates to:
  /// **'Issue found'**
  String get washIssueFound;

  /// No description provided for @washNotApplicable.
  ///
  /// In en, this message translates to:
  /// **'Not applicable'**
  String get washNotApplicable;

  /// No description provided for @washIssueNote.
  ///
  /// In en, this message translates to:
  /// **'Issue details / comment'**
  String get washIssueNote;

  /// No description provided for @washEvidenceRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter product names and describe any checklist issues.'**
  String get washEvidenceRequired;

  /// No description provided for @washViewRecord.
  ///
  /// In en, this message translates to:
  /// **'View wash record'**
  String get washViewRecord;

  /// No description provided for @washReceivedAt.
  ///
  /// In en, this message translates to:
  /// **'Received at'**
  String get washReceivedAt;

  /// No description provided for @washSearchHistory.
  ///
  /// In en, this message translates to:
  /// **'Search vehicle, person or site'**
  String get washSearchHistory;

  /// No description provided for @washMyEntries.
  ///
  /// In en, this message translates to:
  /// **'My entries'**
  String get washMyEntries;

  /// No description provided for @washAllEntries.
  ///
  /// In en, this message translates to:
  /// **'All entries'**
  String get washAllEntries;

  /// No description provided for @washSavedOnDevice.
  ///
  /// In en, this message translates to:
  /// **'Saved on this device. Upload status is available in Sync.'**
  String get washSavedOnDevice;

  /// No description provided for @washHistoryLimit.
  ///
  /// In en, this message translates to:
  /// **'History is too large to load completely. Use the web report.'**
  String get washHistoryLimit;

  /// No description provided for @workshopCopyCatalog.
  ///
  /// In en, this message translates to:
  /// **'title=My Jobs~onDuty=On duty~offDuty=Off duty~checkIn=Check In~checkOut=Check Out~checkInHint=Check in for your shift before recording work.~myJobs=My jobs~emptyTitle=No open jobs~emptyMessage=No open job is assigned to you right now.~loadError=Your jobs could not be loaded right now.~selectJobTitle=Select a job~selectJobMsg=Pick one of your jobs first.~checkInFirstTitle=Check in first~selectTaskTitle=Select a task~selectTaskMsg=Pick the task you are working on first.~tasks=Tasks~confirmTitle=Complete task?~confirmMsg=This records the task as complete and sends it for inspection.~cancel=Cancel~noteHint=Add a note (optional)~record=Record~queued=Saved on this device. It will sync automatically.~saveFailed=The activity could not be saved on this device. Try again.~todayTitle=My productivity today~productive=Productive~blocked=Blocked~unassigned=Unassigned~breakTime=Break~completed=Tasks completed~due=Due~ok=OK~a_start_job=Start Job~a_pause_job=Pause Job~a_resume_job=Resume Job~a_complete_task=Complete Task~a_request_parts=Request Parts~a_request_assistance=Request Assistance~a_waiting_approval=Waiting for Approval~a_waiting_vehicle=Waiting for Vehicle~a_waiting_tools=Waiting for Tools~a_start_break=Start Break~a_end_break=End Break~a_report_problem=Report Problem~s_working=Working~s_available=Available~s_waiting_parts=Waiting for Parts~s_waiting_approval=Waiting for Approval~s_waiting_tools=Waiting for Tools~s_waiting_vehicle=Waiting for Vehicle~s_on_break=On Break~s_training=Training~s_awaiting_inspection=Awaiting Inspection~s_off_duty=Off Duty~s_absent=Absent~photoLabel=Photo (optional)~takePhoto=Camera~pickPhoto=Gallery~removePhoto=Remove photo~photoLimit=Up to 3 photos~photoNotAttached=Recorded. The photo could not be attached without a connection.'**
  String get workshopCopyCatalog;

  /// Home section heading for the work the signed-in user has today.
  ///
  /// In en, this message translates to:
  /// **'Today\'s work'**
  String get homeTodaysWork;

  /// Tag on a Home work card for an item waiting for the user's signature.
  ///
  /// In en, this message translates to:
  /// **'Awaiting signature'**
  String get homeAwaitingSignatureTag;

  /// Home work card title for an inspection draft that can be resumed.
  ///
  /// In en, this message translates to:
  /// **'Resume inspection'**
  String get homeResumeInspection;

  /// Home work card title when a recorded tyre issue needs follow-up.
  ///
  /// In en, this message translates to:
  /// **'Tyre issue needs attention'**
  String get homeTyreIssueNeedsAttention;

  /// Profile section header for the user's role, country and site access.
  ///
  /// In en, this message translates to:
  /// **'Workspace'**
  String get profileSectionWorkspace;

  /// Label beside the employee ID on the profile identity header.
  ///
  /// In en, this message translates to:
  /// **'Employee ID'**
  String get profileEmployeeIdLabel;

  /// Profile settings row label that opens the language picker.
  ///
  /// In en, this message translates to:
  /// **'App language'**
  String get profileLanguageLabel;

  /// Profile section header for language and theme settings.
  ///
  /// In en, this message translates to:
  /// **'Language & display'**
  String get profileSectionDisplay;

  /// Profile settings row label that opens the theme picker.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get profileThemeLabel;

  /// Theme picker option: light theme.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get profileThemeLight;

  /// Theme picker option: dark theme.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get profileThemeDark;

  /// Theme picker option: follow the device theme.
  ///
  /// In en, this message translates to:
  /// **'System default'**
  String get profileThemeSystem;

  /// Profile section header for the offline queue status.
  ///
  /// In en, this message translates to:
  /// **'Offline & data'**
  String get profileSectionOffline;

  /// Shown under Sign out while work is still queued: signing out does not delete it.
  ///
  /// In en, this message translates to:
  /// **'Unsynced drafts remain safely on this device'**
  String get profileUnsyncedFooter;

  /// Login hero headline over the country artwork.
  ///
  /// In en, this message translates to:
  /// **'Complete PMV Operations'**
  String get loginHeroTitle;

  /// Subtitle under the login welcome title.
  ///
  /// In en, this message translates to:
  /// **'Sign in to your assigned operations'**
  String get loginSignInSubtitle;

  /// Vehicle detail primary action that starts an inspection for this vehicle.
  ///
  /// In en, this message translates to:
  /// **'Inspect now'**
  String get vehiclesInspectNow;

  /// Inspection tyre stepper: go to the previous tyre position.
  ///
  /// In en, this message translates to:
  /// **'Previous'**
  String get inspectionPreviousTyre;

  /// Inspection tyre stepper: go to the next tyre position.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get inspectionNextTyre;

  /// Heading of the inspection progress card.
  ///
  /// In en, this message translates to:
  /// **'Inspection progress'**
  String get inspectionProgressTitle;

  /// Inspection completion percentage.
  ///
  /// In en, this message translates to:
  /// **'{percent}% complete'**
  String inspectionPercentComplete(int percent);

  /// Axle heading in the inspection tyre layout.
  ///
  /// In en, this message translates to:
  /// **'Axle {number}'**
  String inspectionAxleNumber(int number);

  /// Label for the tyre count in the inspection progress card.
  ///
  /// In en, this message translates to:
  /// **'Tyres'**
  String get inspectionTyresLabel;

  /// New Inspection asset picker: full-width button that opens the scanner to pick an asset by its code.
  ///
  /// In en, this message translates to:
  /// **'Scan asset'**
  String get inspectionScanAssetButton;

  /// New Inspection asset picker: heading on the card showing the asset chosen for this inspection.
  ///
  /// In en, this message translates to:
  /// **'Selected asset'**
  String get inspectionSelectedAssetTitle;

  /// Shown under Sign out when the offline queue count could not be read: unknown is treated as possibly unsynced work, never as all synced.
  ///
  /// In en, this message translates to:
  /// **'Pending sync could not be checked. Unsynced work may still be on this device'**
  String get profileSyncUnknownFooter;

  /// Home: heading of the strip listing the assets the signed-in user inspected most recently, each with the worst tyre condition that inspection recorded.
  ///
  /// In en, this message translates to:
  /// **'Your recent inspections'**
  String get homeRecentInspectionsTitle;

  /// Home recent-inspection card: status when that inspection recorded no tyre condition with evidence.
  ///
  /// In en, this message translates to:
  /// **'Not checked'**
  String get homeAssetNotChecked;

  /// Home Today's work: shown when no work source (drafts, tyre alerts, sign-offs) applies to the signed-in role, so 'nothing needs you' cannot be claimed.
  ///
  /// In en, this message translates to:
  /// **'Nothing to check for your role'**
  String get homeNothingForRoleTitle;

  /// Take Action: Rotate tyre row subtitle
  ///
  /// In en, this message translates to:
  /// **'Record that this tyre was moved to another position'**
  String get tyreActionRotateSubtitle;

  /// Rotate sheet: read-only current position field
  ///
  /// In en, this message translates to:
  /// **'Current position'**
  String get tyreActionRotateFromLabel;

  /// Rotate sheet: destination position field
  ///
  /// In en, this message translates to:
  /// **'New position'**
  String get tyreActionRotateToLabel;

  /// Rotate sheet: destination position hint
  ///
  /// In en, this message translates to:
  /// **'For example RHF1'**
  String get tyreActionRotateToHint;

  /// Rotate sheet: notes field
  ///
  /// In en, this message translates to:
  /// **'Notes (optional)'**
  String get tyreActionRotateNotesLabel;

  /// Rotate sheet: notes hint
  ///
  /// In en, this message translates to:
  /// **'Anything the next fitter should know'**
  String get tyreActionRotateNotesHint;

  /// Rotate sheet: helper stating the write is online only
  ///
  /// In en, this message translates to:
  /// **'Needs a connection. Rotations are saved straight to the server.'**
  String get tyreActionRotateOnlineNote;

  /// Rotate sheet: submit button
  ///
  /// In en, this message translates to:
  /// **'Record rotation'**
  String get tyreActionRotateSubmit;

  /// Rotate sheet: validation dialog title
  ///
  /// In en, this message translates to:
  /// **'New position needed'**
  String get tyreActionRotateToRequiredTitle;

  /// Rotate sheet: destination missing
  ///
  /// In en, this message translates to:
  /// **'Enter the position this tyre was moved to.'**
  String get tyreActionRotateToRequiredMessage;

  /// Rotate sheet: destination equals current position
  ///
  /// In en, this message translates to:
  /// **'The new position must be different from the current one.'**
  String get tyreActionRotateSamePositionMessage;

  /// Rotate sheet: success dialog title
  ///
  /// In en, this message translates to:
  /// **'Rotation recorded'**
  String get tyreActionRotateSavedTitle;

  /// Rotate sheet: success message, states the register is not rewritten
  ///
  /// In en, this message translates to:
  /// **'The rotation is saved in this tyre\'s service history. It does not change the position shown in the tyre register.'**
  String get tyreActionRotateSavedMessage;

  /// Rotate sheet: failure dialog title
  ///
  /// In en, this message translates to:
  /// **'Rotation not saved'**
  String get tyreActionRotateFailedTitle;

  /// Rotate sheet: network failure, honest not-saved message
  ///
  /// In en, this message translates to:
  /// **'No connection. Rotations are saved online only, so this one was not recorded. Try again when you are connected.'**
  String get tyreActionRotateOfflineMessage;

  /// Rotate sheet: generic failure message
  ///
  /// In en, this message translates to:
  /// **'The rotation could not be saved. Try again.'**
  String get tyreActionRotateFailedMessage;

  /// Driver workspace: display name for a workflow action, fine resolution, review decision, fine status, response status or linked record type. Keys are the server tokens; an unknown token renders empty and the app falls back to the token itself.
  ///
  /// In en, this message translates to:
  /// **'{term, select, create_driver{Add verified driver} link_account{Link login account} assign_team{Assign team and vehicle} create_fine{Issue traffic fine} link_record{Link work record} respond_fine{Review and sign} review_fine{Review response / payment} correct_fine{Correct fine} reassign_fine{Reassign fine} direct_payment{I will pay directly} already_paid{Already paid} dispute{Dispute / incorrect assignment} company_recovery{Request company payment / recovery} instalments{Request instalments} approve{Approve request} return{Return to driver} payment{Record verified payment} cancel{Cancel fine} reopen{Reopen} open{Open} settled{Settled} cancelled{Cancelled} awaiting_response{Awaiting response} submitted{Response submitted} returned{Returned to driver} approved{Approved} driver_documents{Driver documents} driver_training{Driver training} driver_coaching{Driver coaching} driver_safety_events{Driver safety events} driver_expenses{Driver expenses} tyre_records{Tyre records} accidents{Accidents} wo_tasks{Work order tasks} checklist_submissions{Checklist submissions} odometer_logs{Odometer readings} wash_records{Wash records} other{}}'**
  String driverWsTerm(String term);

  /// Driver workspace: label for a column of a linked work record. Unknown columns render empty and the app shows the column name.
  ///
  /// In en, this message translates to:
  /// **'{field, select, country{Country} site{Site} asset_no{Asset number} driver_name{Driver name} title{Title} doc_type{Document type} doc_number{Document number} expiry_date{Expiry date} course_name{Course name} result{Result} completed_date{Completed date} coaching_status{Coaching status} period{Period} event_type{Event type} severity{Severity} event_at{Event time} category{Category} amount{Amount} currency{Currency} expense_date{Expense date} status{Status} incident_date{Incident date} accident_type{Accident type} due_date{Due date} created_at{Created at} reading_date{Reading date} odometer_km{Odometer (km)} wash_date{Wash date} template_name{Checklist name} approval_status{Approval status} brand{Brand} serial_no{Serial number} issue_date{Issue date} qty{Quantity} cost_per_tyre{Cost per tyre} other{}}'**
  String driverWsRecordField(String field);

  /// Driver workspace: kind of evidence attached to a fine.
  ///
  /// In en, this message translates to:
  /// **'{kind, select, payment{Payment receipt} supporting{Supporting photo} notice{Official notice} other{}}'**
  String driverWsEvidenceKind(String kind);

  /// Driver workspace: title.
  ///
  /// In en, this message translates to:
  /// **'Driver workspace'**
  String get driverWsTitle;

  /// Driver workspace: Profile entry subtitle.
  ///
  /// In en, this message translates to:
  /// **'My fines, team assignments and verified work'**
  String get driverWsEntrySubtitle;

  /// Driver workspace: load failure.
  ///
  /// In en, this message translates to:
  /// **'Workspace unavailable. Check connection, account linking and access, then refresh.'**
  String get driverWsLoadError;

  /// Driver workspace: refresh tooltip.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get driverWsRefresh;

  /// Driver workspace: no session.
  ///
  /// In en, this message translates to:
  /// **'Sign in to view your workspace.'**
  String get driverWsSignInRequired;

  /// Driver workspace: offline notice.
  ///
  /// In en, this message translates to:
  /// **'Offline cached view. Connect and refresh before responding or reviewing.'**
  String get driverWsOfflineNotice;

  /// Driver workspace: truncated view notice.
  ///
  /// In en, this message translates to:
  /// **'This view is incomplete because it reached the record limit. Export is disabled.'**
  String get driverWsTruncatedNotice;

  /// Driver workspace: driver search label.
  ///
  /// In en, this message translates to:
  /// **'Search drivers'**
  String get driverWsSearchDrivers;

  /// Driver workspace: empty driver list.
  ///
  /// In en, this message translates to:
  /// **'No linked driver or assigned team is available. Ask an authorized manager to verify your account and assignment.'**
  String get driverWsNoDrivers;

  /// Driver workspace: share statement button.
  ///
  /// In en, this message translates to:
  /// **'Share fine statement PDF'**
  String get driverWsSharePdf;

  /// Driver workspace: PDF share failure.
  ///
  /// In en, this message translates to:
  /// **'Report could not be shared. Try again.'**
  String get driverWsReportShareError;

  /// Driver workspace: section heading.
  ///
  /// In en, this message translates to:
  /// **'Traffic fines'**
  String get driverWsTrafficFines;

  /// Driver workspace: no fines.
  ///
  /// In en, this message translates to:
  /// **'No fines recorded.'**
  String get driverWsNoFines;

  /// Driver workspace: section heading.
  ///
  /// In en, this message translates to:
  /// **'Team and vehicle assignment history'**
  String get driverWsAssignmentHistory;

  /// Driver workspace: no assignments.
  ///
  /// In en, this message translates to:
  /// **'No assignment recorded.'**
  String get driverWsNoAssignment;

  /// Driver workspace: current assignment tag.
  ///
  /// In en, this message translates to:
  /// **'Current'**
  String get driverWsAssignmentCurrent;

  /// Driver workspace: previous assignment tag.
  ///
  /// In en, this message translates to:
  /// **'Previous'**
  String get driverWsAssignmentPrevious;

  /// Driver workspace: assignment without vehicle.
  ///
  /// In en, this message translates to:
  /// **'No vehicle'**
  String get driverWsNoVehicle;

  /// Driver workspace: no supervisor or manager.
  ///
  /// In en, this message translates to:
  /// **'Not assigned'**
  String get driverWsNotAssigned;

  /// Driver workspace: open-ended assignment end.
  ///
  /// In en, this message translates to:
  /// **'Present'**
  String get driverWsPresent;

  /// Driver workspace: section heading.
  ///
  /// In en, this message translates to:
  /// **'Assigned work'**
  String get driverWsAssignedWork;

  /// Driver workspace: missing value.
  ///
  /// In en, this message translates to:
  /// **'Not supplied'**
  String get driverWsNotSupplied;

  /// Driver workspace: section heading.
  ///
  /// In en, this message translates to:
  /// **'Verified work and driver records'**
  String get driverWsVerifiedRecords;

  /// Driver workspace: records notice.
  ///
  /// In en, this message translates to:
  /// **'Unmatched historical records require identity review before they appear here.'**
  String get driverWsUnmatchedNotice;

  /// Driver workspace: deleted linked record.
  ///
  /// In en, this message translates to:
  /// **'Record no longer available'**
  String get driverWsRecordUnavailable;

  /// Driver workspace: section heading.
  ///
  /// In en, this message translates to:
  /// **'Activity history'**
  String get driverWsActivityHistory;

  /// Driver workspace: event with no actor name.
  ///
  /// In en, this message translates to:
  /// **'Recorded user'**
  String get driverWsRecordedUser;

  /// Driver workspace: photo upload failure.
  ///
  /// In en, this message translates to:
  /// **'Photo could not be attached. Your local photo has not been deleted.'**
  String get driverWsPhotoError;

  /// Driver workspace: driver response button.
  ///
  /// In en, this message translates to:
  /// **'Acknowledge and respond'**
  String get driverWsAcknowledgeRespond;

  /// Driver workspace: staff review button.
  ///
  /// In en, this message translates to:
  /// **'Review / record payment'**
  String get driverWsReviewPayment;

  /// Driver workspace: evidence open failure.
  ///
  /// In en, this message translates to:
  /// **'Evidence could not be opened.'**
  String get driverWsEvidenceOpenError;

  /// Driver workspace: attach button.
  ///
  /// In en, this message translates to:
  /// **'Attach receipt photo'**
  String get driverWsAttachReceipt;

  /// Driver workspace: attach button.
  ///
  /// In en, this message translates to:
  /// **'Attach supporting photo'**
  String get driverWsAttachSupporting;

  /// Driver workspace: attach button.
  ///
  /// In en, this message translates to:
  /// **'Attach official notice photo'**
  String get driverWsAttachNotice;

  /// Driver workspace: signature load failure.
  ///
  /// In en, this message translates to:
  /// **'Signature unavailable.'**
  String get driverWsSignatureUnavailable;

  /// Driver workspace: view signature.
  ///
  /// In en, this message translates to:
  /// **'View signed acknowledgment'**
  String get driverWsViewSignature;

  /// Driver workspace: signature render failure.
  ///
  /// In en, this message translates to:
  /// **'Signature could not be displayed.'**
  String get driverWsSignatureDisplayError;

  /// Driver workspace: signed receipt statement, version receipt-v1. The wording is a recorded legal statement: do not change it without a new statement_version.
  ///
  /// In en, this message translates to:
  /// **'I acknowledge receipt and review of this notice and submit the response shown above. Receipt does not mean admission of responsibility. A payment or recovery request does not authorize an automatic payment or payroll deduction.'**
  String get driverWsReceiptStatement;

  /// Driver workspace: draft read failure.
  ///
  /// In en, this message translates to:
  /// **'Saved draft could not be read. Nothing has been overwritten.'**
  String get driverWsDraftReadError;

  /// Driver workspace: submit failure.
  ///
  /// In en, this message translates to:
  /// **'Could not submit. Check the required fields and connection. Refresh if the notice changed.'**
  String get driverWsSubmitError;

  /// Driver workspace: form notice.
  ///
  /// In en, this message translates to:
  /// **'Submission requires a connection so the current notice and your access can be checked.'**
  String get driverWsConnectionRequired;

  /// Driver workspace: draft saved.
  ///
  /// In en, this message translates to:
  /// **'Draft saved. It has not been submitted.'**
  String get driverWsDraftSaved;

  /// Driver workspace: draft save failure.
  ///
  /// In en, this message translates to:
  /// **'Draft could not be saved.'**
  String get driverWsDraftSaveError;

  /// Driver workspace: save draft button.
  ///
  /// In en, this message translates to:
  /// **'Save draft on this device'**
  String get driverWsSaveDraft;

  /// Driver workspace: review disclaimer.
  ///
  /// In en, this message translates to:
  /// **'Approval records the reviewed arrangement. It does not execute payment or payroll deduction. Record only verified payments.'**
  String get driverWsReviewDisclaimer;

  /// Driver workspace: submit in progress.
  ///
  /// In en, this message translates to:
  /// **'Saving...'**
  String get driverWsSaving;

  /// Driver workspace: submit button.
  ///
  /// In en, this message translates to:
  /// **'Submit'**
  String get driverWsSubmit;

  /// Driver workspace: validation.
  ///
  /// In en, this message translates to:
  /// **'Choose a resolution.'**
  String get driverWsErrResolution;

  /// Driver workspace: validation.
  ///
  /// In en, this message translates to:
  /// **'Explain your request, including the proposed arrangement.'**
  String get driverWsErrExplanation;

  /// Driver workspace: validation.
  ///
  /// In en, this message translates to:
  /// **'Enter your payment reference.'**
  String get driverWsErrPaymentReference;

  /// Driver workspace: validation.
  ///
  /// In en, this message translates to:
  /// **'Choose your proposed payment date.'**
  String get driverWsErrProposedDate;

  /// Driver workspace: validation.
  ///
  /// In en, this message translates to:
  /// **'Review the statement and sign before submitting.'**
  String get driverWsErrSignature;

  /// Driver workspace: picker load failure.
  ///
  /// In en, this message translates to:
  /// **'Options unavailable. Try again.'**
  String get driverWsOptionsError;

  /// Driver workspace: picker search.
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get driverWsSearch;

  /// Driver workspace: picker clear.
  ///
  /// In en, this message translates to:
  /// **'None / clear selection'**
  String get driverWsClearSelection;

  /// Driver workspace: picker paging.
  ///
  /// In en, this message translates to:
  /// **'Previous options'**
  String get driverWsPreviousOptions;

  /// Driver workspace: picker paging.
  ///
  /// In en, this message translates to:
  /// **'More options'**
  String get driverWsMoreOptions;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Employee ID'**
  String get driverWsFieldEmployeeId;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Driver name'**
  String get driverWsFieldDriverName;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get driverWsFieldCountry;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get driverWsFieldSite;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Login account (none removes link)'**
  String get driverWsFieldLoginAccount;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Identity verification / reason'**
  String get driverWsFieldIdentityReason;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Supervisor'**
  String get driverWsFieldSupervisor;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Manager'**
  String get driverWsFieldManager;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Vehicle'**
  String get driverWsFieldVehicle;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Assignment reason'**
  String get driverWsFieldAssignmentReason;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Issuing authority'**
  String get driverWsFieldAuthority;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Notice reference'**
  String get driverWsFieldNoticeReference;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Incident date and time (YYYY-MM-DDTHH:mm)'**
  String get driverWsFieldIncidentAt;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Due date (YYYY-MM-DD)'**
  String get driverWsFieldDueDate;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Fine amount'**
  String get driverWsFieldAmount;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Currency code'**
  String get driverWsFieldCurrency;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Notice details'**
  String get driverWsFieldNoticeDetails;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Evidence confirming driver assignment'**
  String get driverWsFieldAssignmentEvidence;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Record type'**
  String get driverWsFieldRecordType;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Existing record'**
  String get driverWsFieldExistingRecord;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'How driver identity was verified'**
  String get driverWsFieldIdentityMethod;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Preferred resolution'**
  String get driverWsFieldResolution;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Explanation / proposed arrangement'**
  String get driverWsFieldExplanation;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Payment reference (if paid)'**
  String get driverWsFieldPaymentReference;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Proposed payment date (YYYY-MM-DD)'**
  String get driverWsFieldProposedDate;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Decision'**
  String get driverWsFieldDecision;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Review reason / approved arrangement'**
  String get driverWsFieldReviewReason;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Verified payment reference'**
  String get driverWsFieldVerifiedReference;

  /// Driver workspace: form field.
  ///
  /// In en, this message translates to:
  /// **'Verified payment amount'**
  String get driverWsFieldVerifiedAmount;

  /// Driver workspace: statement PDF column.
  ///
  /// In en, this message translates to:
  /// **'Notice'**
  String get driverWsPdfColNotice;

  /// Driver workspace: statement PDF column.
  ///
  /// In en, this message translates to:
  /// **'Currency'**
  String get driverWsPdfColCurrency;

  /// Driver workspace: statement PDF column.
  ///
  /// In en, this message translates to:
  /// **'Amount'**
  String get driverWsPdfColAmount;

  /// Driver workspace: statement PDF column.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get driverWsPdfColPaid;

  /// Driver workspace: statement PDF column.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get driverWsPdfColStatus;

  /// Driver workspace: statement PDF column.
  ///
  /// In en, this message translates to:
  /// **'Response'**
  String get driverWsPdfColResponse;

  /// Driver workspace: driver list row subtitle.
  ///
  /// In en, this message translates to:
  /// **'{site} · {open} open fines · {awaiting} awaiting response'**
  String driverWsDriverSubtitle(String site, String open, String awaiting);

  /// Driver workspace: outstanding balance line.
  ///
  /// In en, this message translates to:
  /// **'Outstanding: {amount} {currency}'**
  String driverWsOutstanding(String amount, String currency);

  /// Driver workspace: assignment card.
  ///
  /// In en, this message translates to:
  /// **'Supervisor: {name}'**
  String driverWsSupervisorLine(String name);

  /// Driver workspace: assignment card.
  ///
  /// In en, this message translates to:
  /// **'Manager: {name}'**
  String driverWsManagerLine(String name);

  /// Driver workspace: assignment period.
  ///
  /// In en, this message translates to:
  /// **'{start} to {end}'**
  String driverWsAssignmentPeriod(String start, String end);

  /// Driver workspace: fine assignment evidence.
  ///
  /// In en, this message translates to:
  /// **'Assignment: {reason}'**
  String driverWsAssignmentLine(String reason);

  /// Driver workspace: fine due and paid line.
  ///
  /// In en, this message translates to:
  /// **'Due: {due} · Paid: {paid}'**
  String driverWsDueLine(String due, String paid);

  /// Driver workspace: statement PDF heading.
  ///
  /// In en, this message translates to:
  /// **'Driver statement: {name}'**
  String driverWsPdfTitle(String name);

  /// Driver workspace: statement PDF line.
  ///
  /// In en, this message translates to:
  /// **'Employee ID: {id}'**
  String driverWsPdfEmployeeId(String id);

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Transit mixer'**
  String get vehicleClassTransitMixer;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Concrete pump'**
  String get vehicleClassConcretePump;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Truck-mounted line pump'**
  String get vehicleClassLinePump;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Staff bus'**
  String get vehicleClassStaffBus;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Staff van'**
  String get vehicleClassStaffVan;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Double-cab pickup'**
  String get vehicleClassDoubleCabPickup;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Wheel loader'**
  String get vehicleClassWheelLoader;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Skid-steer loader'**
  String get vehicleClassSkidSteerLoader;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Towable concrete pump'**
  String get vehicleClassTowablePump;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Stationary concrete pump'**
  String get vehicleClassStationaryPump;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Enclosed generator'**
  String get vehicleClassGenerator;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Industrial chiller'**
  String get vehicleClassChiller;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Industrial water chiller'**
  String get vehicleClassWaterChiller;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Concrete batching plant'**
  String get vehicleClassBatchingPlant;

  /// Vehicle class name for a five-view reference board.
  ///
  /// In en, this message translates to:
  /// **'Freestanding placing boom'**
  String get vehicleClassPlacingBoom;

  /// Vehicle class name with axle count.
  ///
  /// In en, this message translates to:
  /// **'Concrete pump · {axles} axle'**
  String vehicleClassConcretePumpAxles(int axles);

  /// Vehicle class name with axle count.
  ///
  /// In en, this message translates to:
  /// **'Truck-mounted line pump · {axles} axle'**
  String vehicleClassLinePumpAxles(int axles);

  /// Scanner: camera failed to start for a reason other than permission.
  ///
  /// In en, this message translates to:
  /// **'The camera could not start'**
  String get scannerCameraStartFailedTitle;

  /// Scanner: camera start failure explanation.
  ///
  /// In en, this message translates to:
  /// **'Another app may be using it, or it stopped unexpectedly. Try again, or type the code below.'**
  String get scannerCameraStartFailedMessage;

  /// Management overview: per-site section heading.
  ///
  /// In en, this message translates to:
  /// **'Sites at a glance'**
  String get managementOverviewSiteRollup;

  /// Management overview: empty per-site rollup.
  ///
  /// In en, this message translates to:
  /// **'No site has recorded tyres in this period.'**
  String get managementOverviewSiteRollupEmpty;

  /// Management overview: risk share tile.
  ///
  /// In en, this message translates to:
  /// **'Tyres at high or critical risk'**
  String get managementOverviewAtRiskShare;

  /// Management reports: share action.
  ///
  /// In en, this message translates to:
  /// **'Share report PDF'**
  String get managementReportsShare;

  /// Management reports: share failure.
  ///
  /// In en, this message translates to:
  /// **'The report could not be shared. Try again.'**
  String get managementReportsShareError;

  /// Management reports: PDF column.
  ///
  /// In en, this message translates to:
  /// **'Metric'**
  String get managementReportsPdfMetric;

  /// Management reports: PDF column.
  ///
  /// In en, this message translates to:
  /// **'Value'**
  String get managementReportsPdfValue;

  /// Management reports: PDF column.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get managementReportsPdfShare;

  /// Team member detail field.
  ///
  /// In en, this message translates to:
  /// **'Role'**
  String get managementTeamRole;

  /// Team member detail field.
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get managementTeamUsername;

  /// Team member detail field.
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get managementTeamSite;

  /// Team member detail field.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get managementTeamCountry;

  /// Team member detail field.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get managementTeamPhone;

  /// Team member detail field.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get managementTeamEmail;

  /// Team member detail field.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get managementTeamStatus;

  /// Team member approved status.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get managementTeamApproved;

  /// Team member detail field.
  ///
  /// In en, this message translates to:
  /// **'Last sign-in'**
  String get managementTeamLastLogin;

  /// Team member missing value.
  ///
  /// In en, this message translates to:
  /// **'Not recorded'**
  String get managementTeamNotRecorded;

  /// Team member call action.
  ///
  /// In en, this message translates to:
  /// **'Call'**
  String get managementTeamCall;

  /// Team member email action.
  ///
  /// In en, this message translates to:
  /// **'Send email'**
  String get managementTeamSendEmail;

  /// Team member call/email could not launch.
  ///
  /// In en, this message translates to:
  /// **'This action is not available on this device.'**
  String get managementTeamActionError;

  /// Management overview: tyres at a site.
  ///
  /// In en, this message translates to:
  /// **'{count} tyres'**
  String managementOverviewSiteTyres(String count);

  /// Management overview: site share.
  ///
  /// In en, this message translates to:
  /// **'{percent}% of fleet tyres'**
  String managementOverviewSiteShare(String percent);

  /// Management reports: PDF period line.
  ///
  /// In en, this message translates to:
  /// **'Period: last {days} days'**
  String managementReportsPdfPeriod(int days);

  /// Management reports: PDF currency line.
  ///
  /// In en, this message translates to:
  /// **'Currency: {code}'**
  String managementReportsPdfCurrency(String code);

  /// Admin hub title
  ///
  /// In en, this message translates to:
  /// **'Admin console'**
  String get adminHubTitle;

  /// Admin hub subtitle
  ///
  /// In en, this message translates to:
  /// **'Users, access, approvals and sites'**
  String get adminHubSubtitle;

  /// Hub count label
  ///
  /// In en, this message translates to:
  /// **'Pending approvals'**
  String get adminHubPendingApprovals;

  /// Hub count label
  ///
  /// In en, this message translates to:
  /// **'Pending sign-ups'**
  String get adminHubPendingSignups;

  /// Hub count label
  ///
  /// In en, this message translates to:
  /// **'Locked users'**
  String get adminHubLockedUsers;

  /// Shown when a count query failed
  ///
  /// In en, this message translates to:
  /// **'Could not load'**
  String get adminHubCountUnavailable;

  /// Hub section header
  ///
  /// In en, this message translates to:
  /// **'Manage'**
  String get adminHubSectionManage;

  /// Hub section header
  ///
  /// In en, this message translates to:
  /// **'Reports and team'**
  String get adminHubSectionMore;

  /// Hub tile
  ///
  /// In en, this message translates to:
  /// **'Users'**
  String get adminHubUsersTitle;

  /// Hub tile subtitle
  ///
  /// In en, this message translates to:
  /// **'Approve, lock and change roles'**
  String get adminHubUsersSubtitle;

  /// Hub tile
  ///
  /// In en, this message translates to:
  /// **'Mobile access'**
  String get adminHubAccessTitle;

  /// Hub tile subtitle
  ///
  /// In en, this message translates to:
  /// **'Allow or deny app modules per person'**
  String get adminHubAccessSubtitle;

  /// Hub tile
  ///
  /// In en, this message translates to:
  /// **'Approvals'**
  String get adminHubApprovalsTitle;

  /// Hub tile subtitle
  ///
  /// In en, this message translates to:
  /// **'Inspections and checklists waiting for sign-off'**
  String get adminHubApprovalsSubtitle;

  /// Hub tile
  ///
  /// In en, this message translates to:
  /// **'Sites'**
  String get adminHubSitesTitle;

  /// Hub tile subtitle
  ///
  /// In en, this message translates to:
  /// **'Regions and active status'**
  String get adminHubSitesSubtitle;

  /// Hub tile
  ///
  /// In en, this message translates to:
  /// **'Fleet AI chat'**
  String get adminHubAiTitle;

  /// Hub tile subtitle
  ///
  /// In en, this message translates to:
  /// **'Ask questions about fleet management'**
  String get adminHubAiSubtitle;

  /// Subtitle on links to other modules
  ///
  /// In en, this message translates to:
  /// **'Open this module'**
  String get adminHubOpenModule;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'New Inspection'**
  String get adminModuleInspect;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Scan'**
  String get adminModuleScan;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Serial Search'**
  String get adminModuleSerial;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Tyre Change'**
  String get adminModuleTyreChange;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Checklists'**
  String get adminModuleChecklists;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Meter Log'**
  String get adminModuleMeter;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Vehicle Washing'**
  String get adminModuleWashing;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Report Issue'**
  String get adminModuleReportIssue;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Repair Request'**
  String get adminModuleRepairRequest;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Tyre Records'**
  String get adminModuleRecords;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Vehicles'**
  String get adminModuleVehicles;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get adminModuleHistory;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Alerts'**
  String get adminModuleAlerts;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Calendar'**
  String get adminModuleCalendar;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Accidents'**
  String get adminModuleAccidents;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'File Accident'**
  String get adminModuleReportAccident;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Work Orders'**
  String get adminModuleWorkorders;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Root Cause'**
  String get adminModuleRca;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Tasks'**
  String get adminModuleTasks;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Stock Count'**
  String get adminModuleStock;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Maintenance Due'**
  String get adminModulePm;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'My Jobs'**
  String get adminModuleWorkshop;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Overview'**
  String get adminModuleOverview;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Reports'**
  String get adminModuleReports;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Analytics'**
  String get adminModuleAnalytics;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Stock Management'**
  String get adminModuleStockManage;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Fleet AI'**
  String get adminModuleAi;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Team'**
  String get adminModuleTeam;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Approvals'**
  String get adminModuleApprovals;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'Admin Console'**
  String get adminModuleAdmin;

  /// Mobile module label in the admin access editor
  ///
  /// In en, this message translates to:
  /// **'User Management'**
  String get adminModuleUsers;

  /// Users screen title
  ///
  /// In en, this message translates to:
  /// **'Users'**
  String get adminUsersTitle;

  /// Users count
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 user} other{{count} users}}'**
  String adminUsersCount(int count);

  /// Search hint
  ///
  /// In en, this message translates to:
  /// **'Search name, username or employee ID'**
  String get adminUsersSearchHint;

  /// Filter: all
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get adminUsersFilterAll;

  /// User status
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get adminUsersStatusPending;

  /// User status
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get adminUsersStatusActive;

  /// User status
  ///
  /// In en, this message translates to:
  /// **'Locked'**
  String get adminUsersStatusLocked;

  /// Role filter: all
  ///
  /// In en, this message translates to:
  /// **'All roles'**
  String get adminUsersAllRoles;

  /// Empty state title
  ///
  /// In en, this message translates to:
  /// **'No users match'**
  String get adminUsersEmptyTitle;

  /// Empty state message
  ///
  /// In en, this message translates to:
  /// **'Try another search or filter.'**
  String get adminUsersEmptyMessage;

  /// Load error
  ///
  /// In en, this message translates to:
  /// **'Could not load users.'**
  String get adminUsersLoadFailed;

  /// Read-only note
  ///
  /// In en, this message translates to:
  /// **'Only a super admin can change users. You can view the list.'**
  String get adminUsersReadOnlyNote;

  /// Self note
  ///
  /// In en, this message translates to:
  /// **'This is your own account. You cannot lock it or change its role.'**
  String get adminUsersSelfNote;

  /// Fallback when no name
  ///
  /// In en, this message translates to:
  /// **'Unnamed user'**
  String get adminUsersNoName;

  /// Fallback when no role
  ///
  /// In en, this message translates to:
  /// **'No role assigned'**
  String get adminUsersNoRole;

  /// Badge
  ///
  /// In en, this message translates to:
  /// **'Super admin'**
  String get adminUsersSuperAdminBadge;

  /// Field label
  ///
  /// In en, this message translates to:
  /// **'Role'**
  String get adminUsersFieldRole;

  /// Field label
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get adminUsersFieldUsername;

  /// Field label
  ///
  /// In en, this message translates to:
  /// **'Employee ID'**
  String get adminUsersFieldEmployeeId;

  /// Field label
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get adminUsersFieldEmail;

  /// Field label
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get adminUsersFieldSite;

  /// Field label
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get adminUsersFieldCountry;

  /// Field label
  ///
  /// In en, this message translates to:
  /// **'Joined'**
  String get adminUsersFieldJoined;

  /// Field label
  ///
  /// In en, this message translates to:
  /// **'Sign-up note'**
  String get adminUsersFieldPendingReason;

  /// Action
  ///
  /// In en, this message translates to:
  /// **'Approve'**
  String get adminUsersActionApprove;

  /// Action
  ///
  /// In en, this message translates to:
  /// **'Lock'**
  String get adminUsersActionLock;

  /// Action
  ///
  /// In en, this message translates to:
  /// **'Unlock'**
  String get adminUsersActionUnlock;

  /// Action
  ///
  /// In en, this message translates to:
  /// **'Deactivate'**
  String get adminUsersActionDeactivate;

  /// Action
  ///
  /// In en, this message translates to:
  /// **'Change role'**
  String get adminUsersActionSetRole;

  /// Dialog title
  ///
  /// In en, this message translates to:
  /// **'Approve this user?'**
  String get adminUsersConfirmApproveTitle;

  /// Dialog message
  ///
  /// In en, this message translates to:
  /// **'{name} will be able to sign in and use the app.'**
  String adminUsersConfirmApproveMessage(String name);

  /// Dialog title
  ///
  /// In en, this message translates to:
  /// **'Lock this user?'**
  String get adminUsersConfirmLockTitle;

  /// Dialog message
  ///
  /// In en, this message translates to:
  /// **'{name} will not be able to sign in until unlocked.'**
  String adminUsersConfirmLockMessage(String name);

  /// Dialog title
  ///
  /// In en, this message translates to:
  /// **'Unlock this user?'**
  String get adminUsersConfirmUnlockTitle;

  /// Dialog message
  ///
  /// In en, this message translates to:
  /// **'{name} will be able to sign in again.'**
  String adminUsersConfirmUnlockMessage(String name);

  /// Dialog title
  ///
  /// In en, this message translates to:
  /// **'Deactivate this user'**
  String get adminUsersDeactivateTitle;

  /// Dialog message
  ///
  /// In en, this message translates to:
  /// **'{name} will lose access and be locked. A reason is required.'**
  String adminUsersDeactivateMessage(String name);

  /// Dialog title
  ///
  /// In en, this message translates to:
  /// **'Change role'**
  String get adminUsersSetRoleTitle;

  /// Dialog message
  ///
  /// In en, this message translates to:
  /// **'Choose the new role for {name}. A reason is required.'**
  String adminUsersSetRoleMessage(String name);

  /// Field label
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get adminUsersReasonLabel;

  /// Validation
  ///
  /// In en, this message translates to:
  /// **'Enter a reason.'**
  String get adminUsersReasonRequired;

  /// Validation
  ///
  /// In en, this message translates to:
  /// **'Choose a role.'**
  String get adminUsersRoleRequired;

  /// Snack after success
  ///
  /// In en, this message translates to:
  /// **'Saved.'**
  String get adminUsersActionDone;

  /// Snack after failure
  ///
  /// In en, this message translates to:
  /// **'Could not save the change.'**
  String get adminUsersActionFailed;

  /// Access screen title
  ///
  /// In en, this message translates to:
  /// **'Mobile access'**
  String get adminAccessTitle;

  /// Subtitle while no user selected
  ///
  /// In en, this message translates to:
  /// **'Choose a person'**
  String get adminAccessPickUser;

  /// Button
  ///
  /// In en, this message translates to:
  /// **'Change person'**
  String get adminAccessChangeUser;

  /// Intro note
  ///
  /// In en, this message translates to:
  /// **'Overrides apply to this person\'s mobile app only. Default follows their role.'**
  String get adminAccessIntro;

  /// Choice
  ///
  /// In en, this message translates to:
  /// **'Default'**
  String get adminAccessDefault;

  /// Choice
  ///
  /// In en, this message translates to:
  /// **'Allow'**
  String get adminAccessAllow;

  /// Choice
  ///
  /// In en, this message translates to:
  /// **'Deny'**
  String get adminAccessDeny;

  /// Role default hint
  ///
  /// In en, this message translates to:
  /// **'Role default: allowed'**
  String get adminAccessRoleDefaultAllowed;

  /// Role default hint
  ///
  /// In en, this message translates to:
  /// **'Role default: not allowed'**
  String get adminAccessRoleDefaultDenied;

  /// Role default hint
  ///
  /// In en, this message translates to:
  /// **'Admins only by default'**
  String get adminAccessRoleDefaultAdminOnly;

  /// Note for admin targets
  ///
  /// In en, this message translates to:
  /// **'Admins and super admins always keep full access.'**
  String get adminAccessAdminNote;

  /// Read-only note
  ///
  /// In en, this message translates to:
  /// **'Only a super admin can change access.'**
  String get adminAccessReadOnlyNote;

  /// Load error
  ///
  /// In en, this message translates to:
  /// **'Could not load this person\'s access.'**
  String get adminAccessLoadFailed;

  /// Save error
  ///
  /// In en, this message translates to:
  /// **'Could not update access.'**
  String get adminAccessSaveFailed;

  /// Save success
  ///
  /// In en, this message translates to:
  /// **'Access updated.'**
  String get adminAccessSaved;

  /// Module group
  ///
  /// In en, this message translates to:
  /// **'Field'**
  String get adminAccessGroupField;

  /// Module group
  ///
  /// In en, this message translates to:
  /// **'Fleet'**
  String get adminAccessGroupFleet;

  /// Module group
  ///
  /// In en, this message translates to:
  /// **'Maintenance'**
  String get adminAccessGroupMaintenance;

  /// Module group
  ///
  /// In en, this message translates to:
  /// **'Management'**
  String get adminAccessGroupManagement;

  /// Module group
  ///
  /// In en, this message translates to:
  /// **'Admin'**
  String get adminAccessGroupAdmin;

  /// Tab
  ///
  /// In en, this message translates to:
  /// **'Inspections'**
  String get adminApprovalsTabInspections;

  /// Tab
  ///
  /// In en, this message translates to:
  /// **'Checklists'**
  String get adminApprovalsTabChecklists;

  /// Sites title
  ///
  /// In en, this message translates to:
  /// **'Sites'**
  String get adminSitesTitle;

  /// Sites count
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 site} other{{count} sites}}'**
  String adminSitesCount(int count);

  /// Search hint
  ///
  /// In en, this message translates to:
  /// **'Search site, region or code'**
  String get adminSitesSearchHint;

  /// Site status
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get adminSitesActive;

  /// Site status
  ///
  /// In en, this message translates to:
  /// **'Inactive'**
  String get adminSitesInactive;

  /// Fallback when region is blank
  ///
  /// In en, this message translates to:
  /// **'No region'**
  String get adminSitesNoRegion;

  /// Empty title
  ///
  /// In en, this message translates to:
  /// **'No sites'**
  String get adminSitesEmptyTitle;

  /// Empty message
  ///
  /// In en, this message translates to:
  /// **'No sites are registered for your organisation yet.'**
  String get adminSitesEmptyMessage;

  /// Load error
  ///
  /// In en, this message translates to:
  /// **'Could not load sites.'**
  String get adminSitesLoadFailed;

  /// Read-only note
  ///
  /// In en, this message translates to:
  /// **'Only an Admin or Manager can edit sites.'**
  String get adminSitesReadOnlyNote;

  /// Sheet title
  ///
  /// In en, this message translates to:
  /// **'Edit site'**
  String get adminSitesEditTitle;

  /// Field label
  ///
  /// In en, this message translates to:
  /// **'Region'**
  String get adminSitesRegionLabel;

  /// Switch label
  ///
  /// In en, this message translates to:
  /// **'Active site'**
  String get adminSitesActiveLabel;

  /// Button
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get adminSitesSave;

  /// Success
  ///
  /// In en, this message translates to:
  /// **'Site updated.'**
  String get adminSitesSaved;

  /// Error
  ///
  /// In en, this message translates to:
  /// **'Could not update the site.'**
  String get adminSitesSaveFailed;

  /// AI title
  ///
  /// In en, this message translates to:
  /// **'Fleet AI chat'**
  String get adminAiTitle;

  /// AI subtitle
  ///
  /// In en, this message translates to:
  /// **'Answers come from the AI service. Check important figures in the app.'**
  String get adminAiSubtitle;

  /// Input hint
  ///
  /// In en, this message translates to:
  /// **'Ask about fleet management'**
  String get adminAiHint;

  /// Send button tooltip
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get adminAiSend;

  /// Clear tooltip
  ///
  /// In en, this message translates to:
  /// **'Clear chat'**
  String get adminAiClear;

  /// Empty title
  ///
  /// In en, this message translates to:
  /// **'Ask a question'**
  String get adminAiEmptyTitle;

  /// Empty message
  ///
  /// In en, this message translates to:
  /// **'For example, how to reduce tyre cost per kilometre.'**
  String get adminAiEmptyMessage;

  /// Loading label
  ///
  /// In en, this message translates to:
  /// **'Thinking'**
  String get adminAiThinking;

  /// Bubble author
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get adminAiYou;

  /// Bubble author
  ///
  /// In en, this message translates to:
  /// **'Fleet AI'**
  String get adminAiAssistant;

  /// AI error
  ///
  /// In en, this message translates to:
  /// **'AI features are turned off by your administrator.'**
  String get adminAiErrorDisabled;

  /// AI error
  ///
  /// In en, this message translates to:
  /// **'The monthly AI budget has been reached.'**
  String get adminAiErrorBudget;

  /// AI error
  ///
  /// In en, this message translates to:
  /// **'Too many requests. Wait a moment and try again.'**
  String get adminAiErrorRateLimit;

  /// AI error
  ///
  /// In en, this message translates to:
  /// **'The AI service returned no answer.'**
  String get adminAiErrorEmpty;

  /// AI error
  ///
  /// In en, this message translates to:
  /// **'The AI service is unavailable right now. Try again shortly.'**
  String get adminAiErrorUnavailable;

  /// Fleet AI screen title
  ///
  /// In en, this message translates to:
  /// **'Fleet AI'**
  String get extrasFleetAiTitle;

  /// Fleet AI subtitle
  ///
  /// In en, this message translates to:
  /// **'Answers from your live fleet data'**
  String get extrasFleetAiSubtitle;

  /// Shown while grounding counts load
  ///
  /// In en, this message translates to:
  /// **'Reading live fleet data'**
  String get extrasFleetAiSnapshotLoading;

  /// No grounding data could be read
  ///
  /// In en, this message translates to:
  /// **'Live fleet data could not be read, so the assistant cannot answer from your records right now.'**
  String get extrasFleetAiNoData;

  /// How many grounding counts were read
  ///
  /// In en, this message translates to:
  /// **'Based on {n} of 5 live fleet counts'**
  String extrasFleetAiGroundedOn(int n);

  /// Empty conversation title
  ///
  /// In en, this message translates to:
  /// **'Ask about your fleet'**
  String get extrasFleetAiEmptyTitle;

  /// Empty conversation explanation
  ///
  /// In en, this message translates to:
  /// **'The assistant answers only from live counts of your fleet. It will say when something is not available here.'**
  String get extrasFleetAiEmptyMessage;

  /// Suggested questions heading
  ///
  /// In en, this message translates to:
  /// **'Try asking'**
  String get extrasFleetAiSuggestedTitle;

  /// Suggested question
  ///
  /// In en, this message translates to:
  /// **'Give me a fleet health overview'**
  String get extrasFleetAiSuggestOverview;

  /// Suggested question
  ///
  /// In en, this message translates to:
  /// **'How many tyres are at critical or high risk?'**
  String get extrasFleetAiSuggestRisk;

  /// Suggested question
  ///
  /// In en, this message translates to:
  /// **'What needs my attention first?'**
  String get extrasFleetAiSuggestActions;

  /// Suggested question
  ///
  /// In en, this message translates to:
  /// **'How many accidents were reported in the last 30 days?'**
  String get extrasFleetAiSuggestAccidents;

  /// Composer hint
  ///
  /// In en, this message translates to:
  /// **'Ask a question about your fleet'**
  String get extrasFleetAiInputHint;

  /// Send button tooltip
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get extrasFleetAiSend;

  /// Shown while waiting for an answer
  ///
  /// In en, this message translates to:
  /// **'Thinking'**
  String get extrasFleetAiThinking;

  /// Clear conversation action
  ///
  /// In en, this message translates to:
  /// **'Clear conversation'**
  String get extrasFleetAiClear;

  /// Disclaimer under composer
  ///
  /// In en, this message translates to:
  /// **'AI answers can be wrong. Check important figures in the app before acting.'**
  String get extrasFleetAiDisclaimer;

  /// Semantics label for user messages
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get extrasFleetAiYou;

  /// chat-ai 403
  ///
  /// In en, this message translates to:
  /// **'AI features are switched off by your administrator.'**
  String get extrasFleetAiErrDisabled;

  /// chat-ai 402
  ///
  /// In en, this message translates to:
  /// **'The monthly AI budget has been reached. Contact your administrator.'**
  String get extrasFleetAiErrBudget;

  /// chat-ai 429
  ///
  /// In en, this message translates to:
  /// **'Too many questions in a short time. Wait a moment and try again.'**
  String get extrasFleetAiErrRateLimited;

  /// Offline
  ///
  /// In en, this message translates to:
  /// **'No connection. Your question was not sent.'**
  String get extrasFleetAiErrOffline;

  /// Generic AI failure
  ///
  /// In en, this message translates to:
  /// **'The assistant is unavailable right now. Try again shortly.'**
  String get extrasFleetAiErrUnavailable;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Engine'**
  String get repairReqCatEngine;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Transmission'**
  String get repairReqCatTransmission;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Brakes'**
  String get repairReqCatBrakes;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Tyres'**
  String get repairReqCatTyres;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Hydraulics'**
  String get repairReqCatHydraulics;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Electrical'**
  String get repairReqCatElectrical;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Body'**
  String get repairReqCatBody;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Drum / Mixer'**
  String get repairReqCatDrumMixer;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Pump'**
  String get repairReqCatPump;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Air system'**
  String get repairReqCatAirSystem;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Cooling'**
  String get repairReqCatCooling;

  /// Repair request fault category
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get repairReqCatOther;

  /// Screen title
  ///
  /// In en, this message translates to:
  /// **'Repair request'**
  String get repairReqTitle;

  /// Screen subtitle
  ///
  /// In en, this message translates to:
  /// **'Report a fault to the workshop'**
  String get repairReqSubtitle;

  /// Asset section label
  ///
  /// In en, this message translates to:
  /// **'Machine'**
  String get repairReqMachine;

  /// Asset picker prompt
  ///
  /// In en, this message translates to:
  /// **'Choose the machine'**
  String get repairReqChooseAsset;

  /// Select asset action
  ///
  /// In en, this message translates to:
  /// **'Select'**
  String get repairReqSelect;

  /// Change asset action
  ///
  /// In en, this message translates to:
  /// **'Change'**
  String get repairReqChange;

  /// Plate line
  ///
  /// In en, this message translates to:
  /// **'Plate {plate}'**
  String repairReqPlate(String plate);

  /// Validation
  ///
  /// In en, this message translates to:
  /// **'Choose the machine that has the fault.'**
  String get repairReqErrAsset;

  /// Site field label
  ///
  /// In en, this message translates to:
  /// **'Site'**
  String get repairReqSite;

  /// Site hint
  ///
  /// In en, this message translates to:
  /// **'Filled from the machine\'s registered site'**
  String get repairReqSiteHint;

  /// Fault category label
  ///
  /// In en, this message translates to:
  /// **'What is wrong'**
  String get repairReqCategory;

  /// Description label
  ///
  /// In en, this message translates to:
  /// **'Describe the fault'**
  String get repairReqDescription;

  /// Description hint
  ///
  /// In en, this message translates to:
  /// **'What happened, what you see or hear'**
  String get repairReqDescriptionHint;

  /// Validation
  ///
  /// In en, this message translates to:
  /// **'Describe the fault before sending.'**
  String get repairReqErrDescription;

  /// Priority label
  ///
  /// In en, this message translates to:
  /// **'Priority'**
  String get repairReqPriority;

  /// Odometer label
  ///
  /// In en, this message translates to:
  /// **'Odometer (km)'**
  String get repairReqOdometer;

  /// Engine hours label
  ///
  /// In en, this message translates to:
  /// **'Engine hours'**
  String get repairReqEngineHours;

  /// Optional hint
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get repairReqOptional;

  /// Meter validation
  ///
  /// In en, this message translates to:
  /// **'Enter a number of zero or more, or leave it blank.'**
  String get repairReqErrMeter;

  /// Online-only note
  ///
  /// In en, this message translates to:
  /// **'This request is sent straight to the workshop and needs a connection. The office issues the RFR number.'**
  String get repairReqOnlineNote;

  /// Submit button
  ///
  /// In en, this message translates to:
  /// **'Send repair request'**
  String get repairReqSubmit;

  /// Missing workspace
  ///
  /// In en, this message translates to:
  /// **'Your profile is not loaded yet. Try again in a moment.'**
  String get repairReqErrNoProfile;

  /// Offline error
  ///
  /// In en, this message translates to:
  /// **'No connection. Nothing was sent. Your entries are kept, send again when you have signal.'**
  String get repairReqErrOffline;

  /// Permission error
  ///
  /// In en, this message translates to:
  /// **'Your account is not allowed to raise repair requests. Contact your administrator.'**
  String get repairReqErrPermission;

  /// Generic error
  ///
  /// In en, this message translates to:
  /// **'The request could not be sent. Your entries are kept, try again.'**
  String get repairReqErrFailed;

  /// Success title
  ///
  /// In en, this message translates to:
  /// **'Repair request sent'**
  String get repairReqSentTitle;

  /// Success with RFR number
  ///
  /// In en, this message translates to:
  /// **'The workshop has it as {rfr}.'**
  String repairReqSentWithNumber(String rfr);

  /// Success without number
  ///
  /// In en, this message translates to:
  /// **'The workshop has it. The office will issue the RFR number.'**
  String get repairReqSentNoNumber;

  /// Start another
  ///
  /// In en, this message translates to:
  /// **'Raise another'**
  String get repairReqAnother;

  /// Finish
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get repairReqDone;

  /// Asset search hint
  ///
  /// In en, this message translates to:
  /// **'Search by asset, plate, type or site'**
  String get repairReqSearchHint;

  /// Empty fleet
  ///
  /// In en, this message translates to:
  /// **'No machines are registered for your scope.'**
  String get repairReqNoAssets;

  /// No search match
  ///
  /// In en, this message translates to:
  /// **'No machine matches that search.'**
  String get repairReqNoMatch;

  /// Too many matches
  ///
  /// In en, this message translates to:
  /// **'{n} machines match. Type more to narrow the list.'**
  String repairReqRefineSearch(int n);

  /// Cached fleet notice
  ///
  /// In en, this message translates to:
  /// **'Offline: showing the fleet saved on this device.'**
  String get repairReqCachedList;

  /// Register screen title
  ///
  /// In en, this message translates to:
  /// **'Create account'**
  String get registerTitle;

  /// Loading policy
  ///
  /// In en, this message translates to:
  /// **'Checking whether registration is open'**
  String get registerChecking;

  /// Offline title
  ///
  /// In en, this message translates to:
  /// **'Cannot reach the server'**
  String get registerUnreachableTitle;

  /// Offline message
  ///
  /// In en, this message translates to:
  /// **'Registration needs a connection. Check your signal and try again.'**
  String get registerUnreachableMessage;

  /// Closed title
  ///
  /// In en, this message translates to:
  /// **'Registration is closed'**
  String get registerClosedTitle;

  /// Closed message
  ///
  /// In en, this message translates to:
  /// **'Accounts are created by your administrator. Contact your administrator to be invited.'**
  String get registerClosedMessage;

  /// Back to login
  ///
  /// In en, this message translates to:
  /// **'Back to sign in'**
  String get registerBackToSignIn;

  /// Success title
  ///
  /// In en, this message translates to:
  /// **'Account created'**
  String get registerDoneTitle;

  /// Success message
  ///
  /// In en, this message translates to:
  /// **'Your account is waiting for approval. Your administrator will assign your role and site, then you can sign in.'**
  String get registerDoneMessage;

  /// Intro
  ///
  /// In en, this message translates to:
  /// **'Request an account with your username and employee ID. An administrator approves it and sets your role and site.'**
  String get registerIntro;

  /// Full name label
  ///
  /// In en, this message translates to:
  /// **'Full name'**
  String get registerFullName;

  /// Optional hint
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get registerOptional;

  /// Username label
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get registerUsername;

  /// Username rules
  ///
  /// In en, this message translates to:
  /// **'At least 3 characters: letters, numbers, dot, underscore or hyphen'**
  String get registerUsernameHelp;

  /// Employee ID label
  ///
  /// In en, this message translates to:
  /// **'Employee ID'**
  String get registerEmployeeId;

  /// Password label
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get registerPassword;

  /// Password rule
  ///
  /// In en, this message translates to:
  /// **'At least {n} characters'**
  String registerPasswordHelp(int n);

  /// Confirm label
  ///
  /// In en, this message translates to:
  /// **'Confirm password'**
  String get registerConfirm;

  /// Toggle
  ///
  /// In en, this message translates to:
  /// **'Show password'**
  String get registerShowPassword;

  /// Toggle
  ///
  /// In en, this message translates to:
  /// **'Hide password'**
  String get registerHidePassword;

  /// Approval note
  ///
  /// In en, this message translates to:
  /// **'You cannot choose a role or site here. New accounts start pending until an administrator approves them.'**
  String get registerApprovalNote;

  /// Submit
  ///
  /// In en, this message translates to:
  /// **'Request account'**
  String get registerSubmit;

  /// Link to login
  ///
  /// In en, this message translates to:
  /// **'Already have an account? Sign in'**
  String get registerHaveAccount;

  /// Validation
  ///
  /// In en, this message translates to:
  /// **'Enter a username of at least 3 characters.'**
  String get registerErrUsernameShort;

  /// Validation
  ///
  /// In en, this message translates to:
  /// **'Use only letters, numbers, dot, underscore or hyphen.'**
  String get registerErrUsernameChars;

  /// Validation
  ///
  /// In en, this message translates to:
  /// **'Enter your employee ID.'**
  String get registerErrEmployeeId;

  /// Validation
  ///
  /// In en, this message translates to:
  /// **'The password needs at least {n} characters.'**
  String registerErrPasswordShort(int n);

  /// Validation
  ///
  /// In en, this message translates to:
  /// **'The passwords do not match.'**
  String get registerErrMismatch;

  /// Duplicate
  ///
  /// In en, this message translates to:
  /// **'That username or employee ID is already taken. Choose another.'**
  String get registerErrTaken;

  /// Offline
  ///
  /// In en, this message translates to:
  /// **'No connection. Your account was not created. Try again when you have signal.'**
  String get registerErrOffline;

  /// Generic
  ///
  /// In en, this message translates to:
  /// **'Your account could not be created. Try again.'**
  String get registerErrFailed;

  /// Login access-help dialog: opens the self-registration screen (the account is created pending administrator approval).
  ///
  /// In en, this message translates to:
  /// **'Create an account'**
  String get loginCreateAccount;

  /// Error title.
  ///
  /// In en, this message translates to:
  /// **'The assessment could not be loaded'**
  String get accAssessmentLoadFailed;

  /// Section title.
  ///
  /// In en, this message translates to:
  /// **'Safety and mobility'**
  String get accSafetyAndMobility;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Safe to move'**
  String get accSafeToMove;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Recovery / tow required'**
  String get accRecoveryTowRequired;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Vehicle off road (VOR)'**
  String get accVehicleOffRoad;

  /// Section title.
  ///
  /// In en, this message translates to:
  /// **'Damage assessment'**
  String get accDamageAssessment;

  /// Number of damage areas.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 area} other{{count} areas}}'**
  String accDamageAreaCount(int count);

  /// Empty state.
  ///
  /// In en, this message translates to:
  /// **'No damage areas have been marked on this case yet.'**
  String get accNoDamageAreas;

  /// Section title.
  ///
  /// In en, this message translates to:
  /// **'Labour and parts estimate'**
  String get accLabourAndPartsEstimate;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Labour hours'**
  String get accLabourHours;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Labour estimate'**
  String get accLabourEstimate;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Parts estimate'**
  String get accPartsEstimate;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Total preliminary estimate'**
  String get accTotalPreliminaryEstimate;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Parts available'**
  String get accPartsAvailable;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Special order'**
  String get accSpecialOrder;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Parts availability'**
  String get accPartsAvailability;

  /// Section title.
  ///
  /// In en, this message translates to:
  /// **'Repair route recommendation'**
  String get accRepairRouteRecommendation;

  /// Checkbox label.
  ///
  /// In en, this message translates to:
  /// **'Total loss possible'**
  String get accTotalLossPossible;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Selected workshop'**
  String get accSelectedWorkshop;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get accCity;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Expected duration (days)'**
  String get accExpectedDurationDays;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Quotation status'**
  String get accQuotationStatus;

  /// Section title with count.
  ///
  /// In en, this message translates to:
  /// **'Required attachments ({count})'**
  String accRequiredAttachments(int count);

  /// Warning.
  ///
  /// In en, this message translates to:
  /// **'Attach vendor quotation to enable submission to External Workshop.'**
  String get accAttachVendorQuotation;

  /// Section title.
  ///
  /// In en, this message translates to:
  /// **'After submit notify'**
  String get accAfterSubmitNotify;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Save assessment'**
  String get accSaveAssessment;

  /// Button label after submit.
  ///
  /// In en, this message translates to:
  /// **'Assessment submitted'**
  String get accAssessmentSubmitted;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Submit assessment and route'**
  String get accSubmitAssessment;

  /// Hint.
  ///
  /// In en, this message translates to:
  /// **'Submission needs the vendor quotation for an external route.'**
  String get accSubmissionNeedsQuotation;

  /// Appended when the server rejected optional columns.
  ///
  /// In en, this message translates to:
  /// **'These fields could not be stored on the server: {fields}.'**
  String accFieldsNotStored(String fields);

  /// Snackbar.
  ///
  /// In en, this message translates to:
  /// **'Assessment submitted and routed to {route}.'**
  String accAssessmentRouted(String route);

  /// Snackbar.
  ///
  /// In en, this message translates to:
  /// **'Assessment saved.'**
  String get accAssessmentSaved;

  /// Snackbar.
  ///
  /// In en, this message translates to:
  /// **'{document} attached.'**
  String accDocumentAttached(String document);

  /// Odometer label.
  ///
  /// In en, this message translates to:
  /// **'KM'**
  String get accKm;

  /// Odometer value.
  ///
  /// In en, this message translates to:
  /// **'{km} km'**
  String accKmValue(String km);

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Plate'**
  String get accPlate;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Site · location'**
  String get accSiteLocation;

  /// Button to open the damage map.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{View damage map · 1 area} other{View damage map · {count} areas}}'**
  String accViewDamageMap(int count);

  /// Damage row action line.
  ///
  /// In en, this message translates to:
  /// **'Action: not yet assessed'**
  String get accActionNotAssessed;

  /// Damage row action line.
  ///
  /// In en, this message translates to:
  /// **'Action: {value}'**
  String accActionValue(String value);

  /// Chip on the recommended route.
  ///
  /// In en, this message translates to:
  /// **'Recommended'**
  String get accRecommended;

  /// Tooltip.
  ///
  /// In en, this message translates to:
  /// **'Upload {document}'**
  String accUploadNamedDocument(String document);

  /// Error title on the insurance claim workspace.
  ///
  /// In en, this message translates to:
  /// **'The claim could not be loaded'**
  String get accClaimLoadFailed;

  /// Banner when the repair route is external.
  ///
  /// In en, this message translates to:
  /// **'External repair assessment'**
  String get accClaimExternalRepairBanner;

  /// Section title.
  ///
  /// In en, this message translates to:
  /// **'Claim document package'**
  String get accClaimDocumentPackage;

  /// Warning under the document package.
  ///
  /// In en, this message translates to:
  /// **'Claim registration unlocks when all required documents are complete.'**
  String get accClaimRegistrationLocked;

  /// Button/tooltip to request a missing document.
  ///
  /// In en, this message translates to:
  /// **'Request {document}'**
  String accRequestDocument(String document);

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Upload document'**
  String get accUploadDocument;

  /// Section title.
  ///
  /// In en, this message translates to:
  /// **'Claim registration'**
  String get accClaimRegistration;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Insurer'**
  String get accInsurer;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Policy no.'**
  String get accPolicyNo;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Claim number'**
  String get accClaimNumber;

  /// Claim number placeholder before registration.
  ///
  /// In en, this message translates to:
  /// **'Auto-generated after registration'**
  String get accClaimNumberAuto;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Liability'**
  String get accLiability;

  /// Field label for our liability percentage.
  ///
  /// In en, this message translates to:
  /// **'GCC liability %'**
  String get accGccLiabilityPct;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Claim amount'**
  String get accClaimAmount;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Deductible'**
  String get accDeductible;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Net claimable'**
  String get accNetClaimable;

  /// Button label after registration.
  ///
  /// In en, this message translates to:
  /// **'Claim registered with insurer'**
  String get accClaimRegistered;

  /// Button and dialog title.
  ///
  /// In en, this message translates to:
  /// **'Register claim with insurer'**
  String get accRegisterClaim;

  /// Hint under a disabled register button.
  ///
  /// In en, this message translates to:
  /// **'Enable once all required documents are complete.'**
  String get accClaimEnableWhenComplete;

  /// Section title.
  ///
  /// In en, this message translates to:
  /// **'Payment and recovery'**
  String get accPaymentAndRecovery;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Approved amount'**
  String get accApprovedAmount;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Recovered amount'**
  String get accRecoveredAmount;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Outstanding'**
  String get accOutstanding;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Recovery source'**
  String get accRecoverySource;

  /// Input hint.
  ///
  /// In en, this message translates to:
  /// **'Insurer, third party, driver'**
  String get accRecoverySourceHint;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Last updated'**
  String get accLastUpdated;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Save recovery'**
  String get accSaveRecovery;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Update recovery amount'**
  String get accUpdateRecovery;

  /// Hint under a disabled recovery button.
  ///
  /// In en, this message translates to:
  /// **'Register the claim first.'**
  String get accRegisterClaimFirst;

  /// Info note.
  ///
  /// In en, this message translates to:
  /// **'Recovery amounts remain editable after operational case closure. Every adjustment is timestamped and audited.'**
  String get accRecoveryEditableNote;

  /// Section title.
  ///
  /// In en, this message translates to:
  /// **'After registration notify'**
  String get accAfterRegistrationNotify;

  /// Note under notify chips.
  ///
  /// In en, this message translates to:
  /// **'Notification includes the claim number, document status, claim amount and next action.'**
  String get accClaimNotificationIncludes;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Save claim draft'**
  String get accSaveClaimDraft;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Complete documents'**
  String get accCompleteDocuments;

  /// Footer line.
  ///
  /// In en, this message translates to:
  /// **'{owner} is monitoring SLA and missing documents.'**
  String accCommandCenterMonitoring(String owner);

  /// Role name with the command center suffix.
  ///
  /// In en, this message translates to:
  /// **'{role} (Command Center)'**
  String accCommandCenterRole(String role);

  /// Snackbar.
  ///
  /// In en, this message translates to:
  /// **'Claim draft saved on this device. Nothing was sent.'**
  String get accClaimDraftSaved;

  /// Snackbar.
  ///
  /// In en, this message translates to:
  /// **'Request for {document} logged on the case.'**
  String accDocumentRequestLogged(String document);

  /// Sheet title when uploading a document.
  ///
  /// In en, this message translates to:
  /// **'Which document is this?'**
  String get accWhichDocument;

  /// Snackbar.
  ///
  /// In en, this message translates to:
  /// **'{document} uploaded to the claim package.'**
  String accDocumentUploaded(String document);

  /// Validation snackbar.
  ///
  /// In en, this message translates to:
  /// **'Enter the insurer, policy number and claim amount first.'**
  String get accClaimRegisterMissing;

  /// Confirmation dialog body.
  ///
  /// In en, this message translates to:
  /// **'Claim {claimNo} for {insurer} under policy {policyNo} will be registered on the case. This cannot be undone from the app.'**
  String accRegisterClaimConfirm(
      String claimNo, String insurer, String policyNo);

  /// Confirm button.
  ///
  /// In en, this message translates to:
  /// **'Register'**
  String get accRegister;

  /// Snackbar.
  ///
  /// In en, this message translates to:
  /// **'Claim {claimNo} registered with the insurer.'**
  String accClaimRegisteredSnack(String claimNo);

  /// Validation snackbar.
  ///
  /// In en, this message translates to:
  /// **'Enter the recovered amount and its source.'**
  String get accRecoveryMissing;

  /// Snackbar.
  ///
  /// In en, this message translates to:
  /// **'Recovery recorded.'**
  String get accRecoveryRecorded;

  /// Marks an optional document.
  ///
  /// In en, this message translates to:
  /// **'{label} (Optional)'**
  String accOptionalSuffix(String label);

  /// Note under the locked fleet-master fields.
  ///
  /// In en, this message translates to:
  /// **'These details are sourced from fleet master and cannot be edited here. If any detail is incorrect, please update it in the fleet system.'**
  String get accIntakeFleetMasterLockNote;

  /// Help under the incident site question.
  ///
  /// In en, this message translates to:
  /// **'Select the site/location of this incident. This may be different from the asset\'s home site.'**
  String get accIntakeIncidentSiteHelp;

  /// Fleet master field.
  ///
  /// In en, this message translates to:
  /// **'Asset no'**
  String get accIntakeAssetNo;

  /// Fleet master field.
  ///
  /// In en, this message translates to:
  /// **'Vehicle type'**
  String get accIntakeVehicleType;

  /// Fleet master field.
  ///
  /// In en, this message translates to:
  /// **'Make / model'**
  String get accIntakeMakeModel;

  /// Fleet master field.
  ///
  /// In en, this message translates to:
  /// **'Site (home)'**
  String get accIntakeHomeSite;

  /// Fleet master field.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get accIntakeCountry;

  /// Fleet master field.
  ///
  /// In en, this message translates to:
  /// **'Current meter'**
  String get accIntakeCurrentMeter;

  /// Fleet master field.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get accIntakeStatus;

  /// Card title.
  ///
  /// In en, this message translates to:
  /// **'Asset loaded from fleet master'**
  String get accIntakeAssetLoaded;

  /// Card title.
  ///
  /// In en, this message translates to:
  /// **'Auto-filled from fleet master'**
  String get accIntakeAutoFilled;

  /// Section question.
  ///
  /// In en, this message translates to:
  /// **'Where did the incident occur?'**
  String get accIntakeWhereOccurred;

  /// Field hint.
  ///
  /// In en, this message translates to:
  /// **'Site or location name'**
  String get accIntakeSiteHint;

  /// Site chip for the asset's home site.
  ///
  /// In en, this message translates to:
  /// **'{site} (home)'**
  String accIntakeHomeSiteChip(String site);

  /// Evidence progress.
  ///
  /// In en, this message translates to:
  /// **'{done} of {total} required photos'**
  String accIntakeRequiredPhotos(int done, int total);

  /// Evidence chip.
  ///
  /// In en, this message translates to:
  /// **'{count} missing'**
  String accIntakeMissingCount(int count);

  /// Evidence state.
  ///
  /// In en, this message translates to:
  /// **'Attached on this device'**
  String get accIntakeAttachedOnDevice;

  /// Evidence row subtitle.
  ///
  /// In en, this message translates to:
  /// **'{category} · Required'**
  String accIntakeRequiredCategory(String category);

  /// Tooltip.
  ///
  /// In en, this message translates to:
  /// **'Remove photo'**
  String get accIntakeRemovePhoto;

  /// Section title.
  ///
  /// In en, this message translates to:
  /// **'Supporting documents'**
  String get accIntakeSupportingDocuments;

  /// Section help.
  ///
  /// In en, this message translates to:
  /// **'Attach what is available now. Route and country rules may require more during case review.'**
  String get accIntakeSupportingDocumentsHelp;

  /// Document state.
  ///
  /// In en, this message translates to:
  /// **'Optional at intake'**
  String get accIntakeOptionalAtIntake;

  /// Tooltip.
  ///
  /// In en, this message translates to:
  /// **'Remove attachment'**
  String get accIntakeRemoveAttachment;

  /// Tooltip.
  ///
  /// In en, this message translates to:
  /// **'Attach document photo'**
  String get accIntakeAttachDocumentPhoto;

  /// Affirmative answer to a yes/no accident fact.
  ///
  /// In en, this message translates to:
  /// **'Yes'**
  String get accYes;

  /// Negative answer to a yes/no accident fact.
  ///
  /// In en, this message translates to:
  /// **'No'**
  String get accNo;

  /// Title of the shared accident case summary PDF.
  ///
  /// In en, this message translates to:
  /// **'Accident case summary'**
  String get accCaseSummaryTitle;

  /// PDF header line with the generation date and time.
  ///
  /// In en, this message translates to:
  /// **'Generated {date}'**
  String accCaseSummaryGenerated(String date);

  /// Section title for the workstream table in the case PDF.
  ///
  /// In en, this message translates to:
  /// **'Case workstreams'**
  String get accCaseSummaryWorkstreams;

  /// Table column header.
  ///
  /// In en, this message translates to:
  /// **'Workstream'**
  String get accCaseSummaryWorkstreamColumn;

  /// Table column header.
  ///
  /// In en, this message translates to:
  /// **'Team'**
  String get accCaseSummaryTeamColumn;

  /// Table column header.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get accCaseSummaryStatusColumn;

  /// Table column header.
  ///
  /// In en, this message translates to:
  /// **'Progress'**
  String get accCaseSummaryProgressColumn;

  /// Label for the server-recorded overall completion.
  ///
  /// In en, this message translates to:
  /// **'Overall completion'**
  String get accCaseSummaryOverallCompletion;

  /// Label for the evidence photo count.
  ///
  /// In en, this message translates to:
  /// **'Evidence photos'**
  String get accCaseSummaryEvidencePhotos;

  /// Button that renders and shares the case summary PDF.
  ///
  /// In en, this message translates to:
  /// **'Share case summary PDF'**
  String get accCaseSummaryShare;

  /// Shown when building or sharing the PDF failed.
  ///
  /// In en, this message translates to:
  /// **'The case summary could not be shared. Try again.'**
  String get accCaseSummaryShareFailed;

  /// Shown when no Arabic-script font was available offline.
  ///
  /// In en, this message translates to:
  /// **'The Arabic font could not be loaded, so the summary was shared in English.'**
  String get accCaseSummarySharedInEnglish;

  /// Draft restore failure.
  ///
  /// In en, this message translates to:
  /// **'The saved report draft could not be restored. Your existing saved data was not overwritten.'**
  String get accReportDraftRestoreFailed;

  /// Shown when the workspace context is not ready.
  ///
  /// In en, this message translates to:
  /// **'Your workspace is still loading. Try again.'**
  String get accWorkspaceLoading;

  /// Draft save failure.
  ///
  /// In en, this message translates to:
  /// **'This device could not save the draft. Nothing previously saved was overwritten. Try again.'**
  String get accReportDraftSaveFailed;

  /// Snackbar after returning from the scanner.
  ///
  /// In en, this message translates to:
  /// **'Use the scanned asset number to select the matching fleet record.'**
  String get accReportUseScannedAsset;

  /// Photo source sheet title.
  ///
  /// In en, this message translates to:
  /// **'Add close-up photo'**
  String get accReportAddCloseUpPhoto;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Take photo'**
  String get accReportTakePhoto;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Choose from gallery'**
  String get accReportChooseGallery;

  /// Snackbar after submit.
  ///
  /// In en, this message translates to:
  /// **'Report saved to the offline queue.'**
  String get accReportQueued;

  /// Snackbar after submit with dropped fields.
  ///
  /// In en, this message translates to:
  /// **'Report queued. Some unsupported optional fields were kept in the intake notes.'**
  String get accReportQueuedWithNotes;

  /// Step subtitle.
  ///
  /// In en, this message translates to:
  /// **'Select the fleet asset involved in this incident.'**
  String get accReportStepAssetSubtitle;

  /// Step subtitle.
  ///
  /// In en, this message translates to:
  /// **'Record when, where and what happened.'**
  String get accReportStepIncidentSubtitle;

  /// Step subtitle.
  ///
  /// In en, this message translates to:
  /// **'Record only the people, safety, Najm and third-party facts needed at the scene.'**
  String get accReportStepPeopleSubtitle;

  /// Step subtitle.
  ///
  /// In en, this message translates to:
  /// **'Add one scene overview and one close-up for each marked damage area. Supporting documents are optional at intake.'**
  String get accReportStepEvidenceSubtitle;

  /// Step subtitle.
  ///
  /// In en, this message translates to:
  /// **'Add available supporting documents. Optional at intake.'**
  String get accReportStepDocumentsSubtitle;

  /// Step subtitle.
  ///
  /// In en, this message translates to:
  /// **'Check the exact report and send it to Fleet validation. Optional documents never block this submission.'**
  String get accReportStepReviewSubtitle;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Scan QR / barcode'**
  String get accReportScanCode;

  /// Asset search match count.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 matching asset} other{{count} matching assets}}'**
  String accReportMatchingAssets(int count);

  /// Empty search result.
  ///
  /// In en, this message translates to:
  /// **'No matching fleet asset'**
  String get accReportNoMatchingAsset;

  /// Truncated search note.
  ///
  /// In en, this message translates to:
  /// **'Showing the first {shown} of {total} matches. {hidden} more results, refine your search.'**
  String accReportMatchOverflow(int shown, int total, int hidden);

  /// Offline fleet chip.
  ///
  /// In en, this message translates to:
  /// **'Showing saved fleet data'**
  String get accReportSavedFleetData;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Change asset'**
  String get accReportChangeAsset;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Asset number (manual fallback)'**
  String get accReportManualAsset;

  /// Field hint.
  ///
  /// In en, this message translates to:
  /// **'Use only when a fleet match is unavailable'**
  String get accReportManualAssetHint;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Meter at incident'**
  String get accReportMeterAtIncident;

  /// Field hint.
  ///
  /// In en, this message translates to:
  /// **'Odometer or hour-meter reading'**
  String get accReportMeterHint;

  /// Field hint with the fleet odometer.
  ///
  /// In en, this message translates to:
  /// **'Fleet master: {km} km'**
  String accReportMeterFleetMaster(String km);

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Road / exact location'**
  String get accReportRoadLocation;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Incident date'**
  String get accReportIncidentDate;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Incident time'**
  String get accReportIncidentTime;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Incident site'**
  String get accReportIncidentSite;

  /// Field helper.
  ///
  /// In en, this message translates to:
  /// **'Editable incident site; independent of the locked fleet home site.'**
  String get accReportIncidentSiteHelper;

  /// Field hint.
  ///
  /// In en, this message translates to:
  /// **'Gate, road, project area or GPS description'**
  String get accReportRoadLocationHint;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Event type'**
  String get accReportEventType;

  /// Dropdown hint.
  ///
  /// In en, this message translates to:
  /// **'Select event type'**
  String get accReportSelectEventType;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Initial severity'**
  String get accReportInitialSeverity;

  /// Severity option.
  ///
  /// In en, this message translates to:
  /// **'Minor'**
  String get accSeverityMinor;

  /// Severity option.
  ///
  /// In en, this message translates to:
  /// **'Moderate'**
  String get accSeverityModerate;

  /// Severity option.
  ///
  /// In en, this message translates to:
  /// **'Major / severe'**
  String get accSeverityMajorSevere;

  /// Severity option.
  ///
  /// In en, this message translates to:
  /// **'Fatal'**
  String get accSeverityFatal;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'What happened?'**
  String get accReportWhatHappened;

  /// Field hint.
  ///
  /// In en, this message translates to:
  /// **'Describe the sequence of events and immediate conditions'**
  String get accReportWhatHappenedHint;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Driver name'**
  String get accReportDriverName;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Driver employee / licence ID'**
  String get accReportDriverId;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Were passengers involved?'**
  String get accReportPassengersInvolved;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Passenger count'**
  String get accReportPassengerCount;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Passenger details'**
  String get accReportPassengerDetails;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Were there injuries?'**
  String get accReportInjuries;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Injury count'**
  String get accReportInjuryCount;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Injury details'**
  String get accReportInjuryDetails;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Were emergency services contacted?'**
  String get accReportEmergencyServices;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Emergency response details'**
  String get accReportEmergencyDetails;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Is the vehicle movable?'**
  String get accReportVehicleMovable;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Is recovery / towing required?'**
  String get accReportRecoveryRequired;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Is the vehicle safe to operate?'**
  String get accReportSafeToOperate;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Was a third party involved?'**
  String get accReportThirdPartyInvolved;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Third-party name'**
  String get accReportThirdPartyName;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Third-party vehicle'**
  String get accReportThirdPartyVehicle;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Third-party plate'**
  String get accReportThirdPartyPlate;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Third-party contact'**
  String get accReportThirdPartyContact;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Third-party insurer'**
  String get accReportThirdPartyInsurer;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Is a third-party invoice available?'**
  String get accReportThirdPartyInvoice;

  /// Field helper.
  ///
  /// In en, this message translates to:
  /// **'This is optional. If available, record only the invoice number; the Insurance team can request the file later.'**
  String get accReportThirdPartyInvoiceHelper;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Third-party invoice number'**
  String get accReportThirdPartyInvoiceNumber;

  /// Yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Was a Najm case opened?'**
  String get accReportNajmOpened;

  /// Field helper.
  ///
  /// In en, this message translates to:
  /// **'Record only when Najm applies to this incident.'**
  String get accReportNajmHelper;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Najm reference'**
  String get accReportNajmReference;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Witness details'**
  String get accReportWitnessDetails;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Immediate action taken'**
  String get accReportImmediateAction;

  /// Field label.
  ///
  /// In en, this message translates to:
  /// **'Additional notes'**
  String get accReportAdditionalNotes;

  /// Review card title.
  ///
  /// In en, this message translates to:
  /// **'Ready to submit'**
  String get accReportReadyToSubmit;

  /// Review card title.
  ///
  /// In en, this message translates to:
  /// **'Missing before submission'**
  String get accReportMissingBeforeSubmit;

  /// Review chip.
  ///
  /// In en, this message translates to:
  /// **'Complete'**
  String get accReportComplete;

  /// Blank value read-out.
  ///
  /// In en, this message translates to:
  /// **'Not recorded'**
  String get accNotRecorded;

  /// Unanswered yes/no question.
  ///
  /// In en, this message translates to:
  /// **'Not answered'**
  String get accNotAnswered;

  /// Review row label.
  ///
  /// In en, this message translates to:
  /// **'Asset'**
  String get accReportReviewAsset;

  /// Review row label.
  ///
  /// In en, this message translates to:
  /// **'Incident'**
  String get accReportReviewIncident;

  /// Review row label.
  ///
  /// In en, this message translates to:
  /// **'Date and time'**
  String get accReportReviewDateTime;

  /// Review row label.
  ///
  /// In en, this message translates to:
  /// **'Site / location'**
  String get accReportReviewSiteLocation;

  /// Review row label.
  ///
  /// In en, this message translates to:
  /// **'What happened'**
  String get accReportReviewWhatHappened;

  /// Review row label.
  ///
  /// In en, this message translates to:
  /// **'People'**
  String get accReportReviewPeople;

  /// Review row value.
  ///
  /// In en, this message translates to:
  /// **'Driver {driver} · Injuries {injuries}'**
  String accReportReviewPeopleValue(String driver, String injuries);

  /// Review row label.
  ///
  /// In en, this message translates to:
  /// **'Damage marks'**
  String get accReportReviewDamageMarks;

  /// Review row label.
  ///
  /// In en, this message translates to:
  /// **'Focused photos'**
  String get accReportReviewFocusedPhotos;

  /// Review row value.
  ///
  /// In en, this message translates to:
  /// **'{done} of {total}'**
  String accReportReviewPhotosValue(int done, int total);

  /// Review row label.
  ///
  /// In en, this message translates to:
  /// **'Optional documents'**
  String get accReportReviewOptionalDocuments;

  /// Review row value.
  ///
  /// In en, this message translates to:
  /// **'{count} attached'**
  String accReportReviewAttachedValue(int count);

  /// Review note.
  ///
  /// In en, this message translates to:
  /// **'Recipients, route and initial SLA are resolved by the configured accident workflow when this queued report syncs.'**
  String get accReportWorkflowResolvesOnSync;

  /// Draft status.
  ///
  /// In en, this message translates to:
  /// **'Draft auto-saves on device'**
  String get accReportDraftAutoSaves;

  /// Draft status.
  ///
  /// In en, this message translates to:
  /// **'Unsaved changes'**
  String get accReportDraftUnsaved;

  /// Draft status.
  ///
  /// In en, this message translates to:
  /// **'Saving draft…'**
  String get accReportDraftSaving;

  /// Draft status.
  ///
  /// In en, this message translates to:
  /// **'Draft saved on device'**
  String get accReportDraftSaved;

  /// Draft status with time.
  ///
  /// In en, this message translates to:
  /// **'Draft saved on device · {time}'**
  String accReportDraftSavedAt(String time);

  /// Draft status.
  ///
  /// In en, this message translates to:
  /// **'Draft save failed'**
  String get accReportDraftSaveFailedShort;

  /// Draft status.
  ///
  /// In en, this message translates to:
  /// **'Restoring saved draft…'**
  String get accReportDraftRestoring;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Save and exit'**
  String get accReportSaveAndExit;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get accReportBack;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Submit accident'**
  String get accReportSubmit;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Continue to incident details'**
  String get accReportContinueToIncident;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Continue to evidence'**
  String get accReportContinueToEvidence;

  /// Button.
  ///
  /// In en, this message translates to:
  /// **'Save & Continue'**
  String get accReportSaveAndContinue;

  /// Vehicle picker result line.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 fleet result · search asset, fleet, plate, type, make, model or site} other{{count} fleet results · search asset, fleet, plate, type, make, model or site}}'**
  String accReportFleetResults(int count);

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Collision'**
  String get accTypeCollision;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Rollover'**
  String get accTypeRollover;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Rear-end'**
  String get accTypeRearEnd;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Side-swipe'**
  String get accTypeSideSwipe;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Reversing'**
  String get accTypeReversing;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Fire'**
  String get accTypeFire;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Vandalism'**
  String get accTypeVandalism;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Weather'**
  String get accTypeWeather;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Tyre failure'**
  String get accTypeTyreFailure;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Mechanical'**
  String get accTypeMechanical;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Near miss'**
  String get accTypeNearMiss;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Property damage'**
  String get accTypePropertyDamage;

  /// Accident type.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get accTypeOther;

  /// Read-out for an accident field nobody has recorded.
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get accNotSet;

  /// Error when an evidence file type is not supported.
  ///
  /// In en, this message translates to:
  /// **'That file is not supported.'**
  String get accErrorFileUnsupported;

  /// Error when a value failed validation.
  ///
  /// In en, this message translates to:
  /// **'Check the values and try again.'**
  String get accErrorCheckValues;

  /// Generic accident action failure.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get accErrorGeneric;

  /// Notify chip for a role that is only informed.
  ///
  /// In en, this message translates to:
  /// **'{role} (for visibility)'**
  String accNotifyForVisibility(String role);

  /// Evidence source option: camera.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get accTakePhoto;

  /// Evidence source option: device file.
  ///
  /// In en, this message translates to:
  /// **'Choose a file from the device'**
  String get accChooseDeviceFile;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Dispatch & Handover'**
  String get accDhDispatchHandover;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Repair route'**
  String get accDhRepairRoute;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Dispatch status'**
  String get accDhDispatchStatus;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Transit elapsed'**
  String get accDhTransitElapsed;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Vendor repair SLA'**
  String get accDhVendorRepairSla;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'SLA unavailable'**
  String get accDhSlaUnavailable;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Vendor SLA starts only after signed vehicle acceptance.'**
  String get accDhVendorSlaStartsOnlyAfterSigned;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'The SLA clock starts when the workshop signs vehicle acceptance.'**
  String get accDhTheSlaClockStartsWhenThe;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get accDhRetry;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Dispatch legs are not provisioned on this database yet. Dispatch details, handover condition and the workshop receipt cannot be recorded until the migration is applied.'**
  String get accDhDispatchLegsAreNotProvisionedOn;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Vendor contact fields are not provisioned yet; only the workshop name is stored.'**
  String get accDhVendorContactFieldsAreNotProvisioned;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'After acceptance, vendor can add inspection details, quotation, parts, schedule and progress in its own workspace. PO is created only after quotation review and approval.'**
  String get accDhAfterAcceptanceVendorCanAddInspection;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Open case timeline'**
  String get accDhOpenCaseTimeline;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Open workshop assessment'**
  String get accDhOpenWorkshopAssessment;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Not started'**
  String get accDhNotStarted;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Met'**
  String get accDhMet;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Breached'**
  String get accDhBreached;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Paused'**
  String get accDhPaused;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get accDhRunning;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get accDhCancelled;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Started, no SLA target'**
  String get accDhStartedNoSlaTarget;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Destination and vendor'**
  String get accDhDestinationAndVendor;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Workshop name'**
  String get accDhWorkshopName;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get accDhCity;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Vendor contact name'**
  String get accDhVendorContactName;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get accDhPhone;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get accDhEmail;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Workshop registration / tax no.'**
  String get accDhWorkshopRegistrationTaxNo;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Assigned vendor inspector'**
  String get accDhAssignedVendorInspector;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Unassigned'**
  String get accDhUnassigned;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Edit vendor details'**
  String get accDhEditVendorDetails;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Contact workshop'**
  String get accDhContactWorkshop;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get accDhCancel;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Save vendor'**
  String get accDhSaveVendor;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Dispatch details'**
  String get accDhDispatchDetails;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Sent by'**
  String get accDhSentBy;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Departure'**
  String get accDhDeparture;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Carrier'**
  String get accDhCarrier;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Driver'**
  String get accDhDriver;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Recovery vehicle'**
  String get accDhRecoveryVehicle;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Origin'**
  String get accDhOrigin;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Destination'**
  String get accDhDestination;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Estimated arrival'**
  String get accDhEstimatedArrival;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Live status'**
  String get accDhLiveStatus;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Record dispatch'**
  String get accDhRecordDispatch;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Odometer (km)'**
  String get accDhOdometerKm;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Engine hours'**
  String get accDhEngineHours;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Fuel %'**
  String get accDhFuel;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Keys'**
  String get accDhKeys;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Documents sent (one per line)'**
  String get accDhDocumentsSentOnePerLine;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Accessories / checklist (one per line)'**
  String get accDhAccessoriesChecklistOnePerLine;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Outgoing damage photos'**
  String get accDhOutgoingDamagePhotos;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Outgoing condition signed by'**
  String get accDhOutgoingConditionSignedBy;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Outgoing signature'**
  String get accDhOutgoingSignature;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Save dispatch'**
  String get accDhSaveDispatch;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Vehicle handover condition'**
  String get accDhVehicleHandoverCondition;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Odometer'**
  String get accDhOdometer;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Fuel'**
  String get accDhFuel2;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Documents sent'**
  String get accDhDocumentsSent;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'documents'**
  String get accDhDocuments;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Accessories / checklist'**
  String get accDhAccessoriesChecklist;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'items'**
  String get accDhItems;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'photos'**
  String get accDhPhotos;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Workshop receipt'**
  String get accDhWorkshopReceipt;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Completed by vendor'**
  String get accDhCompletedByVendor;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Arrived'**
  String get accDhArrived;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Received by'**
  String get accDhReceivedBy;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Incoming odometer'**
  String get accDhIncomingOdometer;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Incoming engine hours'**
  String get accDhIncomingEngineHours;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Incoming fuel'**
  String get accDhIncomingFuel;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Condition matches dispatch'**
  String get accDhConditionMatchesDispatch;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Yes'**
  String get accDhYes;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'No'**
  String get accDhNo;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Additional damage / remarks'**
  String get accDhAdditionalDamageRemarks;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Receiving photos'**
  String get accDhReceivingPhotos;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Custody accepted'**
  String get accDhCustodyAccepted;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Vendor receiver signature'**
  String get accDhVendorReceiverSignature;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Sender / driver signature'**
  String get accDhSenderDriverSignature;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Completed by vendor'**
  String get accDhCompletedByVendor2;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'No dispatch leg is recorded yet. Record the dispatch first; the receipt is signed against it.'**
  String get accDhNoDispatchLegIsRecordedYet;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Arrived date / time *'**
  String get accDhArrivedDateTime;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Received by (name) *'**
  String get accDhReceivedByName;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Designation *'**
  String get accDhDesignation;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Incoming odometer (km)'**
  String get accDhIncomingOdometerKm;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Incoming fuel %'**
  String get accDhIncomingFuel2;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Upload receiving photos *'**
  String get accDhUploadReceivingPhotos;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Upload signed handover paper *'**
  String get accDhUploadSignedHandoverPaper;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Vendor receiver signature *'**
  String get accDhVendorReceiverSignature2;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Sender / driver signature (captured)'**
  String get accDhSenderDriverSignatureCaptured;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'I accept custody of this vehicle'**
  String get accDhIAcceptCustodyOfThisVehicle;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Sign and accept vehicle'**
  String get accDhSignAndAcceptVehicle;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Complete all required fields to enable'**
  String get accDhCompleteAllRequiredFieldsToEnable;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Missing'**
  String get accDhMissing;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Arrived date / time'**
  String get accDhArrivedDateTime2;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Designation'**
  String get accDhDesignation2;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Signed handover paper'**
  String get accDhSignedHandoverPaper;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Vendor receiver signature'**
  String get accDhVendorReceiverSignature3;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Custody checkbox'**
  String get accDhCustodyCheckbox;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Complete'**
  String get accDhComplete;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get accDhNext;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get accDhPending;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Dispatched'**
  String get accDhDispatched;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Arrived'**
  String get accDhArrived2;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Signed acceptance'**
  String get accDhSignedAcceptance;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Vendor assessment / quotation starts'**
  String get accDhVendorAssessmentQuotationStarts;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Pick'**
  String get accDhPick;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Use now'**
  String get accDhUseNow;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'attached'**
  String get accDhAttached;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get accDhCamera;

  /// Accident workspace copy (accident_ws_dispatch_handover.dart).
  ///
  /// In en, this message translates to:
  /// **'Gallery'**
  String get accDhGallery;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Add timeline note'**
  String get accTlAddTimelineNote;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Note'**
  String get accTlNote;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Save note'**
  String get accTlSaveNote;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Notify participants'**
  String get accTlNotifyParticipants;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'This logs the notification on the case ledger. Delivery to people is done by the server notification engine.'**
  String get accTlThisLogsTheNotificationOnThe;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Subject'**
  String get accTlSubject;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get accTlMessage;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Log notification'**
  String get accTlLogNotification;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Manage recipient groups'**
  String get accTlManageRecipientGroups;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Recipients are set by Admin per event and role. The groups below are the roles each event reaches; membership comes from user profiles.'**
  String get accTlRecipientsAreSetByAdminPer;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Visibility'**
  String get accTlVisibility;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Time'**
  String get accTlTime;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'By'**
  String get accTlBy;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'To'**
  String get accTlTo;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get accTlStatus;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Elapsed'**
  String get accTlElapsed;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Case timeline & notifications'**
  String get accTlCaseTimelineNotifications;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get accTlOpen;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Current owner'**
  String get accTlCurrentOwner;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Next SLA'**
  String get accTlNextSla;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Due in'**
  String get accTlDueIn;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Add timeline note'**
  String get accTlAddTimelineNote2;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Notify participants'**
  String get accTlNotifyParticipants2;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'not provisioned yet on this database'**
  String get accTlNotProvisionedYetOnThisDatabase;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'could not be read; the feed omits it'**
  String get accTlCouldNotBeReadTheFeed;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Communications'**
  String get accTlCommunications;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Evidence'**
  String get accTlEvidence;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'SLA clocks'**
  String get accTlSlaClocks;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Dispatch leg'**
  String get accTlDispatchLeg;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'GPS fix'**
  String get accTlGpsFix;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Timeline'**
  String get accTlTimeline;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get accTlNotifications;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Participants'**
  String get accTlParticipants;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get accTlAll;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Actions'**
  String get accTlActions;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Documents'**
  String get accTlDocuments;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'SLA'**
  String get accTlSla;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Emails'**
  String get accTlEmails;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get accTlCompleted;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'In transit'**
  String get accTlInTransit;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'No recorded events for this filter.'**
  String get accTlNoRecordedEventsForThisFilter;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Notification delivery log'**
  String get accTlNotificationDeliveryLog;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'No notifications recorded for this case.'**
  String get accTlNoNotificationsRecordedForThisCase;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Trigger'**
  String get accTlTrigger;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Recipients'**
  String get accTlRecipients;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Channel'**
  String get accTlChannel;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Show status'**
  String get accTlShowStatus;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'View all notifications'**
  String get accTlViewAllNotifications;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Manage recipient groups'**
  String get accTlManageRecipientGroups2;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Recipients are set by Admin per event and role.'**
  String get accTlRecipientsAreSetByAdminPer2;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'Participants and ownership'**
  String get accTlParticipantsAndOwnership;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'by'**
  String get accTlBy2;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'to'**
  String get accTlTo2;

  /// Accident workspace copy (accident_ws_timeline.dart).
  ///
  /// In en, this message translates to:
  /// **'SLA met'**
  String get accTlSlaMet;

  /// Dispatch workspace save failure.
  ///
  /// In en, this message translates to:
  /// **'The change could not be saved. Try again.'**
  String get accDhChangeNotSaved;

  /// Dispatch workspace contact failure.
  ///
  /// In en, this message translates to:
  /// **'The workshop contact could not be opened on this device.'**
  String get accDhContactOpenFailed;

  /// Validation.
  ///
  /// In en, this message translates to:
  /// **'Record the departure time first.'**
  String get accDhRecordDepartureFirst;

  /// Timeline load failure.
  ///
  /// In en, this message translates to:
  /// **'The timeline could not be loaded. Try again.'**
  String get accTlLoadFailed;

  /// SLA overdue read-out.
  ///
  /// In en, this message translates to:
  /// **'Overdue {elapsed}'**
  String accTlOverdueBy(String elapsed);
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
