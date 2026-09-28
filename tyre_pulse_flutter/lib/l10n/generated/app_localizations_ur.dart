// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Urdu (`ur`).
class AppLocalizationsUr extends AppLocalizations {
  AppLocalizationsUr([String locale = 'ur']) : super(locale);

  @override
  String get appTitle => 'Tyre Pulse';

  @override
  String get actionBack => 'واپس';

  @override
  String get actionRetry => 'دوبارہ کوشش کریں';

  @override
  String get actionClose => 'بند کریں';

  @override
  String get actionCancel => 'منسوخ کریں';

  @override
  String get actionSignIn => 'سائن اِن';

  @override
  String get actionSignOut => 'سائن آؤٹ';

  @override
  String get actionOpenStore => 'اسٹور کھولیں';

  @override
  String get actionClear => 'صاف کریں';

  @override
  String get valueUnavailable => 'دستیاب نہیں';

  @override
  String get valueNotMeasured => '-';

  @override
  String get stateLoading => 'لوڈ ہو رہا ہے';

  @override
  String get stateEmptyTitle => 'ابھی یہاں کچھ نہیں';

  @override
  String get stateEmptyMessage =>
      'جب دکھانے کے لیے کچھ ہوگا تو یہاں آ جائے گا۔';

  @override
  String get stateErrorTitle => 'کچھ غلط ہو گیا';

  @override
  String get stateErrorMessage =>
      'آخری کارروائی مکمل نہیں ہوئی۔ کچھ تبدیل نہیں ہوا۔';

  @override
  String get stateOfflineCachedTitle => 'محفوظ شدہ ڈیٹا دکھایا جا رہا ہے';

  @override
  String get stateOfflineCachedMessage =>
      'آپ آف لائن ہیں۔ یہ اسی ڈیوائس پر محفوظ نقل ہے، ممکن ہے پرانی ہو۔';

  @override
  String stateOfflineCachedAt(String timestamp) {
    return 'محفوظ کیا گیا $timestamp';
  }

  @override
  String get stateBackendUnavailableTitle => 'سرور جواب نہیں دے رہا';

  @override
  String get stateBackendUnavailableMessage =>
      'آپ کا کام اس ڈیوائس پر محفوظ ہے۔ رابطہ بحال ہوتے ہی بھیج دیا جائے گا۔';

  @override
  String get stateNotConfiguredTitle => 'ترتیب نہیں دیا گیا';

  @override
  String get stateNotConfiguredMessage =>
      'آپ کے ادارے کے لیے یہ حصہ ترتیب نہیں دیا گیا۔ آپ کا ایڈمن اسے فعال کر سکتا ہے۔';

  @override
  String get stateScreenNotAvailableTitle => 'یہ اسکرین ابھی تیار نہیں';

  @override
  String get stateScreenNotAvailableMessage =>
      'اس تک پہنچنا کام کرتا ہے، مگر اسکرین خود ابھی نہیں بنی۔ یہ زیرِ تعمیر ہے، آپ کے اکاؤنٹ کا مسئلہ نہیں۔';

  @override
  String get deniedTitle => 'اس اسکرین تک رسائی نہیں';

  @override
  String get deniedNotGranted =>
      'آپ کو اس ماڈیول تک رسائی نہیں۔ اپنے ایڈمن سے رابطہ کریں۔';

  @override
  String get deniedAdminOnly => 'یہ اسکرین صرف ایڈمن کے لیے ہے۔';

  @override
  String get deniedSuperAdminOnly => 'یہ اسکرین صرف پلیٹ فارم مالک کے لیے ہے۔';

  @override
  String get deniedPermissionsUnavailable =>
      'آپ کی اجازتیں پڑھی نہیں جا سکیں، اس لیے یہ اسکرین بند ہے۔ باقی ایپ کام کر رہی ہے۔';

  @override
  String get offlineTitle => 'آف لائن';

  @override
  String get offlineMessage =>
      'آپ کام جاری رکھ سکتے ہیں۔ سب کچھ اسی ڈیوائس پر محفوظ ہے۔';

  @override
  String syncPendingChanges(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count تبدیلیاں سِنک ہونا باقی ہیں',
      one: '1 تبدیلی سِنک ہونا باقی ہے',
      zero: 'کوئی تبدیلی زیرِ التوا نہیں',
    );
    return '$_temp0';
  }

  @override
  String syncInProgress(int completed, int total) {
    return 'سِنک ہو رہا ہے، $total میں سے $completed';
  }

  @override
  String get syncAllSynced => 'تمام تبدیلیاں سِنک ہو گئیں';

  @override
  String syncNeedsAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count آئٹمز پر توجہ درکار ہے',
      one: '1 آئٹم پر توجہ درکار ہے',
      zero: 'کسی چیز پر توجہ درکار نہیں',
    );
    return '$_temp0';
  }

  @override
  String get syncStatusUnknown => 'رابطے کی حالت معلوم نہیں';

  @override
  String get sessionRestoringTitle => 'Tyre Pulse کھل رہا ہے';

  @override
  String get sessionTimedOutTitle => 'معمول سے زیادہ وقت لگ رہا ہے';

  @override
  String get sessionTimedOutMessage =>
      'آپ کا محفوظ سائن اِن نہیں کھل سکا۔ دوبارہ کوشش کریں یا نئے سرے سے سائن اِن کریں۔';

  @override
  String get updateRequiredTitle => 'اپ ڈیٹ ضروری ہے';

  @override
  String get updateRequiredMessage =>
      'Tyre Pulse کا یہ ورژن بہت پرانا ہے۔ جاری رکھنے کے لیے اپ ڈیٹ انسٹال کریں۔';

  @override
  String get profileUnavailableTitle => 'آپ کی پروفائل لوڈ نہیں ہو سکی';

  @override
  String get profileUnavailableMessage =>
      'آپ کے اکاؤنٹ کی تفصیل لوڈ نہیں ہوئی، اس لیے ایپ آپ کی اجازتیں نہیں جان سکتی۔ دوبارہ کوشش کریں یا سائن آؤٹ کر کے دوبارہ سائن اِن کریں۔';

  @override
  String get accessBlockedTitle => 'آپ کا اکاؤنٹ فعال نہیں';

  @override
  String get accessBlockedMessage =>
      'آپ کا اکاؤنٹ منظوری کا منتظر ہے یا مقفل کر دیا گیا ہے۔ آپ کا ایڈمن اسے درست کر سکتا ہے۔';

  @override
  String get routeNotFoundTitle => 'یہ اسکرین موجود نہیں';

  @override
  String get routeNotFoundMessage =>
      'جو لنک آپ نے کھولا وہ اس ایپ میں کہیں نہیں جاتا۔';

  @override
  String get tabHome => 'ہوم';

  @override
  String get tabInspect => 'معائنہ';

  @override
  String get tabAccidents => 'حادثات';

  @override
  String get tabMeter => 'میٹر';

  @override
  String get tabWashing => 'دھلائی';

  @override
  String get tabProfile => 'پروفائل';

  @override
  String get tabHistory => 'تاریخ';

  @override
  String get tabChecklists => 'چیک لسٹ';

  @override
  String get tabApprovals => 'منظوریاں';

  @override
  String get searchHint => 'تلاش';

  @override
  String get dropdownHint => 'منتخب کریں';

  @override
  String get fieldRequired => 'لازمی';

  @override
  String get statusOk => 'ٹھیک';

  @override
  String get statusWarning => 'توجہ درکار';

  @override
  String get statusCritical => 'نازک';

  @override
  String get statusInfo => 'معلومات';

  @override
  String get statusNeutral => 'غیر جانبدار';

  @override
  String get statusUnknown => 'ناپا نہیں گیا';

  @override
  String get vehiclesTitle => 'گاڑیاں';

  @override
  String vehiclesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'فلیٹ میں $count گاڑیاں',
      one: 'فلیٹ میں 1 گاڑی',
      zero: 'فلیٹ میں کوئی گاڑی نہیں',
    );
    return '$_temp0';
  }

  @override
  String get vehiclesSearchHint => 'اثاثہ، سیریل، ساخت، قسم یا سائٹ تلاش کریں';

  @override
  String get vehiclesTyreAssetsFilter => 'ٹائر والے اثاثے';

  @override
  String get vehiclesAllFilter => 'تمام';

  @override
  String get vehiclesEmptyTitle => 'کوئی گاڑی نہیں ملی';

  @override
  String get vehiclesEmptySearchMessage => 'مختلف تلاش کی اصطلاح آزمائیں۔';

  @override
  String get vehiclesDetailSubtitle => 'گاڑی 360°';

  @override
  String get vehiclesMultiViewTitle => 'گاڑی کے مناظر';

  @override
  String get vehiclesMultiViewHint => 'سامنے · پیچھے · اوپر · بائیں · دائیں';

  @override
  String get vehiclesMultiViewZoom => 'زوم کرنے کے لیے ٹیپ کریں';

  @override
  String get vehiclesUnknownAsset => 'نامعلوم گاڑی';

  @override
  String get vehiclesFieldFleetNo => 'فلیٹ نمبر';

  @override
  String get vehiclesFieldType => 'قسم';

  @override
  String get vehiclesFieldMakeModel => 'ساخت اور ماڈل';

  @override
  String get vehiclesFieldYear => 'سال';

  @override
  String get vehiclesFieldCurrentKm => 'موجودہ اوڈومیٹر';

  @override
  String get vehiclesFieldOperator => 'آپریٹر';

  @override
  String get vehiclesFieldDepartment => 'شعبہ';

  @override
  String get vehiclesFieldSite => 'سائٹ';

  @override
  String get vehiclesFieldRegion => 'علاقہ';

  @override
  String get vehiclesFieldCountry => 'ملک';

  @override
  String get vehiclesFieldTyreSize => 'ٹائر کا سائز';

  @override
  String get vehiclesFieldRegistration => 'رجسٹریشن';

  @override
  String get vehiclesFieldSerialNo => 'آلات کا سیریل نمبر';

  @override
  String get vehiclesFieldEngineNo => 'انجن نمبر';

  @override
  String get vehiclesFieldCapacity => 'گنجائش';

  @override
  String get vehiclesFieldOperationalStatus => 'آپریشنل حالت';

  @override
  String get vehiclesStartInspection => 'معائنہ شروع کریں';

  @override
  String get vehiclesNotFoundTitle => 'گاڑی نہیں ملی';

  @override
  String get vehiclesNotFoundMessage =>
      'یہ گاڑی فلیٹ رجسٹر میں نہیں ملی۔ ہو سکتا ہے اسے ہٹا دیا گیا ہو یا کسی دوسرے ملک میں منتقل کر دیا گیا ہو۔';

  @override
  String get vehiclesTruncatedNotice =>
      'فلیٹ کا کچھ حصہ دکھایا جا رہا ہے۔ مخصوص گاڑی تلاش کرنے کے لیے تلاش کو محدود کریں۔';

  @override
  String get serialSearchTitle => 'سیریل نمبر تلاش';

  @override
  String get serialSearchSubtitle => 'سیریل نمبر سے ٹائر تلاش کریں';

  @override
  String get serialSearchLabel => 'ٹائر کا سیریل نمبر';

  @override
  String get serialSearchPlaceholder => 'سیریل نمبر لکھیں یا پیسٹ کریں';

  @override
  String get serialSearchHelp =>
      'اسکین شدہ لیبل، لنک اور QR ٹیکسٹ خودکار طور پر کھول دیے جاتے ہیں۔';

  @override
  String get serialSearchSearching => 'ٹائر تلاش کیا جا رہا ہے...';

  @override
  String get serialSearchFound => 'ٹائر مل گیا';

  @override
  String get serialSearchBrand => 'برانڈ';

  @override
  String get serialSearchSize => 'سائز';

  @override
  String get serialSearchPosition => 'پوزیشن';

  @override
  String get serialSearchAsset => 'اثاثہ';

  @override
  String get serialSearchSite => 'سائٹ';

  @override
  String get serialSearchLastReading => 'آخری ریڈنگ';

  @override
  String get serialSearchInspectThis => 'اس ٹائر کا معائنہ کریں';

  @override
  String get serialSearchNoAssetNote =>
      'یہ ٹائر کسی اثاثے پر نصب نہیں، اس لیے یہاں سے معائنہ شروع نہیں کیا جا سکتا۔';

  @override
  String get serialSearchEmptyTitle => 'اس سیریل نمبر پر کوئی ٹائر نہیں ملا';

  @override
  String get serialSearchEmptyMessage =>
      'سیریل نمبر چیک کر کے دوبارہ کوشش کریں۔ یہ کسی اور سائٹ کا ہو سکتا ہے یا ابھی درج نہیں کیا گیا۔';

  @override
  String get serialSearchIdleTitle => 'ٹائر کا سیریل نمبر تلاش کریں';

  @override
  String get serialSearchIdleMessage =>
      'ٹائر کا برانڈ، سائز، پوزیشن اور آخری ریڈنگ دیکھنے کے لیے اوپر سیریل نمبر درج کریں۔';

  @override
  String get serialSearchScrappedBadge => 'ضائع شدہ';

  @override
  String get serialSearchScrapReasonLabel => 'وجہ';

  @override
  String get serialSearchScrapReasonPlaceholder =>
      'یہ ٹائر کیوں ضائع کیا جا رہا ہے؟';

  @override
  String get serialSearchMarkScrap => 'ضائع شدہ کا نشان لگائیں';

  @override
  String get serialSearchUndoScrap => 'ضائع شدہ نشان ہٹائیں';

  @override
  String get serialSearchScrapModalTitle => 'یہ ٹائر ضائع کریں';

  @override
  String get serialSearchConfirmScrap => 'ضائع کرنے کی تصدیق کریں';

  @override
  String get serialSearchUndoConfirmTitle => 'کیا ضائع شدہ نشان ہٹا دیں؟';

  @override
  String get serialSearchUndoConfirmMessage =>
      'یہ ٹائر دوبارہ فعال کے طور پر نشان زد ہو جائے گا۔';

  @override
  String get scannerTitle => 'اسکین';

  @override
  String get scannerCameraUnavailableTitle =>
      'اس ورژن میں کیمرہ اسکیننگ دستیاب نہیں';

  @override
  String get scannerCameraUnavailableMessage =>
      'اس کے بجائے لیبل سے کوڈ لکھیں یا پیسٹ کریں۔ نیچے دیا گیا سب کچھ اسکین کی طرح کام کرتا ہے۔';

  @override
  String get scannerCameraPermissionDeniedReason =>
      'کیمرے تک رسائی سے انکار کر دیا گیا۔ اس کے بجائے لیبل سے کوڈ لکھیں یا پیسٹ کریں۔';

  @override
  String get scannerManualEntryLabel => 'کوڈ درج کریں';

  @override
  String get scannerCodeFieldLabel => 'اثاثہ یا ٹائر کوڈ';

  @override
  String get scannerCodeFieldHint => 'مثلاً TM514 یا ٹائر کا سیریل نمبر';

  @override
  String get scannerLookUpAction => 'تلاش کریں';

  @override
  String get scannerNoMatchTitle => 'اس کوڈ کے لیے کوئی نتیجہ نہیں';

  @override
  String get scannerNoMatchMessage =>
      'کوڈ چیک کر کے دوبارہ کوشش کریں، یا مزید تلاش کے لیے سیریل نمبر تلاش کھولیں۔';

  @override
  String get scannerOpenSerialSearchAction => 'سیریل نمبر تلاش کھولیں';

  @override
  String get scannerScanAnotherAction => 'دوسرا کوڈ تلاش کریں';

  @override
  String get scannerViewAssetAction => 'اثاثہ دیکھیں';

  @override
  String get scannerStartInspectionAction => 'معائنہ شروع کریں';

  @override
  String get scannerViewTyreAction => 'ٹائر دیکھیں';

  @override
  String get recordsTitle => 'ٹائر ریکارڈز';

  @override
  String recordsShownCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ٹائر ریکارڈز دکھائے گئے',
      one: '1 ٹائر ریکارڈ دکھایا گیا',
      zero: 'کوئی ٹائر ریکارڈ موجود نہیں',
    );
    return '$_temp0';
  }

  @override
  String get recordsSearchHint => 'اثاثہ نمبر، سیریل یا برانڈ تلاش کریں';

  @override
  String get recordsEmptyTitle => 'کوئی ریکارڈ نہیں ملا';

  @override
  String get recordsEmptyMessage =>
      'مختلف تلاش آزمائیں یا اپنے فلٹرز صاف کریں۔';

  @override
  String get recordsLoadMoreError => 'مزید ریکارڈز لوڈ نہیں ہو سکے۔';

  @override
  String get recordsEndOfList => 'آپ فہرست کے آخر تک پہنچ گئے ہیں۔';

  @override
  String get recordsFilterTitle => 'ریکارڈز فلٹر کریں';

  @override
  String get recordsRiskLevel => 'خطرے کی سطح';

  @override
  String get recordsSite => 'سائٹ';

  @override
  String get recordsApplyFilters => 'فلٹرز لاگو کریں';

  @override
  String get recordsClearFilters => 'فلٹرز صاف کریں';

  @override
  String recordsActiveFilters(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count فلٹرز فعال ہیں',
      one: '1 فلٹر فعال ہے',
      zero: 'کوئی فلٹر فعال نہیں',
    );
    return '$_temp0';
  }

  @override
  String get recordsSerialNo => 'سیریل نمبر';

  @override
  String get recordsIssueDate => 'اجراء کی تاریخ';

  @override
  String get recordsCategory => 'قسم';

  @override
  String get recordsCostPerTyre => 'فی ٹائر لاگت';

  @override
  String get recordsKmFitment => 'تنصیب کے وقت کلومیٹر';

  @override
  String get recordsKmRemoval => 'ہٹانے کے وقت کلومیٹر';

  @override
  String get recordsTyreLife => 'ٹائر کی عمر (کلومیٹر)';

  @override
  String get recordsCountry => 'ملک';

  @override
  String get recordsDescription => 'تفصیل';

  @override
  String get recordsRemarks => 'تبصرے';

  @override
  String get recordsDetailFallbackTitle => 'ٹائر ریکارڈ';

  @override
  String get tyreDiagramFrontLabel => 'سامنے';

  @override
  String get tyreDiagramTapHint => 'ٹائر کی حالت درج کرنے کے لیے اسے ٹیپ کریں';

  @override
  String tyreDiagramTyreCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ٹائر',
      one: '1 ٹائر',
      zero: 'کوئی ٹائر نہیں',
    );
    return '$_temp0';
  }

  @override
  String tyreDiagramPendingLeadIn(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ٹائروں کی تفصیلات ابھی درکار ہیں',
      one: '1 ٹائر کی تفصیلات ابھی درکار ہیں',
    );
    return '$_temp0';
  }

  @override
  String get tyreDiagramTyrelessMessage =>
      'ساکن آلات، معائنے کے لیے کوئی ٹائر نہیں۔';

  @override
  String get tyreDiagramEmptyMessage =>
      'دکھانے کے لیے کوئی ٹائر پوزیشن موجود نہیں۔';

  @override
  String tyreDiagramPressureDetail(String value) {
    return 'دباؤ $value پی ایس آئی';
  }

  @override
  String get tyreConditionGood => 'اچھا';

  @override
  String get tyreConditionWorn => 'گھسا ہوا';

  @override
  String get tyreConditionDamaged => 'خراب';

  @override
  String get tyreConditionPuncture => 'پنکچر';

  @override
  String get tyreConditionFlat => 'سپاٹ';

  @override
  String get tyreConditionMissing => 'غائب';

  @override
  String get inspectionNavTitle => 'نیا معائنہ';

  @override
  String get inspectionStep1Label => '1';

  @override
  String get inspectionStep2Label => '2';

  @override
  String get inspectionStep3Label => '3';

  @override
  String get inspectionResumeTitle => 'نامکمل کام جاری رکھیں';

  @override
  String inspectionResumeProgress(int filled, int total) {
    return '$total میں سے $filled چیک کیے گئے';
  }

  @override
  String get inspectionWorkflowNotStarted => 'شروع نہیں ہوا';

  @override
  String get inspectionWorkflowInProgress => 'جاری ہے';

  @override
  String get inspectionWorkflowReadyForReview => 'جائزے کے لیے تیار';

  @override
  String inspectionWorkflowResumeSummary(String status, String progress) {
    return '$status • $progress';
  }

  @override
  String get inspectionWorkflowTapTyre =>
      'معائنے کی تفصیلات شامل کرنے کے لیے ٹائر پر ٹیپ کریں۔';

  @override
  String get inspectionWorkflowContinueChecking =>
      'ٹائر پوزیشنز چیک کرتے رہیں جب تک ہر پوزیشن میں کافی تفصیل شامل نہ ہو۔';

  @override
  String get inspectionWorkflowAllChecked =>
      'تمام ٹائر پوزیشنز چیک ہو گئی ہیں۔ اب جائزہ لے کر دستخط کیے جا سکتے ہیں۔';

  @override
  String get inspectionChangeVehicleButton => 'تبدیل کریں';

  @override
  String get inspectionSiteLabel => 'سائٹ';

  @override
  String get inspectionTypeSiteName => 'سائٹ کا نام لکھیں';

  @override
  String get inspectionOdometerLabel => 'اوڈومیٹر (کلومیٹر)';

  @override
  String get inspectionOdometerHint => 'اختیاری';

  @override
  String get inspectionHourMeterLabel => 'آور میٹر';

  @override
  String get inspectionHourMeterHint => 'اختیاری';

  @override
  String get inspectionNextButton => 'اگلا: ٹائر پوزیشنز';

  @override
  String get inspectionVehicleSearchPlaceholder =>
      'اثاثہ نمبر یا قسم سے تلاش کریں';

  @override
  String get inspectionSearchToBeginHint =>
      'فلیٹ میں تلاش کے لیے ٹائپ کرنا شروع کریں۔';

  @override
  String get inspectionVehicleNoMatch => 'اس تلاش سے کوئی گاڑی نہیں ملی۔';

  @override
  String get inspectionEnterAssetManually => 'اثاثہ نمبر دستی طور پر درج کریں';

  @override
  String get inspectionManualAssetLabel => 'اثاثہ نمبر';

  @override
  String get inspectionManualUseButton => 'یہ اثاثہ استعمال کریں';

  @override
  String get inspectionTyrePositionsTitle => 'ٹائر پوزیشنز';

  @override
  String get inspectionDraftLabel => 'مسودہ';

  @override
  String inspectionTyreConfiguration(int count) {
    return '$count-ٹائر کنفیگریشن';
  }

  @override
  String inspectionStepOfTotal(int step, int total) {
    return 'مرحلہ $step از $total';
  }

  @override
  String get inspectionRearLabel => 'پچھلا حصہ';

  @override
  String get inspectionSelectedTyre => 'منتخب ٹائر';

  @override
  String get inspectionPressureShort => 'پریشر';

  @override
  String get inspectionTreadDepthShort => 'ٹریڈ گہرائی';

  @override
  String get inspectionAddEvidencePhoto => 'ثبوت شامل کریں (تصویر)';

  @override
  String get inspectionSaveAndNext => 'محفوظ کریں اور آگے';

  @override
  String get inspectionFrontLeft => 'سامنے بائیں';

  @override
  String get inspectionFrontRight => 'سامنے دائیں';

  @override
  String get inspectionInnerLeft => 'اندرونی بائیں';

  @override
  String get inspectionOuterLeft => 'بیرونی بائیں';

  @override
  String get inspectionInnerRight => 'اندرونی دائیں';

  @override
  String get inspectionOuterRight => 'بیرونی دائیں';

  @override
  String get inspectionRearLeft => 'پچھلا بائیں';

  @override
  String get inspectionRearRight => 'پچھلا دائیں';

  @override
  String get inspectionTyrePositionFallback => 'ٹائر پوزیشن';

  @override
  String get inspectionNotRecordedYet => 'ابھی ریکارڈ نہیں ہوا';

  @override
  String get inspectionValidationRecordTyre =>
      'آگے بڑھنے سے پہلے کم از کم ایک ٹائر ریکارڈ کریں۔';

  @override
  String inspectionTyresIncompleteLead(int count, int total) {
    return 'آگے بڑھنے سے پہلے $total میں سے $count ٹائروں کی تفصیلات ابھی درکار ہیں۔';
  }

  @override
  String get inspectionReviewButton => 'جائزہ لیں اور دستخط کریں';

  @override
  String get inspectionGpsCaptured => 'مقام حاصل کر لیا گیا';

  @override
  String get inspectionGpsCapturing => 'مقام حاصل کیا جا رہا ہے...';

  @override
  String get inspectionGpsUnavailable => 'مقام دستیاب نہیں';

  @override
  String get inspectionGpsRetry => 'دوبارہ کوشش کریں';

  @override
  String get inspectionReviewTitle => 'جائزہ';

  @override
  String inspectionPositionsRecorded(int touched, int total) {
    return '$total میں سے $touched ٹائر پوزیشنز ریکارڈ کی گئیں';
  }

  @override
  String get inspectionObservationsLabel => 'مشاہدات';

  @override
  String get inspectionObservationsPlaceholder =>
      'اس معائنے کے بارے میں کچھ اور قابلِ ذکر بات';

  @override
  String get inspectionInspectorSignatureLabel => 'معائنہ کار کے دستخط';

  @override
  String get inspectionSubmitForApproval => 'منظوری کے لیے جمع کروائیں';

  @override
  String get inspectionSignatureRequiredMsg =>
      'اس معائنے کو جمع کروانے سے پہلے دستخط درکار ہیں۔';

  @override
  String get inspectionSubmittedForApprovalTitle =>
      'منظوری کے لیے جمع کروا دیا گیا';

  @override
  String get inspectionQueuedTitle => 'اس ڈیوائس پر محفوظ کر لیا گیا';

  @override
  String get inspectionQueuedWithWarningTitle =>
      'محفوظ ہو گیا، لیکن سرور نے ابھی قبول نہیں کیا';

  @override
  String get inspectionBackHome => 'ہوم پر واپس جائیں';

  @override
  String get inspectionNewInspection => 'نیا معائنہ';

  @override
  String get inspectionConditionLabel => 'حالت';

  @override
  String get inspectionPressureLabel => 'دباؤ (پی ایس آئی)';

  @override
  String get inspectionPressureHint => 'مثال: 110';

  @override
  String get inspectionTreadLabel => 'ٹریڈ کی گہرائی (ملی میٹر)';

  @override
  String get inspectionTreadHint => 'مثال: 8.5';

  @override
  String get inspectionSerialLabel => 'ٹائر کا سیریل نمبر';

  @override
  String get inspectionPhotoLabel => 'تصویر';

  @override
  String get inspectionPhotoNone => 'کوئی تصویر نہیں لی گئی';

  @override
  String get inspectionPhotoCamera => 'کیمرہ';

  @override
  String get inspectionPhotoGallery => 'گیلری';

  @override
  String get inspectionNotesLabel => 'نوٹس';

  @override
  String get inspectionSignatureSavedLabel => 'دستخط محفوظ ہو گئے';

  @override
  String get inspectionSignatureRedraw => 'نئے دستخط بنائیں';

  @override
  String get inspectionDetailTitle => 'معائنہ';

  @override
  String get inspectionDetailLoadErrorMessage =>
      'یہ معائنہ لوڈ نہیں ہو سکا۔ اپنا کنکشن چیک کریں اور دوبارہ کوشش کریں۔';

  @override
  String get inspectionNotFoundTitle => 'معائنہ نہیں ملا';

  @override
  String get inspectionNotFoundMessage =>
      'یہ معائنہ اس ڈیوائس پر یا سرور پر نہیں مل سکا۔';

  @override
  String get inspectionStatusUnknown => 'نامعلوم';

  @override
  String get inspectionInspectorUnknown => 'معائنہ کار کا نام ریکارڈ نہیں ہوا';

  @override
  String get inspectionSignatureMissing => 'کوئی دستخط ریکارڈ نہیں';

  @override
  String get inspectionGpsSectionTitle => 'مقام';

  @override
  String inspectionGpsCoordinates(String lat, String lng) {
    return '$lat، $lng';
  }

  @override
  String get inspectionQueueFailedLabel => 'مطابقت پذیری ناکام ہوئی';

  @override
  String get inspectionQueuePendingLabel => 'مطابقت پذیری کا انتظار';

  @override
  String get inspectionRetrySyncButton => 'دوبارہ کوشش کریں';

  @override
  String get inspectionStatusSynced => 'مطابقت پذیر ہو گیا';

  @override
  String get inspectionHistoryTitle => 'میرے معائنے';

  @override
  String get inspectionHistoryQueueReadErrorMessage =>
      'اس ڈیوائس سے قطار میں موجود کچھ معائنے پڑھے نہیں جا سکے۔ وہ ضائع نہیں ہوئے—تھوڑی دیر بعد دوبارہ کوشش کریں۔';

  @override
  String get inspectionHistoryLoadErrorMessage =>
      'آپ کے معائنے لوڈ نہیں ہو سکے۔ دوبارہ کوشش کے لیے نیچے کھینچیں۔';

  @override
  String get inspectionHistoryEmptyTitle => 'ابھی تک کوئی معائنہ نہیں';

  @override
  String get inspectionHistoryEmptyMessage =>
      'آپ کے شروع یا جمع کروائے گئے معائنے یہاں دکھائی دیں گے۔';

  @override
  String get inspectionHistoryInProgressSection => 'جاری ہے';

  @override
  String get inspectionHistorySubmittedSection => 'جمع کروا دیا گیا';

  @override
  String get checklistAddPhotoTitle => 'تصویر شامل کریں';

  @override
  String get checklistPhotoSourceCamera => 'تصویر کھینچیں';

  @override
  String get checklistPhotoSourceGallery => 'گیلری سے منتخب کریں';

  @override
  String get checklistNoteRequiredLabel => 'ریمارک (لازمی)';

  @override
  String get checklistNoteLabel => 'ریمارک';

  @override
  String get checklistYes => 'ہاں';

  @override
  String get checklistNo => 'نہیں';

  @override
  String get checklistSignatureSavedLabel => 'دستخط محفوظ ہو گئے';

  @override
  String get checklistSignatureRedraw => 'نیا دستخط بنائیں';

  @override
  String get checklistsHomeTitle => 'چیک لسٹیں';

  @override
  String get checklistWorkspaceLoadingMessage =>
      'آپ کا ورک اسپیس ابھی لوڈ ہو رہا ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔';

  @override
  String get checklistsLoadErrorMessage =>
      'چیک لسٹس لوڈ نہیں ہو سکیں۔ دوبارہ کوشش کے لیے نیچے کھینچیں۔';

  @override
  String get checklistsLibraryTitle => 'معائنہ لائبریری';

  @override
  String get checklistsLibrarySubtitle =>
      'اثاثے کے لیے درست ورک فلو منتخب کریں';

  @override
  String get checklistsAssetSearchHint =>
      'QR اسکین کریں یا اثاثہ نمبر درج کریں';

  @override
  String get checklistsLanguageStorageHint =>
      'جوابات تمام زبانوں میں یکساں طور پر محفوظ ہوتے ہیں';

  @override
  String get checklistsRequiredForAsset => 'اس اثاثے کے لیے درکار';

  @override
  String get checklistsGeneralLibraryTitle => 'عام چیک لسٹ لائبریری';

  @override
  String get checklistsGeneralLibrarySubtitle =>
      'حفاظت، شفٹ، آلات اور دھلائی کی چیک لسٹیں';

  @override
  String get checklistsTyreInspectionTitle => 'ٹائر معائنہ';

  @override
  String get checklistsTyreInspectionSubtitle =>
      'ایکسل/اندرونی/بیرونی ٹائر کا مخصوص ورک فلو';

  @override
  String checklistsAssetHistoryTitle(String assetNo) {
    return '$assetNo کے لیے چیک لسٹ کی تاریخ';
  }

  @override
  String get checklistsMasterDataVerified => 'ماسٹر ڈیٹا تصدیق شدہ';

  @override
  String checklistsAvailableCount(int count) {
    return '$count دستیاب';
  }

  @override
  String checklistItemCount(int count) {
    return '$count آئٹمز';
  }

  @override
  String checklistPositionCount(int count) {
    return '$count پوزیشنز';
  }

  @override
  String get checklistPhotosOnFailure => 'ناکام آئٹمز کے لیے تصاویر درکار ہیں';

  @override
  String get checklistStartAction => 'شروع کریں';

  @override
  String get checklistResumeAction => 'دوبارہ شروع کریں';

  @override
  String get checklistsHistoryAction => 'میری چیک لسٹ کی تاریخ';

  @override
  String get checklistsEmptyTitle => 'ابھی بھرنے کے لیے کچھ نہیں';

  @override
  String get checklistsEmptyMessage =>
      'اس وقت آپ کے لیے کوئی چیک لسٹ، اسائنمنٹ یا نامکمل شیٹ دستیاب نہیں ہے۔';

  @override
  String get checklistsUnfinishedSection => 'نامکمل کام';

  @override
  String get checklistsAssignmentsSection => 'واجب الادا اسائنمنٹس';

  @override
  String get checklistsAvailableSection => 'دستیاب چیک لسٹیں';

  @override
  String get checklistNoAssetLabel => 'ابھی تک کوئی اثاثہ منتخب نہیں کیا گیا';

  @override
  String checklistResumeProgress(int filled, int total) {
    return '$total میں سے $filled کا جواب دیا گیا';
  }

  @override
  String get checklistHistoryTitle => 'چیک لسٹ کی تاریخ';

  @override
  String get myPlansNavTitle => 'میرے شیڈول شدہ معائنے';

  @override
  String get myPlansSubtitle => 'آپ کو تفویض کیے گئے معائنے';

  @override
  String get myPlansLoadingMessage => 'آپ کے منصوبے لوڈ ہو رہے ہیں';

  @override
  String get myPlansEmptyTitle => 'آپ کے لیے کوئی معائنہ شیڈول نہیں';

  @override
  String get myPlansEmptyMessage =>
      'جب سپروائزر آپ کے لیے معائنہ شیڈول کرے گا تو وہ یہاں نظر آئے گا۔ آپ منصوبے کے بغیر بھی کسی بھی وقت معائنہ شروع کر سکتے ہیں۔';

  @override
  String get myPlansTruncatedNotice =>
      'یہ فہرست مکمل نہیں ہو سکتی۔ سرور نے ایک بار میں جتنے منصوبے بھیج سکتا تھا بھیج دیے، اس لیے کچھ رہ سکتے ہیں۔ اسے اپنا مکمل کام سمجھنے سے پہلے اپنے سپروائزر سے تصدیق کریں۔';

  @override
  String get myPlansStateMissed => 'رہ گیا';

  @override
  String get myPlansStateDue => 'ابھی واجب';

  @override
  String get myPlansStateStarted => 'شروع ہو چکا';

  @override
  String get myPlansStateUpcoming => 'آنے والا';

  @override
  String get myPlansStateDone => 'مکمل';

  @override
  String get myPlansStateCancelled => 'منسوخ';

  @override
  String get myPlansStateUnknown => 'ناقابلِ شناخت';

  @override
  String get myPlansNoLocation => 'کوئی مقام درج نہیں';

  @override
  String myPlansCoveredBy(String name) {
    return '$name نے مکمل کیا';
  }

  @override
  String get myPlansCompleted => 'مکمل';

  @override
  String myPlansCompletedOn(String date) {
    return '$date کو مکمل ہوا';
  }

  @override
  String myPlansOverdue(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days دن تاخیر - یہ اب بھی کرنا ہے',
      one: 'ایک دن تاخیر - یہ اب بھی کرنا ہے',
    );
    return '$_temp0';
  }

  @override
  String get checklistHistoryLoadErrorMessage =>
      'آپ کی چیک لسٹ ہسٹری لوڈ نہیں ہو سکی۔ دوبارہ کوشش کے لیے نیچے کھینچیں۔';

  @override
  String get checklistHistorySearchHint =>
      'دستاویز، ٹیمپلیٹ، اثاثہ یا سائٹ کے ذریعے تلاش کریں';

  @override
  String get checklistHistoryFilterAll => 'تمام';

  @override
  String get checklistHistoryFilterWaiting => 'انتظار میں';

  @override
  String get checklistHistoryFilterClosed => 'بند';

  @override
  String get checklistHistoryFilterSentBack => 'واپس بھیجا گیا';

  @override
  String get checklistHistoryEmptyTitle => 'ابھی تک کوئی چیک لسٹ کی تاریخ نہیں';

  @override
  String get checklistHistoryEmptyMessage =>
      'جو شیٹس آپ بھریں گے وہ یہاں ظاہر ہوں گی، چاہے وہ ابھی سرور کی طرف روانہ ہو رہی ہوں یا پہلے سے تصدیق شدہ ہوں۔';

  @override
  String get checklistHistoryQueuedSection => 'ابھی تک اسی ڈیوائس پر';

  @override
  String get checklistHistoryCompletedSection => 'تصدیق شدہ';

  @override
  String get checklistQueueFailedLabel => 'توجہ درکار ہے';

  @override
  String get checklistQueuePendingLabel => 'ہم وقت سازی کا منتظر';

  @override
  String get checklistHistoryStatusClosed => 'بند';

  @override
  String get checklistHistoryStatusSentBack => 'واپس بھیجا گیا';

  @override
  String get checklistHistoryStatusWaiting => 'منظوری کا منتظر';

  @override
  String get checklistHistoryStatusNoApproval => 'منظوری کی ضرورت نہیں';

  @override
  String get checklistFillLoadingTitle => 'چیک لسٹ';

  @override
  String get checklistFillNotFoundMessage =>
      'یہ چیک لسٹ نہیں مل سکی۔ ممکن ہے اسے غیر شائع کر دیا گیا ہو۔';

  @override
  String get checklistFillSaveFailedMessage =>
      'یہ چیک لسٹ محفوظ نہیں ہو سکی۔ یہ ضائع نہیں ہوئی—دوبارہ کوشش کریں۔';

  @override
  String get checklistSubmittedTitle => 'چیک لسٹ جمع کرا دی گئی';

  @override
  String get checklistSubmittedMessage =>
      'آپ کی شیٹ محفوظ ہو گئی ہے۔ یہ ڈیوائس آن لائن ہوتے ہی سرور تک پہنچ جائے گی۔';

  @override
  String get checklistLastSubmissionKnown =>
      'اس مشین کی اس چیک لسٹ کے لیے پہلے سے ایک جمع کرائی گئی شیٹ موجود ہے۔';

  @override
  String checklistLastSubmissionDaysAgo(int daysAgo) {
    return 'اس مشین کا اس چیک لسٹ پر آخری معائنہ $daysAgo دن پہلے ہوا تھا۔';
  }

  @override
  String get checklistPrimarySignatureLabel => 'منظوری کے دستخط';

  @override
  String get checklistSubmitAction => 'چیک لسٹ جمع کرائیں';

  @override
  String get checklistSiteLabel => 'سائٹ';

  @override
  String get checklistPrintedNameLabel => 'لکھا ہوا نام';

  @override
  String get checklistPrintedNamePlaceholder => 'اپنا پورا نام لکھیں';

  @override
  String checklistGateFieldErrors(int count) {
    return '$count فیلڈز پر توجہ درکار ہے';
  }

  @override
  String checklistGateSignatureErrors(int count) {
    return '$count دستخط درکار ہیں';
  }

  @override
  String checklistGateMissingNotes(int count) {
    return '$count آئٹمز کو نشان کی وضاحت کے لیے ریمارک درکار ہے';
  }

  @override
  String checklistGateUnsatisfiedGroups(int count) {
    return '$count ریڈنگ گروپس کو کم از کم ایک ویلیو درکار ہے';
  }

  @override
  String get checklistGatePrimarySignature =>
      'اس شیٹ کو جمع کرانے کے لیے دستخط درکار ہیں';

  @override
  String get inspectionApprovalsTitle => 'معائنہ کی منظوریاں';

  @override
  String inspectionApprovalsAwaitingCount(int count) {
    return '$count منظوری کے منتظر ہیں';
  }

  @override
  String get inspectionApprovalsEmptyTitle => 'منظوری کا منتظر کچھ نہیں';

  @override
  String get inspectionApprovalsEmptyMessage =>
      'تمام معائنوں کا جائزہ لیا جا چکا ہے۔ دوبارہ چیک کرنے کے لیے نیچے کھینچیں۔';

  @override
  String get inspectionApprovalsLoadErrorMessage =>
      'منظوریاں لوڈ نہیں ہو سکیں۔ اپنا کنکشن چیک کریں اور دوبارہ کوشش کریں۔';

  @override
  String get inspectionApprovalsPendingBadge => 'زیر التوا';

  @override
  String get inspectionApprovalsApprovedTab => 'منظور شدہ';

  @override
  String get inspectionApprovalsReturnedTab => 'واپس';

  @override
  String get dateGroupToday => 'آج';

  @override
  String get dateGroupTomorrow => 'آنے والا کل';

  @override
  String get dateGroupYesterday => 'کل';

  @override
  String get inspectionApprovalFallbackTitle => 'معائنہ';

  @override
  String get inspectionApprovalReviewTitle => 'منظوری';

  @override
  String get inspectionApprovalLoadErrorMessage =>
      'یہ معائنہ لوڈ نہیں ہو سکا۔ اپنا کنکشن چیک کریں اور دوبارہ کوشش کریں۔';

  @override
  String get inspectionApprovalNotFoundMessage =>
      'یہ معائنہ نہیں مل سکا۔ ہو سکتا ہے اس کا جائزہ لیا جا چکا ہو یا اسے ہٹا دیا گیا ہو۔';

  @override
  String inspectionApprovalTyreConditionsTitle(int count) {
    return 'ٹائر کی حالت ($count)';
  }

  @override
  String get inspectionApprovalNoTyreConditions =>
      'ٹائر کی کوئی حالت ریکارڈ نہیں کی گئی۔';

  @override
  String get inspectionApprovalYourDecisionTitle => 'آپ کا فیصلہ';

  @override
  String get inspectionApprovalDecisionTitle => 'فیصلہ';

  @override
  String get inspectionApprovalDecisionApproved => 'منظور شدہ';

  @override
  String get inspectionApprovalDecisionReturned => 'فیلڈ کو واپس بھیج دیا گیا';

  @override
  String inspectionApprovalApprovedBy(String name) {
    return '$name کی جانب سے منظور شدہ';
  }

  @override
  String inspectionApprovalReturnedBy(String name) {
    return '$name کی جانب سے واپس بھیجا گیا';
  }

  @override
  String get inspectionApprovalApproverSignatureLabel => 'منظور کنندہ کے دستخط';

  @override
  String inspectionApprovalSigningAs(String name) {
    return '$name کے طور پر دستخط ہو رہے ہیں';
  }

  @override
  String get inspectionApprovalNoteLabel => 'نوٹ (واپسی کے لیے درکار)';

  @override
  String get inspectionApprovalNoteHint =>
      'معائنہ کار کو واپس بھیجنے کی صورت میں وجہ';

  @override
  String get inspectionApprovalApproveButton => 'منظور کریں';

  @override
  String get inspectionApprovalReturnButton => 'واپس بھیجیں';

  @override
  String get inspectionApprovalSignatureRequiredTitle => 'دستخط درکار ہیں';

  @override
  String get inspectionApprovalSignatureRequiredMessage =>
      'اس معائنے کی منظوری کے لیے منظور کنندہ کے خانے میں دستخط کریں۔';

  @override
  String get inspectionApprovalReasonRequiredTitle => 'وجہ درکار ہے';

  @override
  String get inspectionApprovalReasonRequiredMessage =>
      'ایک مختصر نوٹ شامل کریں تاکہ معائنہ کار کو معلوم ہو کہ کیا درست کرنا ہے۔';

  @override
  String get inspectionApprovalApprovedOutcomeTitle =>
      'معائنہ منظور کر لیا گیا';

  @override
  String get inspectionApprovalReturnedOutcomeTitle =>
      'معائنہ واپس بھیج دیا گیا';

  @override
  String get inspectionApprovalApprovedOutcomeMessage =>
      'معائنہ منظور کر لیا گیا ہے۔ آپ اسے یہاں دیکھ سکتے ہیں، یا فہرست پر واپس جا سکتے ہیں۔';

  @override
  String get inspectionApprovalReturnedOutcomeMessage =>
      'معائنہ فیلڈ کو واپس بھیج دیا گیا ہے۔ آپ اسے یہاں دیکھ سکتے ہیں، یا فہرست پر واپس جا سکتے ہیں۔';

  @override
  String get inspectionApprovalStayHereAction => 'یہیں رہیں';

  @override
  String get inspectionApprovalBackToListAction => 'فہرست پر واپس جائیں';

  @override
  String get inspectionApprovalSaveFailedTitle => 'فیصلہ محفوظ نہیں ہو سکا';

  @override
  String get inspectionApprovalDecideGenericError =>
      'براہ کرم دوبارہ کوشش کریں۔';

  @override
  String get inspectionApprovalSignatureSavedLabel => 'دستخط محفوظ ہو گئے';

  @override
  String get inspectionApprovalSignatureRedraw => 'نئے دستخط بنائیں';

  @override
  String get checklistApprovalsTitle => 'چیک لسٹ کی منظوریاں';

  @override
  String checklistApprovalsAwaitingCount(int count) {
    return '$count دستخط کے منتظر';
  }

  @override
  String get checklistApprovalsLoadErrorMessage =>
      'منظوریاں لوڈ نہیں ہو سکیں۔ اپنا کنکشن چیک کریں اور دوبارہ کوشش کریں۔';

  @override
  String get checklistApprovalsEmptyTitle => 'منظوری کے منتظر کوئی چیز نہیں';

  @override
  String get checklistApprovalsEmptyMessage =>
      'تمام چیک لسٹس کا جائزہ لیا جا چکا ہے۔ دوبارہ چیک کرنے کے لیے نیچے کھینچیں۔';

  @override
  String get checklistApprovalsEmptyMineTitle =>
      'ابھی آپ کی کسی چیز کی ضرورت نہیں';

  @override
  String get checklistApprovalsEmptyMineMessage =>
      'اس قطار میں فی الحال کوئی چیک لسٹ آپ کے دستخط کی منتظر نہیں۔';

  @override
  String get checklistApprovalsFilterAll => 'تمام';

  @override
  String get checklistApprovalsFilterMine => 'مجھے درکار ہیں';

  @override
  String get checklistApprovalsYourTurn => 'آپ کی باری';

  @override
  String get checklistApprovalFallbackTitle => 'چیک لسٹ';

  @override
  String checklistApprovalsBlockedTitle(int count) {
    return '$count فیصلہ(جات) پر توجہ درکار ہے';
  }

  @override
  String get checklistApprovalsBlockedMessage =>
      'یہ فیصلے بھیجے نہیں جا سکے اور خودکار طور پر دوبارہ کوشش نہیں کی جائے گی۔ نیچے دوبارہ کوشش کریں، یا دوبارہ فیصلہ کرنے کے لیے چیک لسٹ کھولیں۔';

  @override
  String get checklistApprovalsStatusClosed => 'بند';

  @override
  String get checklistApprovalsStatusSentBack => 'واپس بھیج دی گئی';

  @override
  String get checklistApprovalsStatusWaitingAreaManager =>
      'ایریا مینیجر کی منتظر';

  @override
  String get checklistApprovalsStatusWaitingSupervisor => 'سپروائزر کی منتظر';

  @override
  String get checklistApprovalsStatusWaitingApproval => 'منظوری کی منتظر';

  @override
  String get checklistApprovalsStatusNoApproval => 'منظوری کی ضرورت نہیں';

  @override
  String get checklistApprovalReviewTitle => 'چیک لسٹ کی منظوری';

  @override
  String get checklistApprovalLoadErrorMessage =>
      'یہ چیک لسٹ لوڈ نہیں ہو سکی۔ اپنا کنکشن چیک کریں اور دوبارہ کوشش کریں۔';

  @override
  String get checklistApprovalNotFoundTitle => 'چیک لسٹ نہیں ملی';

  @override
  String get checklistApprovalNotFoundMessage =>
      'یہ چیک لسٹ نہیں مل سکی۔ ہو سکتا ہے اس کا جائزہ لیا جا چکا ہو یا اسے ہٹا دیا گیا ہو۔';

  @override
  String get checklistApprovalSignOffsTitle => 'دستخط';

  @override
  String get checklistApprovalResponsesTitle => 'جوابات';

  @override
  String get checklistApprovalNoResponses => 'کوئی جواب درج نہیں کیا گیا۔';

  @override
  String get checklistApprovalStageFilledBy => 'پُر کردہ بذریعہ';

  @override
  String get checklistApprovalStageSupervisor => 'سپروائزر کے دستخط';

  @override
  String get checklistApprovalStageAreaManager => 'ایریا مینیجر کی منظوری';

  @override
  String get checklistApprovalStageApproval => 'منظوری';

  @override
  String get checklistApprovalNotSignedYet => 'ابھی تک دستخط نہیں ہوئے';

  @override
  String get checklistApprovalYourDecisionTitle => 'آپ کا فیصلہ';

  @override
  String get checklistApprovalSupervisorSignatureLabel => 'سپروائزر کے دستخط';

  @override
  String get checklistApprovalAreaManagerSignatureLabel =>
      'ایریا مینیجر کے دستخط';

  @override
  String get checklistApprovalYourNameLabel => 'آپ کا نام';

  @override
  String get checklistApprovalYourNamePlaceholder => 'اپنا نام لکھیں';

  @override
  String get checklistApprovalNoteLabel => 'نوٹ (واپس بھیجنے کے لیے لازمی)';

  @override
  String get checklistApprovalNoteHint =>
      'اگر یہ واپس بھیج رہے ہیں تو وجہ بتائیں';

  @override
  String get checklistApprovalReturnButton => 'واپس بھیجیں';

  @override
  String get checklistApprovalSignOffButton => 'دستخط کریں';

  @override
  String get checklistApprovalApproveAndCloseButton =>
      'منظور کریں اور بند کریں';

  @override
  String get checklistApprovalRequirementTitle => 'دستخط نہیں کیے جا سکتے';

  @override
  String get checklistApprovalCannotCloseTitle =>
      'یہ شیٹ ابھی بند نہیں کی جا سکتی';

  @override
  String get checklistApprovalCannotCloseMessage =>
      'کچھ آئٹمز اب بھی خرابی کے طور پر درج ہیں۔ انہیں درست کروانے کے لیے شیٹ واپس بھیجیں، پھر اسے بند کریں۔';

  @override
  String get checklistApprovalReasonRequiredTitle => 'وجہ درکار ہے';

  @override
  String get checklistApprovalReasonRequiredMessage =>
      'ایک مختصر نوٹ شامل کریں تاکہ اسے پُر کرنے والا شخص جان سکے کہ کیا درست کرنا ہے۔';

  @override
  String get checklistApprovalNameRequiredMessage =>
      'اس پر دستخط کرنے کے لیے اپنا نام درج کریں۔';

  @override
  String get checklistApprovalSignatureRequiredMessage =>
      'اس پر دستخط کرنے کے لیے اوپر دیے گئے خانے میں دستخط کریں۔';

  @override
  String get checklistApprovalNothingToDecide =>
      'اس چیک لسٹ میں فیصلہ کرنے کے لیے کچھ باقی نہیں ہے۔';

  @override
  String checklistApprovalNotYourRung(String status) {
    return 'اس بارے میں فیصلہ کرنا آپ کے دائرہ اختیار میں نہیں ہے۔ $status';
  }

  @override
  String get checklistApprovalSaveFailedTitle => 'فیصلہ محفوظ نہیں ہو سکا';

  @override
  String get checklistApprovalDecideGenericError =>
      'براہ کرم دوبارہ کوشش کریں۔';

  @override
  String get checklistApprovalSentBackTitle => 'چیک لسٹ واپس بھیج دی گئی';

  @override
  String get checklistApprovalSentBackMessage =>
      'یہ چیک لسٹ فیلڈ کو واپس بھیج دی گئی ہے۔ آپ اسے یہاں دیکھ سکتے ہیں، یا فہرست پر واپس جا سکتے ہیں۔';

  @override
  String get checklistApprovalSignedOffTitle => 'دستخط ہو گئے';

  @override
  String get checklistApprovalSignedOffMessage =>
      'آپ کے دستخط درج کر لیے گئے ہیں۔ یہ چیک لسٹ اب ایریا مینیجر کی منتظر ہے۔ آپ اسے یہاں دیکھ سکتے ہیں، یا فہرست پر واپس جا سکتے ہیں۔';

  @override
  String get checklistApprovalApprovedTitle => 'چیک لسٹ منظور ہو گئی';

  @override
  String get checklistApprovalApprovedMessage =>
      'یہ چیک لسٹ منظور کر کے بند کر دی گئی ہے۔ آپ اسے یہاں دیکھ سکتے ہیں، یا فہرست پر واپس جا سکتے ہیں۔';

  @override
  String get checklistApprovalStayHereAction => 'یہیں رہیں';

  @override
  String get checklistApprovalBackToListAction => 'فہرست پر واپس جائیں';

  @override
  String get checklistApprovalQueuedTitle => 'محفوظ ہو گیا';

  @override
  String get checklistApprovalQueuedOffline =>
      'آپ کا فیصلہ اس آلے پر محفوظ ہے اور آن لائن ہونے پر بھیج دیا جائے گا۔';

  @override
  String checklistApprovalScoreLine(int pct, String status) {
    return 'اسکور: $pct% ($status)';
  }

  @override
  String get checklistApprovalScorePassed => 'کامیاب';

  @override
  String get checklistApprovalScoreFailed => 'ناکام';

  @override
  String get checklistApprovalSignatureSavedLabel => 'دستخط محفوظ ہو گئے';

  @override
  String get checklistApprovalSignatureRedraw => 'نیا دستخط بنائیں';

  @override
  String get meterLogNavTitle => 'میٹر ریڈنگ ریکارڈ کریں';

  @override
  String get meterLogWorkspaceLoadingMessage =>
      'آپ کا ورک اسپیس ابھی لوڈ ہو رہا ہے۔ براہ کرم تھوڑی دیر بعد دوبارہ کوشش کریں۔';

  @override
  String get meterLogAssetLabel => 'اثاثہ';

  @override
  String get meterLogAssetHint => 'اثاثے کا نمبر ٹائپ کریں یا اسکین کریں';

  @override
  String get meterLogSiteLabel => 'سائٹ';

  @override
  String get meterLogSiteHint => 'یہ ریڈنگ کہاں لی گئی';

  @override
  String get meterLogSiteHelp =>
      'یہ فلیٹ ریکارڈ سے خود بخود بھر دیا جاتا ہے۔ اگر یہ ریڈنگ کسی مختلف سائٹ سے ہے تو اسے تبدیل کریں۔';

  @override
  String get meterLogLastReadingChecking => 'آخری ریڈنگ چیک کی جا رہی ہے...';

  @override
  String get meterLogLastReadingUnknown =>
      'اس اثاثے کے لیے کوئی پچھلی ریڈنگ درج نہیں ہے۔';

  @override
  String meterLogLastReadingKnown(String km, String date) {
    return 'آخری ریڈنگ: $km کلومیٹر بتاریخ $date';
  }

  @override
  String get meterLogOdometerLabel => 'اوڈومیٹر (کلومیٹر)';

  @override
  String get meterLogOdometerHint => 'ریڈنگ درج کریں';

  @override
  String get meterLogEngineHoursLabel => 'انجن کے اوقات';

  @override
  String get meterLogEngineHoursHint => 'اختیاری';

  @override
  String get meterLogEngineHoursHelpWithHours =>
      'اگلے مرحلے میں آور میٹر کی تصویر مانگی جائے گی۔';

  @override
  String get meterLogEngineHoursHelpWithoutHours =>
      'اگر گاڑی میں آور میٹر نہیں ہے تو اسے خالی چھوڑ دیں۔';

  @override
  String get meterLogNotesLabel => 'نوٹس';

  @override
  String get meterLogNotesHint => 'کچھ بھی جو درج کرنے کے قابل ہو';

  @override
  String get meterLogSignatureLabel => 'دستخط';

  @override
  String get meterLogSignatureSavedLabel => 'دستخط محفوظ ہو گئے';

  @override
  String get meterLogSignatureRedraw => 'نیا دستخط بنائیں';

  @override
  String get meterLogContinueAction => 'جائزہ لیں اور محفوظ کریں';

  @override
  String get meterLogAssetRequiredTitle => 'اثاثہ درکار ہے';

  @override
  String get meterLogAssetRequiredMessage =>
      'آگے بڑھنے سے پہلے اثاثہ درج کریں۔';

  @override
  String get meterLogReadingRequiredTitle => 'ریڈنگ درکار ہے';

  @override
  String get meterLogReadingRequiredMessage =>
      'آگے بڑھنے سے پہلے اوڈومیٹر ریڈنگ درج کریں۔';

  @override
  String get meterLogInvalidReadingTitle => 'یہ ریڈنگ درست معلوم نہیں ہوتی';

  @override
  String get meterLogInvalidReadingMessage =>
      'اوڈومیٹر ریڈنگ منفی نمبر نہیں ہو سکتی۔';

  @override
  String get meterLogBelowLastTitle => 'یہ ریڈنگ پچھلی ریڈنگ سے کم ہے';

  @override
  String meterLogBelowLastMessage(String km) {
    return 'اس اثاثے کے لیے آخری درج شدہ ریڈنگ $km کلومیٹر تھی۔ یہ ریڈنگ محفوظ کرنے سے یہ انتظامی جائزے کے لیے نشان زد ہو جائے گی۔';
  }

  @override
  String get meterLogRecheckAction => 'دوبارہ چیک کریں';

  @override
  String get meterLogSaveAndFlagAction => 'پھر بھی محفوظ کریں';

  @override
  String get meterLogBigJumpTitle => 'یہ ایک بڑا فرق ہے';

  @override
  String meterLogBigJumpMessage(String km) {
    return 'یہ پچھلی ریڈنگ سے $km کلومیٹر زیادہ ہے۔';
  }

  @override
  String get meterLogLogAnywayAction => 'پھر بھی درج کریں';

  @override
  String get meterLogReviewTitle => 'ریڈنگ کی تصدیق کریں';

  @override
  String get meterLogPhotographGaugeLabel => 'گیج کی تصویر لیں';

  @override
  String get meterLogPhotoCamera => 'کیمرہ';

  @override
  String get meterLogPhotoGallery => 'گیلری';

  @override
  String get meterLogPhotoNone => 'کوئی تصویر نہیں لی گئی';

  @override
  String get meterLogPhotoRequiredTitle => 'تصویر درکار ہے';

  @override
  String get meterLogPhotoRequiredMessage =>
      'محفوظ کرنے سے پہلے اوڈومیٹر کی تصویر ضروری ہے۔';

  @override
  String get meterLogSaveReadingAction => 'ریڈنگ محفوظ کریں';

  @override
  String get meterLogFlaggedNote =>
      'یہ ریڈنگ پچھلی ریڈنگ سے کم ہے اور اسے انتظامی جائزے کے لیے نشان زد کیا جائے گا۔';

  @override
  String get meterLogSavedMessage =>
      'ریڈنگ محفوظ ہو گئی۔ یہ خودکار طور پر مطابقت پذیر ہو جائے گی۔';

  @override
  String get meterLogSavedAndFlaggedMessage =>
      'ریڈنگ محفوظ ہو گئی اور چونکہ یہ پچھلی ریڈنگ سے کم ہے اسے انتظامی جائزے کے لیے نشان زد کر دیا گیا ہے۔';

  @override
  String get meterLogTryAgainFallback => 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔';

  @override
  String get meterLogRecentTitle => 'حالیہ ریڈنگز';

  @override
  String get meterLogRecentEmptyMessage =>
      'ابھی تک کوئی ریڈنگ درج نہیں کی گئی۔';

  @override
  String get meterLogRecentLoadErrorMessage => 'حالیہ ریڈنگز لوڈ نہیں ہو سکیں۔';

  @override
  String meterLogRecentKmValue(String km) {
    return '$km کلومیٹر';
  }

  @override
  String get washNavTitle => 'گاڑی کی دھلائی درج کریں';

  @override
  String get washWorkspaceLoadingMessage =>
      'آپ کا ورک اسپیس ابھی لوڈ ہو رہا ہے۔ براہ کرم تھوڑی دیر بعد دوبارہ کوشش کریں۔';

  @override
  String get washDueTitle => 'دھلائی کے لیے واجب';

  @override
  String get washDueNone => 'فی الحال کوئی گاڑی دھلائی کے لیے واجب نہیں ہے۔';

  @override
  String get washDueToday => 'آج واجب ہے';

  @override
  String washDueOverdue(int days) {
    return '$days دن سے تاخیر';
  }

  @override
  String get washDueLoadErrorMessage =>
      'اس وقت واجب الادا فہرست چیک نہیں کی جا سکی۔';

  @override
  String get washAssetLabel => 'اثاثہ';

  @override
  String get washAssetHint => 'اثاثے کا نمبر ٹائپ کریں یا اسکین کریں';

  @override
  String washMasterFleetNumber(String fleetNo) {
    return 'فلیٹ $fleetNo';
  }

  @override
  String get washSiteLabel => 'سائٹ';

  @override
  String get washSiteHint => 'گاڑی کہاں دھوئی جا رہی ہے';

  @override
  String get washSiteHelp =>
      'یہ فلیٹ ریکارڈ سے خود بخود بھر دیا جاتا ہے۔ اگر یہ دھلائی کسی مختلف سائٹ پر ہوئی ہے تو اسے تبدیل کریں۔';

  @override
  String get washDateLabel => 'تاریخ';

  @override
  String washDateTodayLine(String date) {
    return 'آج · $date';
  }

  @override
  String get washTypeLabel => 'دھلائی کی قسم';

  @override
  String get washTypeExterior => 'بیرونی';

  @override
  String get washTypeInterior => 'اندرونی';

  @override
  String get washTypeFull => 'مکمل';

  @override
  String get washTypeEngineBay => 'انجن بے';

  @override
  String get washTypeUndercarriage => 'نچلا حصہ';

  @override
  String get washTypeSteam => 'بھاپ سے';

  @override
  String get washTypeWaterless => 'بغیر پانی کے';

  @override
  String get washStatusLabel => 'حیثیت';

  @override
  String get washStatusInProgress => 'جاری ہے';

  @override
  String get washStatusCompleted => 'مکمل';

  @override
  String get washPhotosLabel => 'تصاویر';

  @override
  String get washAddPhoto => 'تصویر شامل کریں';

  @override
  String get washPhotoCamera => 'کیمرہ';

  @override
  String get washPhotoGallery => 'گیلری';

  @override
  String get washDetailsLabel => 'تفصیلات';

  @override
  String get washOperatorLabel => 'آپریٹر کا نام';

  @override
  String get washOperatorHint => 'گاڑی کس نے دھوئی';

  @override
  String get washBayLabel => 'بے';

  @override
  String get washBayHint => 'اختیاری';

  @override
  String get washOdometerLabel => 'اوڈومیٹر (کلومیٹر)';

  @override
  String get washOdometerHint => 'اختیاری';

  @override
  String get washNotesLabel => 'نوٹس';

  @override
  String get washNotesHint => 'کچھ بھی جو درج کرنے کے قابل ہو';

  @override
  String get washTypeRequiredTitle => 'دھلائی کی قسم درکار ہے';

  @override
  String get washTypeRequiredMessage =>
      'محفوظ کرنے سے پہلے دھلائی کی قسم منتخب کریں۔';

  @override
  String get washAssetRequiredTitle => 'اثاثہ درکار ہے';

  @override
  String get washAssetRequiredMessage => 'محفوظ کرنے سے پہلے اثاثہ درج کریں۔';

  @override
  String get washSaveAction => 'دھلائی محفوظ کریں';

  @override
  String get washSavedMessage =>
      'دھلائی درج ہو گئی۔ یہ خودکار طور پر مطابقت پذیر ہو جائے گی۔';

  @override
  String get washSaveFailedTitle => 'دھلائی محفوظ نہیں ہو سکی';

  @override
  String get washTryAgainFallback => 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔';

  @override
  String get washRecentTitle => 'حالیہ دھلائیاں';

  @override
  String get washRecentEmptyMessage => 'ابھی تک کوئی دھلائی درج نہیں کی گئی۔';

  @override
  String get washRecentLoadErrorMessage => 'حالیہ دھلائیاں لوڈ نہیں ہو سکیں۔';

  @override
  String get homeNavTitle => 'ہوم';

  @override
  String get homeGreeting => 'خوش آمدید';

  @override
  String get homeGoodMorning => 'صبح بخیر،';

  @override
  String get homeGoodAfternoon => 'دوپہر بخیر،';

  @override
  String get homeGoodEvening => 'شام بخیر،';

  @override
  String get homeFallbackUser => 'ٹیم ممبر';

  @override
  String get homeSearchAssetsHint => 'اثاثہ، ٹائر یا کام تلاش کریں...';

  @override
  String get homeAttentionRequired => 'توجہ درکار';

  @override
  String get homeViewAll => 'سب دیکھیں';

  @override
  String get homeApprovalsMetric => 'منظوریاں';

  @override
  String get homeOverdueMetric => 'تاخیر شدہ';

  @override
  String get homeCriticalMetric => 'سنگین';

  @override
  String get homeTyreIssueDetected => 'ٹائر کا مسئلہ ملا';

  @override
  String get homeNoCriticalIssueTitle => 'کوئی سنگین ٹائر مسئلہ نہیں';

  @override
  String get homeNoCriticalIssueMessage =>
      'کوئی فعال سنگین ٹائر الرٹ نہیں ملا۔';

  @override
  String get homeReviewAction => 'جائزہ';

  @override
  String get homeMyWork => 'میرا کام';

  @override
  String get homeQuickActions => 'فوری اقدامات';

  @override
  String get homeInspectAction => 'معائنہ';

  @override
  String get homeAssetAction => 'اثاثہ';

  @override
  String get homeReportIssueAction => 'مسئلہ رپورٹ کریں';

  @override
  String get homeOpenAction => 'کھولیں';

  @override
  String get homeNoUrgentWorkTitle => 'کوئی فوری کام نہیں';

  @override
  String get homeNoUrgentWorkMessage =>
      'کوئی تاخیر شدہ یا اعلیٰ ترجیحی کام تفویض نہیں ہے۔';

  @override
  String get homeMoreAction => 'مزید';

  @override
  String get homeAlertsAction => 'الرٹس';

  @override
  String get homeMenuTooltip => 'خدمات کھولیں';

  @override
  String get homeNotificationsTooltip => 'ٹائر الرٹس کھولیں';

  @override
  String get homeSiteSelectorTooltip => 'موجودہ سائٹ دیکھیں';

  @override
  String get homeReportIssueSheetTitle => 'مسئلہ رپورٹ کریں';

  @override
  String get homeReportAccidentAction => 'حادثہ رپورٹ کریں';

  @override
  String get homeFieldSectionHeading => 'میدانی کام';

  @override
  String get homeFleetSectionHeading => 'فلیٹ';

  @override
  String get homeMaintenanceSectionHeading => 'دیکھ بھال';

  @override
  String get homeSyncStatLabel => 'مطابقت زیر التوا';

  @override
  String get homeSiteStatLabel => 'سائٹ';

  @override
  String get homeSiteStatUnavailable => 'کوئی سائٹ درج نہیں';

  @override
  String get homeFleetSizeStatLabel => 'فلیٹ کا حجم';

  @override
  String get homeStatLoadingCaption => 'جانچا جا رہا ہے';

  @override
  String get homeStatUnavailableCaption => 'جانچ نہیں ہو سکی';

  @override
  String get homeNoQuickActionsMessage =>
      'ابھی آپ کے لیے یہاں کچھ دستیاب نہیں ہے۔ اگر آپ کو کسی فیچر تک رسائی درکار ہو تو اپنے منتظم سے رابطہ کریں۔';

  @override
  String get workOrdersNavTitle => 'ورک آرڈرز';

  @override
  String workOrdersActiveCount(int count) {
    return '$count فعال';
  }

  @override
  String get workOrdersFilterActive => 'فعال';

  @override
  String get workOrdersFilterAll => 'تمام';

  @override
  String get workOrdersEmptyTitle => 'کوئی ورک آرڈر نہیں';

  @override
  String get workOrdersEmptyMessage =>
      'اس فلیٹ کے لیے درج کیے گئے ورک آرڈرز یہاں دکھائی دیں گے۔';

  @override
  String get workOrdersLoadErrorMessage => 'ورک آرڈرز ابھی لوڈ نہیں ہو سکے۔';

  @override
  String get workOrdersStatusOpenFallback => 'کھلا';

  @override
  String get workOrdersWorkTypeFallback => 'عمومی کام';

  @override
  String get workOrderNewTitle => 'نیا ورک آرڈر';

  @override
  String get workOrderAssetLabel => 'اثاثہ';

  @override
  String get workOrderAssetHint => 'مثال: TM514';

  @override
  String get workOrderAssetRequiredMessage =>
      'محفوظ کرنے سے پہلے اثاثہ درج کریں۔';

  @override
  String get workOrderWorkTypeLabel => 'کام کی قسم';

  @override
  String get workOrderPriorityLabel => 'ترجیح';

  @override
  String get workOrderDescriptionLabel => 'تفصیلات';

  @override
  String get workOrderDescriptionHint => 'کوئی بھی قابلِ ذکر بات';

  @override
  String get workOrderCreateAction => 'ورک آرڈر بنائیں';

  @override
  String get workOrderSavedMessage =>
      'ورک آرڈر درج ہو گیا۔ یہ خودکار طور پر مطابقت پذیر ہو جائے گا۔';

  @override
  String get workOrderSaveFailedMessage =>
      'محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔';

  @override
  String get workOrderWorkspaceLoadingMessage =>
      'آپ کا ورک اسپیس ابھی لوڈ ہو رہا ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔';

  @override
  String get workOrderWorkTypeTyreChange => 'ٹائر تبدیلی';

  @override
  String get workOrderWorkTypeRepair => 'مرمت';

  @override
  String get workOrderWorkTypeRotation => 'گردش';

  @override
  String get workOrderWorkTypeAlignment => 'الائنمنٹ';

  @override
  String get workOrderWorkTypeInspection => 'معائنہ';

  @override
  String get workOrderWorkTypeOther => 'دیگر';

  @override
  String get workOrderPriorityLow => 'کم';

  @override
  String get workOrderPriorityMedium => 'درمیانی';

  @override
  String get workOrderPriorityHigh => 'زیادہ';

  @override
  String get workOrderPriorityCritical => 'نازک';

  @override
  String get workOrderAdvanceToInProgress => 'جاری ہے';

  @override
  String get workOrderAdvanceToCompleted => 'مکمل';

  @override
  String get workOrderStatusQueuedMessage =>
      'حالت کی تازہ کاری محفوظ ہو گئی۔ یہ خودکار طور پر مطابقت پذیر ہو جائے گی۔';

  @override
  String get workOrderDetailTitle => 'ورک آرڈر';

  @override
  String get workOrderNotFoundTitle => 'ورک آرڈر نہیں ملا';

  @override
  String get workOrderNotFoundMessage =>
      'یہ ورک آرڈر نہیں مل سکا، یا اب آپ کو اس تک رسائی حاصل نہیں ہے۔';

  @override
  String get workOrderLoadErrorMessage => 'یہ ورک آرڈر ابھی لوڈ نہیں ہو سکا۔';

  @override
  String get workOrderFieldWorkOrderNo => 'ورک آرڈر نمبر';

  @override
  String get workOrderFieldWorkType => 'کام کی قسم';

  @override
  String get workOrderFieldSite => 'سائٹ';

  @override
  String get workOrderFieldCountry => 'ملک';

  @override
  String get workOrderFieldOpened => 'کھلنے کی تاریخ';

  @override
  String get workOrderFieldStarted => 'شروع ہونے کی تاریخ';

  @override
  String get workOrderFieldCompleted => 'مکمل ہونے کی تاریخ';

  @override
  String get workOrderFieldDescription => 'تفصیل';

  @override
  String get tyreReplaceNavTitle => 'ٹائر کی تبدیلی';

  @override
  String get tyreReplaceWorkspaceLoadingMessage =>
      'آپ کا ورک اسپیس ابھی لوڈ ہو رہا ہے۔ براہ کرم تھوڑی دیر بعد دوبارہ کوشش کریں۔';

  @override
  String get tyreReplaceAssetLabel => 'اثاثہ';

  @override
  String get tyreReplaceAssetHint => 'اثاثے کا نمبر ٹائپ کریں یا اسکین کریں';

  @override
  String tyreReplaceMasterFleetNumber(String fleetNo) {
    return 'فلیٹ $fleetNo';
  }

  @override
  String get tyreReplaceSiteLabel => 'سائٹ';

  @override
  String get tyreReplaceSiteHint => 'ٹائر کہاں تبدیل کیا گیا';

  @override
  String get tyreReplaceSiteHelp =>
      'یہ فلیٹ ریکارڈ سے خود بخود بھر دیا جاتا ہے۔ اگر یہ تبدیلی کسی مختلف سائٹ پر ہوئی ہے تو اسے تبدیل کریں۔';

  @override
  String get tyreReplacePositionLabel => 'پوزیشن';

  @override
  String get tyreReplacePositionHint =>
      'اس گاڑی کے لیے کوئی پوزیشن منتخب کریں، یا نیچے اپنی پوزیشن ٹائپ کریں۔';

  @override
  String get tyreReplacePositionInputLabel => 'پوزیشن کوڈ';

  @override
  String get tyreReplaceBrandLabel => 'برانڈ';

  @override
  String get tyreReplaceBrandHint => 'اختیاری';

  @override
  String get tyreReplaceSizeLabel => 'سائز';

  @override
  String get tyreReplaceSizeHint => 'مثال کے طور پر: 315/80R22.5';

  @override
  String get tyreReplaceSerialLabel => 'سیریل نمبر';

  @override
  String get tyreReplaceSerialHint => 'اختیاری';

  @override
  String get tyreReplaceCostLabel => 'لاگت';

  @override
  String get tyreReplaceCostHint => 'اختیاری';

  @override
  String get tyreReplaceOdometerLabel => 'اوڈومیٹر (کلومیٹر)';

  @override
  String get tyreReplaceOdometerHint => 'اختیاری';

  @override
  String get tyreReplaceTreadLabel => 'ٹریڈ کی گہرائی (ملی میٹر)';

  @override
  String get tyreReplaceTreadHint => 'اختیاری';

  @override
  String get tyreReplaceReasonLabel => 'ہٹانے کی وجہ';

  @override
  String get tyreReplaceReasonHint => 'اختیاری - پرانا ٹائر کیوں اتارا گیا';

  @override
  String get tyreReplacePhotosLabel => 'تصاویر';

  @override
  String get tyreReplaceAddPhoto => 'تصویر شامل کریں';

  @override
  String get tyreReplacePhotoCamera => 'کیمرہ';

  @override
  String get tyreReplacePhotoGallery => 'گیلری';

  @override
  String get tyreReplaceSaveAction => 'ٹائر کی تبدیلی محفوظ کریں';

  @override
  String get tyreReplaceAssetRequiredTitle => 'اثاثہ درکار ہے';

  @override
  String get tyreReplaceAssetRequiredMessage =>
      'محفوظ کرنے سے پہلے اثاثہ درج کریں۔';

  @override
  String get tyreReplacePositionRequiredTitle => 'پوزیشن درکار ہے';

  @override
  String get tyreReplacePositionRequiredMessage =>
      'محفوظ کرنے سے پہلے پوزیشن منتخب کریں یا ٹائپ کریں۔';

  @override
  String get tyreReplaceSavedTitle => 'ٹائر کی تبدیلی محفوظ ہو گئی';

  @override
  String get tyreReplaceSavedMessage =>
      'یہ خودکار طور پر مطابقت پذیر ہو جائے گی۔';

  @override
  String get tyreReplaceAddAnotherAction => 'مزید شامل کریں';

  @override
  String get tyreReplaceDoneAction => 'ہو گیا';

  @override
  String get tyreReplaceSaveFailedTitle => 'ٹائر کی تبدیلی محفوظ نہیں ہو سکی';

  @override
  String get tyreReplaceTryAgainFallback => 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔';

  @override
  String get tyreDiagramModeLayout => 'لے آؤٹ ویو';

  @override
  String get tyreDiagramModeList => 'فہرست ویو';

  @override
  String get tyreDiagramStatTotal => 'کل ٹائر';

  @override
  String get tyreDiagramStatOk => 'اچھا';

  @override
  String get tyreDiagramStatMonitor => 'نگرانی درکار';

  @override
  String get tyreDiagramStatCritical => 'نازک';

  @override
  String tyreDiagramStatUnrecordedCaption(int count) {
    return '$count ابھی تک ریکارڈ نہیں ہوئے';
  }

  @override
  String tyreDiagramListPressureValue(String value) {
    return '$value پی ایس آئی';
  }

  @override
  String tyreDiagramListTreadValue(String value) {
    return '$value ملی میٹر';
  }

  @override
  String get tyreDiagramListNotRecorded => 'ریکارڈ نہیں ہوا';

  @override
  String get tyreDiagramListEmptyTitle => 'ابھی تک کچھ ریکارڈ نہیں ہوا';

  @override
  String get tyreDiagramListEmptyMessage =>
      'لے آؤٹ ویو پر جائیں اور حالت ریکارڈ کرنے کے لیے ٹائر پر ٹیپ کریں۔';

  @override
  String get tyreDetailTitle => 'ٹائر کی تفصیل';

  @override
  String get tyreDetailStatTread => 'ٹریڈ کی گہرائی';

  @override
  String get tyreDetailStatPressure => 'دباؤ';

  @override
  String get tyreDetailStatTemperature => 'درجہ حرارت';

  @override
  String get tyreDetailFieldNotRecorded => 'ریکارڈ نہیں ہوا';

  @override
  String get tyreDetailNotRecordedCaption => 'اس معائنے میں ریکارڈ نہیں ہوا';

  @override
  String get tyreDetailSectionOverview => 'جائزہ';

  @override
  String get tyreDetailSectionAdditionalInfo => 'اضافی معلومات';

  @override
  String get tyreDetailBrandLabel => 'برانڈ / پیٹرن';

  @override
  String get tyreDetailSizeLabel => 'سائز';

  @override
  String get tyreDetailInstalledKmLabel => 'نصب شدہ';

  @override
  String get tyreDetailRunningKmLabel => 'چلائی گئی مسافت';

  @override
  String get tyreDetailAssetLabel => 'اثاثہ';

  @override
  String get tyreDetailSiteLabel => 'سائٹ';

  @override
  String get tyreDetailTakeActionButton => 'کارروائی کریں';

  @override
  String get tyreDetailAddDetailsButton => 'تفصیلات شامل کریں';

  @override
  String get tyreDetailEditDetailsButton => 'تفصیلات میں ترمیم کریں';

  @override
  String get tyreDetailRemainingKmLabel => 'باقی عمر';

  @override
  String get tyreDetailRemainingKmCaption => 'فلیٹ عمر کا تخمینہ';

  @override
  String get tyreDetailRemainingKmUnavailable =>
      'پیمائش شدہ عمر کا تخمینہ دستیاب نہیں';

  @override
  String get tyreDetailNoEvidenceMessage =>
      'اس ٹائر کے لیے ابھی تک کچھ ریکارڈ نہیں کیا گیا۔';

  @override
  String get takeActionTitle => 'کارروائی کریں';

  @override
  String get takeActionReplaceTyre => 'ٹائر تبدیل کریں';

  @override
  String get takeActionReplaceTyreSubtitle =>
      'اس پہیے پر لگائے گئے نئے ٹائر کا اندراج کریں';

  @override
  String get takeActionReportDefect => 'مرمت (پنکچر / نقصان)';

  @override
  String get takeActionReportDefectSubtitle =>
      'اس ٹائر کے لیے مرمت کا کام درج کریں';

  @override
  String get takeActionAdjustReading => 'ریڈنگ درست کریں';

  @override
  String get takeActionAdjustReadingSubtitle =>
      'دباؤ، ٹریڈ کی گہرائی یا حالت کو اپ ڈیٹ کریں';

  @override
  String get takeActionAdjustReadingUnavailableCaption =>
      'صرف اس معائنے کو مکمل کرتے وقت دستیاب ہے';

  @override
  String get takeActionRotateTyre => 'ٹائر گھمائیں';

  @override
  String get takeActionRemoveTyre => 'ٹائر ہٹائیں';

  @override
  String get takeActionSendToRetread => 'ری ٹریڈ کے لیے بھیجیں';

  @override
  String get takeActionMarkAsSpare => 'اسپیئر کے طور پر نشان زد کریں';

  @override
  String get takeActionComingSoonCaption =>
      'یہ سہولت ابھی اس ورژن میں دستیاب نہیں ہے';

  @override
  String get reportDefectTitle => 'خرابی کی اطلاع دیں';

  @override
  String get reportDefectTitleFieldLabel => 'عنوان';

  @override
  String get reportDefectTitleFieldHint => 'مثلاً: پچھلے بیرونی ٹائر میں پنکچر';

  @override
  String get reportDefectDescriptionLabel => 'تفصیل';

  @override
  String get reportDefectDescriptionHint => 'اس ٹائر میں کیا خرابی ہے؟';

  @override
  String get reportDefectDamageReasonLabel => 'نقصان کی وجہ';

  @override
  String get reportDefectDamageReasonHint => 'اختیاری';

  @override
  String get reportDefectPriorityLabel => 'ترجیح';

  @override
  String get reportDefectSubmitAction => 'مرمت کی درخواست جمع کروائیں';

  @override
  String get reportDefectTitleRequiredTitle => 'عنوان درکار ہے';

  @override
  String get reportDefectTitleRequiredMessage =>
      'محفوظ کرنے سے پہلے مختصر عنوان شامل کریں۔';

  @override
  String get reportDefectSavedTitle => 'مرمت کی درخواست محفوظ ہو گئی';

  @override
  String get reportDefectSavedMessage =>
      'یہ خودکار طور پر مطابقت پذیر ہو جائے گی۔';

  @override
  String get reportDefectSaveFailedTitle => 'مرمت کی درخواست محفوظ نہیں ہو سکی';

  @override
  String get damageReasonPuncture => 'پنکچر';

  @override
  String get damageReasonSidewall => 'سائیڈ وال کو نقصان';

  @override
  String get damageReasonTreadWear => 'ٹریڈ کی گھساوٹ';

  @override
  String get damageReasonBlowout => 'پھٹ جانا';

  @override
  String get damageReasonImpact => 'ٹکراؤ سے نقصان';

  @override
  String get damageReasonOther => 'دیگر';

  @override
  String get globalSearchTitle => 'تلاش';

  @override
  String get globalSearchSubtitle =>
      'اثاثہ، ٹائر، ورک آرڈر یا معائنہ تلاش کریں';

  @override
  String get globalSearchPlaceholder =>
      'اثاثہ، رجسٹریشن، چیسس، فلیٹ نمبر، سیریل، ورک آرڈر...';

  @override
  String get globalSearchHelp =>
      'اثاثہ نمبر، رجسٹریشن، چیسس نمبر، فلیٹ نمبر، ٹائر سیریل، ورک آرڈر نمبر یا معائنے کے حوالہ نمبر سے میچ کرتا ہے۔';

  @override
  String get globalSearchSearching => 'تلاش کیا جا رہا ہے...';

  @override
  String get globalSearchIdleTitle => 'اپنے پورے فلیٹ میں تلاش کریں';

  @override
  String get globalSearchIdleMessage =>
      'اثاثہ نمبر، رجسٹریشن، چیسس نمبر، فلیٹ نمبر، ٹائر سیریل، ورک آرڈر نمبر یا معائنے کا حوالہ نمبر لکھیں تاکہ ایک ساتھ سب کچھ تلاش ہو سکے۔';

  @override
  String get globalSearchEmptyTitle => 'کوئی نتیجہ نہیں ملا';

  @override
  String get globalSearchEmptyMessage =>
      'یہ لفظ اثاثوں، ٹائروں، ورک آرڈرز یا معائنوں میں سے کسی سے میچ نہیں ہوا۔ ہجے چیک کر کے دوبارہ کوشش کریں۔';

  @override
  String get globalSearchRecentSectionTitle => 'حالیہ تلاشیں';

  @override
  String globalSearchResultsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count نتائج',
      one: '1 نتیجہ',
      zero: 'کوئی نتیجہ نہیں',
    );
    return '$_temp0';
  }

  @override
  String get globalSearchSectionAssets => 'اثاثے';

  @override
  String get globalSearchSectionTyres => 'ٹائر';

  @override
  String get globalSearchSectionWorkOrders => 'ورک آرڈرز';

  @override
  String get globalSearchSectionInspections => 'معائنے';

  @override
  String get globalSearchSourceFailedNotice =>
      'کچھ نتائج ابھی چیک نہیں ہو سکے۔ ریفریش کرنے کے لیے نیچے کھینچیں یا دوبارہ کوشش کریں۔';

  @override
  String get loginAppSubtitle => 'انسپکٹر ایپ';

  @override
  String get loginTagline => 'فلیٹ · ورکشاپ · معائنے · ٹائر · حفاظت';

  @override
  String get loginCardTitle => 'سائن ان کریں';

  @override
  String get loginCardSubtitle =>
      'اپنا ای میل، صارف نام یا ملازم نمبر استعمال کریں';

  @override
  String get loginIdentifierLabel => 'ای میل یا ملازم نمبر';

  @override
  String get loginIdentifierPlaceholder => 'ای میل، نام یا نمبر درج کریں';

  @override
  String get loginPasswordLabel => 'پاس ورڈ';

  @override
  String get loginPasswordPlaceholder => 'پاس ورڈ درج کریں';

  @override
  String get loginShowPassword => 'پاس ورڈ دکھائیں';

  @override
  String get loginHidePassword => 'پاس ورڈ چھپائیں';

  @override
  String get loginErrorRequired => 'براہ کرم لاگ ان اور پاس ورڈ درج کریں۔';

  @override
  String loginErrorLocked(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other:
          'بہت زیادہ ناکام کوششیں۔ براہ کرم $minutes منٹ بعد دوبارہ کوشش کریں۔',
      one: 'بہت زیادہ ناکام کوششیں۔ براہ کرم 1 منٹ بعد دوبارہ کوشش کریں۔',
    );
    return '$_temp0';
  }

  @override
  String get loginOperationsTitle => 'ہر PMV اثاثے کے لیے ایک پلیٹ فارم';

  @override
  String get loginWelcomeTitle => 'دوبارہ خوش آمدید';

  @override
  String get loginWelcomeSubtitle =>
      'اپنے تفویض کردہ فلیٹ، ورکشاپ اور فیلڈ کاموں تک رسائی حاصل کریں';

  @override
  String get loginSelectCountryTitle => 'اپنا ملک منتخب کریں';

  @override
  String get loginSelectCountrySubtitle =>
      'اپنی تفویض کردہ کارروائیوں کے لیے ملک منتخب کریں۔';

  @override
  String get loginChangeCountryAction => 'ملک تبدیل کریں';

  @override
  String get loginCountrySaudiArabia => 'سعودی عرب';

  @override
  String get loginCountryUnitedArabEmirates => 'متحدہ عرب امارات';

  @override
  String get loginCountryEgypt => 'مصر';

  @override
  String get loginCountrySelectorSemantics => 'ملک کا انتخاب';

  @override
  String loginSelectedCountrySemantics(String country) {
    return 'منتخب ملک: $country';
  }

  @override
  String get loginScopeFleetAssets => 'فلیٹ اور اثاثے';

  @override
  String get loginScopeInspectionsChecklists => 'معائنے اور چیک لسٹس';

  @override
  String get loginScopeMaintenanceWorkshop => 'دیکھ بھال اور ورکشاپ';

  @override
  String get loginSecurityCopyCatalog =>
      'secure=محفوظ کمپنی ورک اسپیس · %country%~forgot=پاس ورڈ بھول گئے؟~access=رسائی چاہیے؟ اپنے منتظم سے رابطہ کریں~or=یا~biometric=ڈیوائس بایومیٹرکس استعمال کریں~authorized=صرف مجاز PMV اہلکار~audited=سرگرمی کا آڈٹ کیا جاتا ہے~version=ورژن %version%~biometricReason=Tyre Pulse میں سائن ان کے لیے اپنی شناخت کی تصدیق کریں~biometricUnavailable=ڈیوائس بایومیٹرکس دستیاب یا رجسٹرڈ نہیں ہیں۔~biometricLocked=ڈیوائس بایومیٹرکس عارضی طور پر مقفل ہیں۔ اپنا پاس ورڈ استعمال کریں۔~biometricFailed=ڈیوائس کی تصدیق مکمل نہیں ہو سکی۔~credentialsRequired=ڈیوائس بایومیٹرکس استعمال کرنے سے پہلے ای میل یا ملازم نمبر اور پاس ورڈ درج کریں۔~helpTitle=سائن ان مدد~forgotHelp=پاس ورڈ ری سیٹ Tyre Pulse منتظم سنبھالتا ہے۔ رسائی بحال کرنے کے لیے منتظم سے رابطہ کریں۔~accessHelp=Tyre Pulse منتظم موبائل رسائی اور اکاؤنٹ کی منظوری سنبھالتا ہے۔';

  @override
  String get profileNavTitle => 'پروفائل';

  @override
  String get profileRoleLabel => 'کردار';

  @override
  String get profileSuperAdminBadge => 'پلیٹ فارم ایڈمنسٹریٹر';

  @override
  String get accidentReportCaptureSubtitle => 'نجی ثبوت کیپچر';

  @override
  String get accidentSubmitUnavailable =>
      'جمع کرانا اس وقت تک دستیاب نہیں جب تک محفوظ سنک پائپ لائن ہر نجی ثبوت تصویر کو حادثہ ریکارڈ سے پہلے اپلوڈ کرنے کی ضمانت نہ دے۔ لی گئی تصاویر اس آلے پر رہیں گی۔';

  @override
  String get accidentOverviewAppBarTitle => 'حادثہ';

  @override
  String get accidentCaseAppBarTitle => 'کیس کی تفصیلات';

  @override
  String get accidentViewCaseDetailsAction => 'کیس کی تفصیلات دیکھیں';

  @override
  String get accidentUpdateCaseAction => 'کیس اپ ڈیٹ کریں';

  @override
  String get accidentReportedOnLabel => 'رپورٹ کی تاریخ';

  @override
  String get accidentProgressSection => 'پیش رفت';

  @override
  String get accidentDueDateLabel => 'مقررہ تاریخ';

  @override
  String get accidentCaseInfoSection => 'کیس کی معلومات';

  @override
  String get accidentCaseAssetLabel => 'اثاثہ';

  @override
  String get accidentCaseLocationLabel => 'مقام';

  @override
  String get accidentCaseReportedByLabel => 'رپورٹ کرنے والا';

  @override
  String get tasksCopyCatalog =>
      'title=میرا کام~today=آج~assignedTab=تفویض شدہ~dueToday=آج واجب~inProgress=جاری~completed=مکمل~urgent=فوری~upcoming=آنے والا~open=کھلے~emptyTitle=کوئی کام نہیں~emptyMessage=اس منظر سے کوئی کام مطابقت نہیں رکھتا۔~loadError=میرا کام ابھی لوڈ نہیں ہو سکا۔~due=مقررہ تاریخ~assigned=تفویض شدہ~unassigned=غیر تفویض شدہ~normal=عام~overdue=تاخیر شدہ~details=کام کی تفصیل~description=تفصیل~site=سائٹ~asset=اثاثہ~priority=ترجیح~status=حالت~view=دیکھیں~reportIssue=مسئلہ رپورٹ کریں~retry=دوبارہ کوشش';

  @override
  String get alertsCopyCatalog =>
      'title=ٹائر الرٹس~all=تمام~critical=سنگین~warnings=انتباہات~info=معلومات~flagged=نشان زدہ~criticalCount=سنگین~emptyTitle=کوئی فعال الرٹ نہیں~emptyFilter=اس فلٹر سے کوئی الرٹ نہیں ملا۔~loadError=الرٹس لوڈ نہیں ہو سکے۔ دوبارہ کوشش کے لیے نیچے کھینچیں۔~unknownAsset=نامعلوم اثاثہ~pressureLow=ٹائر کا دباؤ کم ہے~treadLow=ٹریڈ کی گہرائی کم ہے~position=پوزیشن~serial=سیریل~tread=ٹریڈ~retry=دوبارہ کوشش';

  @override
  String get notificationInboxCopyCatalog =>
      'title=اطلاعات~markAll=سب کو پڑھا ہوا کریں~fallbackTitle=اطلاع~emptyTitle=آپ تمام تازہ معلومات دیکھ چکے ہیں~emptyBody=ذمہ داریاں، منظوریوں اور عملی اپ ڈیٹس یہاں نظر آئیں گی۔~loadFailed=اطلاعات لوڈ نہیں ہو سکیں۔ دوبارہ کوشش کے لیے نیچے کھینچیں۔~markFailed=اس اطلاع کو پڑھا ہوا نہیں کیا جا سکا۔~markAllFailed=تمام اطلاعات کو پڑھا ہوا نہیں کیا جا سکا۔~justNow=ابھی~minutesAgo=%count% منٹ پہلے~hoursAgo=%count% گھنٹے پہلے~daysAgo=%count% دن پہلے';

  @override
  String get reportIssueCopyCatalog =>
      'title=مسئلہ رپورٹ کریں~problem=کیا خرابی ہے؟~problemHint=مسئلے کی مختصر وضاحت کریں~priority=ترجیح~low=کم~medium=درمیانی~high=زیادہ~critical=سنگین~site=سائٹ~siteHint=جہاں مسئلہ ملا~asset=اثاثہ~assetHint=اثاثہ نمبر~due=مقررہ مدت~noDate=کوئی تاریخ نہیں~threeDays=3 دن~oneWeek=1 ہفتہ~twoWeeks=2 ہفتے~details=تفصیل~detailsHint=علامات، درست مقام اور فوری کارروائی درج کریں~photos=ثبوت~optional=(اختیاری)~addPhoto=تصویر شامل کریں~camera=کیمرہ~gallery=گیلری سے~photoFailed=تصویر شامل نہیں ہو سکی۔~submit=مسئلہ جمع کریں~titleRequired=محفوظ کرنے سے پہلے خرابی درج کریں۔~workspaceUnavailable=آپ کی ورک اسپیس لوڈ ہو رہی ہے۔ کچھ دیر بعد دوبارہ کوشش کریں۔~savedTitle=مسئلہ محفوظ ہو گیا~savedBody=مسئلہ میرے کام میں شامل ہے اور خودکار طور پر سنک ہو گا۔~stay=یہیں رہیں~viewTasks=میرا کام دیکھیں~saveFailed=مسئلہ محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔~category=مسئلے کی قسم~mechanical=مکینیکل~electrical=برقی~hydraulic=ہائیڈرولک~tyre=ٹائر~body=باڈی~washing=دھلائی~safety=حفاظت~other=دیگر~operation=کیا اثاثہ محفوظ طریقے سے چل سکتا ہے؟~yes=ہاں~restricted=محدود~no=نہیں~restriction=آپریٹنگ پابندی~saveDraft=مسودہ محفوظ کریں~draftSaved=مسودہ محفوظ ہو گیا~createWorkOrder=سپروائزر کے جائزے کے بعد ورک آرڈر بنائیں~notifyTeam=فلیٹ سپروائزر اور ورکشاپ ٹیم کو اطلاع دی جائے گی';

  @override
  String get rcaCopyCatalog =>
      'title=بنیادی وجہ کا تجزیہ~records=ریکارڈز~newRecord=نیا تجزیہ~none=کوئی تجزیاتی ریکارڈ نہیں~noneBody=مکمل بنیادی وجہ کے ریکارڈ یہاں نظر آئیں گے۔~unknown=نامعلوم اثاثہ~asset=اثاثہ~serial=ٹائر سیریل~brand=برانڈ~site=سائٹ~km=خرابی کے وقت کلومیٹر~factors=معاون عوامل~rootCause=بنیادی وجہ~photos=ثبوت کی تصاویر~photo=تصویر~addPhoto=تصویر شامل کریں~camera=کیمرہ~gallery=گیلری~photoFailed=تصویر شامل نہیں ہو سکی۔~save=تجزیہ محفوظ کریں~missingCause=محفوظ کرنے سے پہلے بنیادی وجہ درج کریں۔~invalidKm=درست کلومیٹر ریڈنگ درج کریں۔~loadFailed=تجزیاتی ریکارڈ لوڈ نہیں ہو سکے۔~saveFailed=تجزیہ محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔';

  @override
  String get pmCopyCatalog =>
      'title=دیکھ بھال کنٹرول سینٹر~subtitle=آج کے دیکھ بھال کے کام کو کنٹرول کریں~createWorkOrder=ورک آرڈر بنائیں~pmDue=پی ایم واجب~priorityQueue=ترجیحی کاموں کی قطار~viewAll=سب دیکھیں~allWorkOrders=تمام ورک آرڈرز دیکھیں~quickAccess=فوری رسائی~workOrders=ورک آرڈرز~workOrdersHint=بنائیں اور منظم کریں~pmSchedule=پی ایم شیڈول~pmScheduleHint=پی ایم کی منصوبہ بندی اور پیروی~inspections=معائنے~inspectionsHint=جانچیں اور رپورٹ کریں~parts=پرزے~partsHint=اسٹاک اور درخواستیں~tyres=ٹائر~tyresHint=ریکارڈ، گردش اور تبدیلی~overdue=تاخیر شدہ~dueSoon=جلد واجب~active=فعال منصوبے~due=اب واجب~all=تمام منصوبے~empty=دیکھ بھال کا کوئی منصوبہ نہیں~emptyDue=اگلے 14 دنوں میں کوئی احتیاطی دیکھ بھال واجب نہیں۔~emptyAll=کوئی فعال احتیاطی دیکھ بھال منصوبہ دستیاب نہیں۔~plan=دیکھ بھال منصوبہ~daysOverdue=دن تاخیر~daysLeft=دن باقی~noDate=واجب تاریخ نہیں~record=سروس ریکارڈ کریں~meter=میٹر ریڈنگ~performedBy=کام کرنے والا~workshop=ورکشاپ~partsCost=پرزوں کی قیمت~labourCost=مزدوری کی قیمت~findings=مشاہدات~completed=مکمل~partial=جزوی مکمل~deferred=ملتوی~failed=ناکام~save=سروس محفوظ کریں~invalidNumber=درست عددی قدریں درج کریں۔~loadFailed=دیکھ بھال منصوبے لوڈ نہیں ہو سکے۔~saveFailed=سروس ریکارڈ محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔~openBreakdowns=کھلی خرابیاں~activeWorkOrders=فعال ورک آرڈرز~breakdown=خرابی~workOrder=ورک آرڈر~dueToday=آج واجب~since=سے~opened=کھولا گیا~queueEmpty=کسی چیز پر توجہ درکار نہیں~woLoadFailed=کھلے ورک آرڈرز لوڈ نہیں ہو سکے۔~retry=دوبارہ کوشش کریں~countFailed=یہ تعداد لوڈ نہیں ہو سکی۔ دوبارہ کوشش کے لیے ٹیپ کریں۔';

  @override
  String get stockCountCopyCatalog =>
      'title=اسٹاک گنتی~items=اشیاء~reorder=دوبارہ آرڈر~notToday=آج نہیں گنا~search=تفصیل یا سائٹ تلاش کریں~all=تمام~low=کم اسٹاک~stale=آج نہیں گنا~empty=کوئی اسٹاک آئٹم نہیں~emptyBody=کوئی اسٹاک ریکارڈ ان فلٹرز سے میل نہیں کھاتا۔~count=گنتی~stockItem=اسٹاک آئٹم~physicalCount=اصل گنتی~reason=وجہ (اختیاری)~cancel=منسوخ~save=گنتی محفوظ کریں~invalid=صفر یا زیادہ گنتی درج کریں۔~offlineSaved=گنتی آف لائن محفوظ اور ہم وقت سازی کے لیے قطار میں ہے۔~saveFailed=اسٹاک گنتی محفوظ نہیں ہو سکی۔~loadFailed=اسٹاک ریکارڈ لوڈ نہیں ہو سکے۔~Critical=انتہائی کم~Low=کم~OK=درست~onHand=دستیاب';

  @override
  String get calendarCopyCatalog =>
      'title=آج کا فیلڈ پلان~scheduled=مقررہ~overdue=تاخیر شدہ~today=آج واجب~week=اس ہفتے~later=بعد میں~inspection=معائنہ~maintenance=دیکھ بھال~task=اصلاحی کام~empty=کچھ مقرر نہیں~emptyBody=آنے والے معائنے، دیکھ بھال اور اصلاحی کام یہاں نظر آئیں گے۔~loadFailed=شیڈول لوڈ نہیں ہو سکا۔';

  @override
  String get managementCopyCatalog =>
      'overviewTitle=فلیٹ جائزہ~analyticsTitle=فلیٹ تجزیات~reportsTitle=مالی رپورٹ~reportsSubtitle=لاگت اور کارکردگی کا براہ راست خلاصہ~teamTitle=ٹیم~last=آخری~days=دن~days30=30 دن~days90=90 دن~year1=1 سال~allSites=تمام سائٹس~tyres=ٹائر~vehicles=گاڑیاں~critical=انتہائی اہم~openActions=کھلے اقدامات~highRisk=زیادہ خطرہ~inspections30=معائنے (30 دن)~tyreSpend=ٹائر خرچ~risk=خطرے کی تقسیم~sites=نمایاں سائٹس~brands=نمایاں برانڈز~analyticsFailed=تجزیات لوڈ نہیں ہو سکے۔~reportsFailed=رپورٹ ڈیٹا لوڈ نہیں ہو سکا۔~reportUnavailable=براہ راست رپورٹ دستیاب نہیں~reportUnavailableBody=مستند سرور خلاصہ دستیاب نہیں۔ کوئی اعداد وضع نہیں کیے گئے۔~retry=دوبارہ کوشش~generated=تیار شدہ~costPerformance=لاگت اور کارکردگی~fleet=فلیٹ~tyre_spend=ٹائر خرچ~accidents=حادثات~open_accidents=کھلے حادثات~claims_claimed=جمع دعوے~claims_recovered=وصول دعوے~inspections=معائنے~work_orders_open=کھلے ورک آرڈر~tyre_cost=ٹائر لاگت~maintenance_cost=دیکھ بھال لاگت~total_cost=کل لاگت~km=کلومیٹر~engine_hours=انجن گھنٹے~m3=پیداوار م3~cost_per_km=فی کلومیٹر لاگت~cost_per_hour=فی گھنٹہ لاگت~cost_per_m3=فی م3 لاگت~tyre_cpk=ٹائر سی پی کے~severity=حادثے کی شدت~accidents_by_site=سائٹ کے لحاظ سے حادثات~tyres_by_site=سائٹ کے لحاظ سے ٹائر~claim_status=دعویٰ حالت~members=ارکان~manage=ٹیم انتظام~active=فعال~pending=زیر التوا~teamSearch=نام، کردار یا سائٹ تلاش کریں~noMembers=کوئی رکن نہیں~trySearch=دوسری تلاش آزمائیں۔~teamFailed=ٹیم ڈائریکٹری لوڈ نہیں ہو سکی۔';

  @override
  String get profileSignOutConfirmTitle => 'سائن آؤٹ کریں؟';

  @override
  String get profileSignOutConfirmMessage =>
      'کام جاری رکھنے کے لیے آپ کو دوبارہ سائن ان کرنا ہوگا۔ اس ڈیوائس پر پہلے سے محفوظ کام محفوظ رہے گا۔';

  @override
  String get accidentCopyCatalog =>
      'loadFailed=حادثہ ریکارڈ لوڈ نہیں ہو سکا۔ دوبارہ کوشش کریں۔~notRecorded=درج نہیں~dashboardTitle=حادثہ کمانڈ سینٹر~dashboardSubtitle=اجازت کے مطابق براہ راست رجسٹر~reportAction=حادثہ رپورٹ کریں~reportShort=رپورٹ~loadingRegister=حادثہ رجسٹر لوڈ ہو رہا ہے…~dashboardEyebrow=PMV حادثہ کنٹرول~dashboardHeroTitle=ہر کیس، ایک جواب دہ راستہ~dashboardHeroMessage=فلیٹ، انشورنس، ورکشاپ، QC، حوالگی اور ریکوری بغیر فرضی KPI کے واضح رہتے ہیں۔~searchHint=اثاثہ، حوالہ، سائٹ یا مقام تلاش کریں~allCases=تمام کیس~reportedByMe=میری رپورٹس~anyStatus=کوئی بھی حالت~open=کھلا~closed=بند~noMatches=کوئی مماثل کیس نہیں~noMatchesMessage=فلٹر بدلیں یا نئی حادثہ رپورٹ بنائیں۔~loadMore=مزید کیس لوڈ کریں~loading=لوڈ ہو رہا ہے…~detailTitle=حادثے کی تفصیل~loadingFacts=کیس کے حقائق لوڈ ہو رہے ہیں…~notFound=حادثہ نہیں ملا~notFoundMessage=یہ ریکارڈ آپ کی رسائی سے باہر ہے یا موجود نہیں۔~openFlow=جواب دہ کیس فلو کھولیں~incidentFacts=حادثے کے حقائق~incidentFactsHint=رپورٹر کے ثبوت اور گاڑی کی شناخت~liability=ذمہ داری اور ادائیگی~liabilityHint=قصوروار، ذمہ دار اور ادائیگی کرنے والا~insurance=انشورنس اور ریکوری~insuranceHint=دعویٰ اور ریکوری بندش سے الگ ہیں~workshopRelease=ورکشاپ اور ریلیز~workshopReleaseHint=تشخیص، مرمت، QC اور گاڑی کی واپسی~closure=بندش کے کنٹرول~closureHint=پرانا منظوری عمل اور جدید کیس حالت الگ ہیں~vehicleType=گاڑی کی قسم~plate=پلیٹ / فلیٹ نمبر~type=حادثے کی قسم~severity=شدت~reporter=رپورٹر~evidenceFiles=ثبوت فائلیں~description=تفصیل~damage=نقصان~fault=غلطی کی حالت~responsible=قصوروار فریق~liable=ذمہ دار فریق~payer=ادائیگی کرنے والا~insurer=انشورنس کمپنی~policy=پالیسی~claimNo=دعویٰ نمبر~claimStatus=دعویٰ حالت~claimed=دعویٰ رقم~approved=منظور رقم~recoveryStatus=ریکوری حالت~recovered=وصول رقم~repairType=مرمت کی قسم~workshop=ورکشاپ~repairCost=مرمت لاگت~expectedRelease=متوقع ریلیز~actualRelease=اصل ریلیز~nextAction=اگلا اقدام~workflowStage=ورک فلو مرحلہ~caseStatus=کیس حالت~closureRequest=بندش درخواست~closureLevel=بندش سطح~caseTitle=کیس جواب دہی~caseId=کیس آئی ڈی~incidentDateLabel=واقعے کی تاریخ~damageMapTitle=نقصان کا نقشہ~damageMapHint=نقصان کی نشاندہی کے لیے حصے پر ٹیپ کریں~damageMapZonesLabel=حصے نشان زد~damageMapNoneMarked=ابھی تک کوئی حصہ نشان زد نہیں~damageViewFront=سامنے~damageViewRear=پیچھے~damageViewLeft=بائیں جانب~damageViewRight=دائیں جانب~damageViewTop=اوپر سے~zoneFrontBumper=اگلا بمپر~zoneHood=بونٹ~zoneWindshield=اگلا شیشہ~zoneLeftHeadlight=بائیں ہیڈلائٹ~zoneRightHeadlight=دائیں ہیڈلائٹ~zoneRearBumper=پچھلا بمپر~zoneTailgate=پچھلا دروازہ~zoneRearWindshield=پچھلا شیشہ~zoneLeftTailLight=بائیں ٹیل لائٹ~zoneRightTailLight=دائیں ٹیل لائٹ~zoneFrontFender=اگلا فینڈر~zoneFrontDoor=اگلا دروازہ~zoneRearDoor=پچھلا دروازہ~zoneRearFender=پچھلا فینڈر~zoneMirror=سائیڈ مرر~zoneRoof=چھت~damageMarkSeverityLabel=شدت~damageMarkNoteLabel=نوٹ (اختیاری)~damageMarkSave=نشان محفوظ کریں~damageMarkRemove=نشان ہٹائیں~loadingWorkstreams=ورک اسٹریم لوڈ ہو رہے ہیں…~caseNotFound=کیس نہیں ملا~caseNotFoundMessage=یہ حادثہ آپ کی اجازت سے باہر ہے یا موجود نہیں۔~endToEnd=مکمل کیس فلو~notActivated=کیس ورک فلو فعال نہیں~notActivatedMessage=حادثہ موجود ہے لیکن ورک اسٹریم ماڈل تیار نہیں۔ کوئی پیش رفت فرض نہیں کی گئی۔~noWorkstreams=کوئی ورک اسٹریم مقرر نہیں~noWorkstreamsMessage=کیس ماڈل دستیاب ہے لیکن ابھی راستہ مقرر نہیں ہوا۔~timeline=جواب دہ ٹائم لائن~timelineHint=کیس ورک اسٹریم لیجر کی صرف پڑھنے والی حقیقت~boundary=کنٹرول حد~boundaryHint=اقدامات فرض نہیں کیے گئے~boundaryMessage=انشورنس، تشخیص، مرمت، QC، حوالگی، بندش اور ریکوری فیصلوں کے لیے تصدیق شدہ سرور عمل ضروری ہیں۔ غیر محفوظ براہ راست ترمیم نہیں۔~done=مکمل~inProgress=جاری~pending=زیر التوا~notRequired=ضروری نہیں~reason=وجہ~wsIncident=حادثہ اور ثبوت~wsFleet=فلیٹ تصدیق~wsLiability=ذمہ داری اور حفاظت~wsInsurance=انشورنس دعویٰ~wsAssessment=ورکشاپ تشخیص~wsRepair=مرمت عمل~wsQc=ورکشاپ QC~wsHandover=گاڑی حوالگی~wsFinance=ریکوری اور مالیات~wsCorrective=اصلاحی اقدامات~selectAsset=فلیٹ اثاثہ منتخب کریں~changeAsset=اثاثہ بدلیں~assetSearch=اثاثہ، فلیٹ نمبر، پلیٹ یا ماڈل~unrecordedAsset=غیر درج اثاثہ~photoFailed=ثبوت تصویر محفوظ نہیں ہو سکی۔ دوبارہ کوشش کریں۔~workspaceLoading=ورک اسپیس ابھی لوڈ ہو رہی ہے۔ دوبارہ کوشش کریں۔~required=اثاثہ، سائٹ، تفصیل اور کم از کم ایک ثبوت تصویر ضروری ہے۔~fieldsDropped=تمام فیلڈ محفوظ نہیں ہوئے۔ رپورٹ جمع شدہ نہیں دکھائی گئی۔~saveFailed=رپورٹ اس آلے پر محفوظ نہیں ہو سکی۔ دوبارہ کوشش کریں۔~saved=رپورٹ محفوظ~savedTitle=حادثہ رپورٹ محفوظ ہو گئی~savedMessage=رپورٹ اور ثبوت آلے کی سنک قطار میں ہیں اور فعال ورک اسپیس کے تحت اپلوڈ ہوں گے۔~backRegister=حادثہ رجسٹر واپس جائیں~reportTitle=حادثہ رپورٹ کریں~reportSubtitle=آف لائن محفوظ ثبوت~firstResponse=پہلا ردعمل~captureFacts=موقع پر حقائق درج کریں~captureFactsMessage=پہلے اثاثہ منتخب کریں تاکہ PMV ماسٹر سائٹ اور شناخت بھرے۔ کم از کم ایک ثبوت تصویر لازمی ہے۔~assetLocation=1. اثاثہ اور مقام~assetLocationHint=دستیاب ہونے پر فلیٹ ماسٹر مستند ہے~fleetUnavailable=فلیٹ تلاش دستیاب نہیں۔ دستی اندراج دستیاب ہے۔~assetNo=اثاثہ نمبر~site=سائٹ~exactLocation=حادثے کا درست مقام~classification=2. درجہ بندی~classificationHint=ابتدائی میدانی درجہ بندی بعد میں دیکھی جا سکتی ہے~minor=معمولی~moderate=درمیانہ~severe=شدید~fatal=جان لیوا~collision=تصادم~rollover=الٹنا~propertyDamage=املاک نقصان~other=دیگر~whatHappened=کیا ہوا؟~notes=فوری نوٹس~evidence=3. ثبوت~evidenceAttached=ثبوت تصاویر منسلک • کم از کم 1~camera=کیمرہ~gallery=گیلری~evidencePhoto=ثبوت تصویر~removePhoto=تصویر ہٹائیں~saveReport=حادثہ رپورٹ محفوظ کریں';

  @override
  String get washEvidenceTitle => 'چیک لسٹ اور کیمیکل';

  @override
  String get washEnteredByLabel => 'اندراج کرنے والا';

  @override
  String get washChemicalUseLabel => 'استعمال شدہ کیمیکل';

  @override
  String get washNotRecorded => 'درج نہیں';

  @override
  String get washNoChemical => 'کوئی کیمیکل استعمال نہیں ہوا';

  @override
  String get washChemicalUsed => 'کیمیکل استعمال ہوا';

  @override
  String get washProductName => 'پروڈکٹ کا نام';

  @override
  String get washManufacturer => 'بنانے والی کمپنی';

  @override
  String get washQuantity => 'مقدار اور اکائی';

  @override
  String get washDilution => 'استعمال شدہ محلول (لیبل کے مطابق)';

  @override
  String get washAddProduct => 'پروڈکٹ شامل کریں';

  @override
  String get washRemoveProduct => 'پروڈکٹ ہٹائیں';

  @override
  String get washChecklistTitle => 'دھلائی کی چیک لسٹ';

  @override
  String get washCheckExterior => 'بیرونی سطحیں';

  @override
  String get washCheckGlass => 'شیشے، آئینے اور لائٹس';

  @override
  String get washCheckWheels => 'پہیے اور پہیوں کے خانے';

  @override
  String get washCheckCab => 'کیبن کا اندرونی حصہ';

  @override
  String get washCheckRinse => 'آخری دھلائی اور نظر آنے والی باقیات';

  @override
  String get washNotChecked => 'چیک نہیں کیا';

  @override
  String get washChecked => 'چیک کیا';

  @override
  String get washIssueFound => 'مسئلہ ملا';

  @override
  String get washNotApplicable => 'لاگو نہیں';

  @override
  String get washIssueNote => 'مسئلے کی تفصیل / تبصرہ';

  @override
  String get washEvidenceRequired =>
      'پروڈکٹ کے نام اور چیک لسٹ کے مسائل کی تفصیل درج کریں۔';

  @override
  String get washViewRecord => 'دھلائی کا ریکارڈ دیکھیں';

  @override
  String get washReceivedAt => 'وصول ہونے کا وقت';

  @override
  String get washSearchHistory => 'گاڑی، شخص یا مقام تلاش کریں';

  @override
  String get washMyEntries => 'میرے اندراجات';

  @override
  String get washAllEntries => 'تمام اندراجات';

  @override
  String get washSavedOnDevice =>
      'اس ڈیوائس پر محفوظ ہے۔ اپ لوڈ کی حالت سنک میں دیکھیں۔';

  @override
  String get washHistoryLimit =>
      'مکمل تاریخ لوڈ کرنے کے لیے بہت بڑی ہے۔ ویب رپورٹ استعمال کریں۔';

  @override
  String get workshopCopyCatalog =>
      'title=میرے کام~onDuty=ڈیوٹی پر~offDuty=ڈیوٹی سے باہر~checkIn=حاضری لگائیں~checkOut=چھٹی لگائیں~checkInHint=کام درج کرنے سے پہلے اپنی شفٹ کی حاضری لگائیں۔~myJobs=میرے کام~emptyTitle=کوئی کھلا کام نہیں~emptyMessage=اس وقت آپ کو کوئی کھلا کام تفویض نہیں ہے۔~loadError=آپ کے کام ابھی لوڈ نہیں ہو سکے۔~selectJobTitle=کام منتخب کریں~selectJobMsg=پہلے اپنا ایک کام منتخب کریں۔~checkInFirstTitle=پہلے حاضری لگائیں~selectTaskTitle=مرحلہ منتخب کریں~selectTaskMsg=پہلے وہ مرحلہ منتخب کریں جس پر آپ کام کر رہے ہیں۔~tasks=مراحل~confirmTitle=مرحلہ مکمل کریں؟~confirmMsg=یہ مرحلے کو مکمل درج کر کے معائنے کے لیے بھیج دے گا۔~cancel=منسوخ~noteHint=نوٹ شامل کریں (اختیاری)~record=درج کریں~queued=اس ڈیوائس پر محفوظ ہے۔ یہ خود بخود ہم آہنگ ہو جائے گا۔~saveFailed=سرگرمی اس ڈیوائس پر محفوظ نہیں ہو سکی۔ دوبارہ کوشش کریں۔~todayTitle=آج میری کارکردگی~productive=پیداواری~blocked=رکا ہوا~unassigned=غیر تفویض~breakTime=وقفہ~completed=مکمل مراحل~due=مقررہ~ok=ٹھیک ہے~a_start_job=کام شروع کریں~a_pause_job=کام روکیں~a_resume_job=کام دوبارہ شروع کریں~a_complete_task=مرحلہ مکمل کریں~a_request_parts=پرزے طلب کریں~a_request_assistance=مدد طلب کریں~a_waiting_approval=منظوری کا انتظار~a_waiting_vehicle=گاڑی کا انتظار~a_waiting_tools=اوزار کا انتظار~a_start_break=وقفہ شروع کریں~a_end_break=وقفہ ختم کریں~a_report_problem=مسئلہ رپورٹ کریں~s_working=کام جاری~s_available=دستیاب~s_waiting_parts=پرزوں کا انتظار~s_waiting_approval=منظوری کا انتظار~s_waiting_tools=اوزار کا انتظار~s_waiting_vehicle=گاڑی کا انتظار~s_on_break=وقفے پر~s_training=تربیت~s_awaiting_inspection=معائنے کا انتظار~s_off_duty=ڈیوٹی سے باہر~s_absent=غیر حاضر~photoLabel=تصویر (اختیاری)~takePhoto=کیمرہ~pickPhoto=گیلری~removePhoto=تصویر ہٹائیں~photoLimit=زیادہ سے زیادہ 3 تصاویر~photoNotAttached=درج ہو گیا۔ کنکشن کے بغیر تصویر منسلک نہیں ہو سکی۔';

  @override
  String get homeTodaysWork => 'آج کا کام';

  @override
  String get homeAwaitingSignatureTag => 'دستخط کا انتظار';

  @override
  String get homeResumeInspection => 'معائنہ دوبارہ شروع کریں';

  @override
  String get homeTyreIssueNeedsAttention => 'ٹائر کا مسئلہ توجہ کا متقاضی ہے';

  @override
  String get profileSectionWorkspace => 'ورک اسپیس';

  @override
  String get profileEmployeeIdLabel => 'ملازم آئی ڈی';

  @override
  String get profileLanguageLabel => 'ایپ کی زبان';

  @override
  String get profileSectionDisplay => 'زبان اور ڈسپلے';

  @override
  String get profileThemeLabel => 'تھیم';

  @override
  String get profileThemeLight => 'ہلکا';

  @override
  String get profileThemeDark => 'گہرا';

  @override
  String get profileThemeSystem => 'سسٹم کے مطابق';

  @override
  String get profileSectionOffline => 'آف لائن اور ڈیٹا';

  @override
  String get profileUnsyncedFooter =>
      'غیر ہم آہنگ مسودے اس ڈیوائس پر محفوظ رہتے ہیں';

  @override
  String get loginHeroTitle => 'مکمل PMV آپریشنز';

  @override
  String get loginSignInSubtitle => 'اپنے تفویض کردہ آپریشنز میں سائن ان کریں';

  @override
  String get vehiclesInspectNow => 'ابھی معائنہ کریں';

  @override
  String get inspectionPreviousTyre => 'پچھلا';

  @override
  String get inspectionNextTyre => 'اگلا';

  @override
  String get inspectionProgressTitle => 'معائنے کی پیش رفت';

  @override
  String inspectionPercentComplete(int percent) {
    return '$percent% مکمل';
  }

  @override
  String inspectionAxleNumber(int number) {
    return 'ایکسل $number';
  }

  @override
  String get inspectionTyresLabel => 'ٹائر';

  @override
  String get inspectionScanAssetButton => 'اثاثہ اسکین کریں';

  @override
  String get inspectionSelectedAssetTitle => 'منتخب اثاثہ';

  @override
  String get profileSyncUnknownFooter =>
      'زیر التواء ہم آہنگی کی جانچ نہیں ہو سکی۔ ممکن ہے اس ڈیوائس پر غیر ہم آہنگ کام موجود ہو';

  @override
  String get homeRecentInspectionsTitle => 'آپ کے حالیہ معائنے';

  @override
  String get homeAssetNotChecked => 'جانچ نہیں ہوئی';

  @override
  String get homeNothingForRoleTitle => 'آپ کے کردار کے لیے جانچنے کو کچھ نہیں';

  @override
  String get tyreActionRotateSubtitle =>
      'درج کریں کہ یہ ٹائر دوسری جگہ منتقل کیا گیا';

  @override
  String get tyreActionRotateFromLabel => 'موجودہ جگہ';

  @override
  String get tyreActionRotateToLabel => 'نئی جگہ';

  @override
  String get tyreActionRotateToHint => 'مثال کے طور پر RHF1';

  @override
  String get tyreActionRotateNotesLabel => 'نوٹس (اختیاری)';

  @override
  String get tyreActionRotateNotesHint =>
      'کوئی بھی بات جو اگلے فٹر کو معلوم ہونی چاہیے';

  @override
  String get tyreActionRotateOnlineNote =>
      'کنکشن درکار ہے۔ روٹیشن براہ راست سرور پر محفوظ ہوتی ہے۔';

  @override
  String get tyreActionRotateSubmit => 'روٹیشن درج کریں';

  @override
  String get tyreActionRotateToRequiredTitle => 'نئی جگہ درکار ہے';

  @override
  String get tyreActionRotateToRequiredMessage =>
      'وہ جگہ درج کریں جہاں یہ ٹائر منتقل کیا گیا۔';

  @override
  String get tyreActionRotateSamePositionMessage =>
      'نئی جگہ موجودہ جگہ سے مختلف ہونی چاہیے۔';

  @override
  String get tyreActionRotateSavedTitle => 'روٹیشن درج ہو گئی';

  @override
  String get tyreActionRotateSavedMessage =>
      'روٹیشن اس ٹائر کی سروس ہسٹری میں محفوظ ہو گئی ہے۔ اس سے ٹائر رجسٹر میں دکھائی گئی جگہ تبدیل نہیں ہوتی۔';

  @override
  String get tyreActionRotateFailedTitle => 'روٹیشن محفوظ نہیں ہوئی';

  @override
  String get tyreActionRotateOfflineMessage =>
      'کنکشن نہیں ہے۔ روٹیشن صرف آن لائن محفوظ ہوتی ہے، اس لیے یہ درج نہیں ہوئی۔ کنکشن ملنے پر دوبارہ کوشش کریں۔';

  @override
  String get tyreActionRotateFailedMessage =>
      'روٹیشن محفوظ نہیں ہو سکی۔ دوبارہ کوشش کریں۔';

  @override
  String driverWsTerm(String term) {
    String _temp0 = intl.Intl.selectLogic(
      term,
      {
        'create_driver': 'تصدیق شدہ ڈرائیور شامل کریں',
        'link_account': 'لاگ ان اکاؤنٹ منسلک کریں',
        'assign_team': 'ٹیم اور گاڑی تفویض کریں',
        'create_fine': 'ٹریفک جرمانہ درج کریں',
        'link_record': 'کام کا ریکارڈ منسلک کریں',
        'respond_fine': 'جائزہ لیں اور دستخط کریں',
        'review_fine': 'جواب یا ادائیگی کا جائزہ',
        'correct_fine': 'جرمانہ درست کریں',
        'reassign_fine': 'جرمانہ دوبارہ تفویض کریں',
        'direct_payment': 'میں براہ راست ادائیگی کروں گا',
        'already_paid': 'پہلے ہی ادا کر دیا ہے',
        'dispute': 'اعتراض یا غلط تفویض',
        'company_recovery': 'کمپنی کی ادائیگی یا وصولی کی درخواست',
        'instalments': 'قسطوں کی درخواست',
        'approve': 'درخواست منظور کریں',
        'return': 'ڈرائیور کو واپس بھیجیں',
        'payment': 'تصدیق شدہ ادائیگی درج کریں',
        'cancel': 'جرمانہ منسوخ کریں',
        'reopen': 'دوبارہ کھولیں',
        'open': 'کھلا',
        'settled': 'ادا شدہ',
        'cancelled': 'منسوخ',
        'awaiting_response': 'جواب کا انتظار',
        'submitted': 'جواب جمع ہو گیا',
        'returned': 'ڈرائیور کو واپس',
        'approved': 'منظور شدہ',
        'driver_documents': 'ڈرائیور کے دستاویزات',
        'driver_training': 'ڈرائیور کی تربیت',
        'driver_coaching': 'ڈرائیور کی رہنمائی',
        'driver_safety_events': 'ڈرائیور کے حفاظتی واقعات',
        'driver_expenses': 'ڈرائیور کے اخراجات',
        'tyre_records': 'ٹائر کے ریکارڈ',
        'accidents': 'حادثات',
        'wo_tasks': 'ورک آرڈر کے کام',
        'checklist_submissions': 'جمع شدہ چیک لسٹیں',
        'odometer_logs': 'اوڈومیٹر ریڈنگز',
        'wash_records': 'دھلائی کے ریکارڈ',
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
        'country': 'ملک',
        'site': 'مقام',
        'asset_no': 'اثاثہ نمبر',
        'driver_name': 'ڈرائیور کا نام',
        'title': 'عنوان',
        'doc_type': 'دستاویز کی قسم',
        'doc_number': 'دستاویز نمبر',
        'expiry_date': 'میعاد ختم ہونے کی تاریخ',
        'course_name': 'کورس کا نام',
        'result': 'نتیجہ',
        'completed_date': 'تکمیل کی تاریخ',
        'coaching_status': 'رہنمائی کی حالت',
        'period': 'مدت',
        'event_type': 'واقعے کی قسم',
        'severity': 'شدت',
        'event_at': 'واقعے کا وقت',
        'category': 'زمرہ',
        'amount': 'رقم',
        'currency': 'کرنسی',
        'expense_date': 'خرچ کی تاریخ',
        'status': 'حالت',
        'incident_date': 'واقعے کی تاریخ',
        'accident_type': 'حادثے کی قسم',
        'due_date': 'آخری تاریخ',
        'created_at': 'بنانے کی تاریخ',
        'reading_date': 'ریڈنگ کی تاریخ',
        'odometer_km': 'اوڈومیٹر (کلومیٹر)',
        'wash_date': 'دھلائی کی تاریخ',
        'template_name': 'چیک لسٹ کا نام',
        'approval_status': 'منظوری کی حالت',
        'brand': 'برانڈ',
        'serial_no': 'سیریل نمبر',
        'issue_date': 'اجراء کی تاریخ',
        'qty': 'مقدار',
        'cost_per_tyre': 'فی ٹائر لاگت',
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
        'payment': 'ادائیگی کی رسید',
        'supporting': 'معاون تصویر',
        'notice': 'سرکاری نوٹس',
        'other': '',
      },
    );
    return '$_temp0';
  }

  @override
  String get driverWsTitle => 'ڈرائیور کا کام';

  @override
  String get driverWsEntrySubtitle =>
      'میرے جرمانے، ٹیم کی ذمہ داریاں اور تصدیق شدہ کام';

  @override
  String get driverWsLoadError =>
      'کام کی جگہ دستیاب نہیں۔ رابطہ، اکاؤنٹ کا ربط اور اجازت چیک کریں، پھر تازہ کریں۔';

  @override
  String get driverWsRefresh => 'تازہ کریں';

  @override
  String get driverWsSignInRequired => 'اپنا کام دیکھنے کے لیے سائن ان کریں۔';

  @override
  String get driverWsOfflineNotice =>
      'آف لائن محفوظ منظر۔ جواب یا جائزے سے پہلے رابطہ بحال کرکے تازہ کریں۔';

  @override
  String get driverWsTruncatedNotice =>
      'یہ منظر نامکمل ہے کیونکہ ریکارڈ کی حد پوری ہو گئی۔ ایکسپورٹ بند ہے۔';

  @override
  String get driverWsSearchDrivers => 'ڈرائیور تلاش کریں';

  @override
  String get driverWsNoDrivers =>
      'کوئی منسلک ڈرائیور یا تفویض شدہ ٹیم موجود نہیں۔ مجاز منیجر سے اکاؤنٹ اور ذمہ داری کی تصدیق کروائیں۔';

  @override
  String get driverWsSharePdf => 'جرمانوں کی PDF تفصیل شیئر کریں';

  @override
  String get driverWsReportShareError =>
      'رپورٹ شیئر نہیں ہو سکی۔ دوبارہ کوشش کریں۔';

  @override
  String get driverWsTrafficFines => 'ٹریفک جرمانے';

  @override
  String get driverWsNoFines => 'کوئی جرمانہ درج نہیں ہے۔';

  @override
  String get driverWsAssignmentHistory => 'ٹیم اور گاڑی کی ذمہ داریوں کی تاریخ';

  @override
  String get driverWsNoAssignment => 'کوئی ذمہ داری درج نہیں ہے۔';

  @override
  String get driverWsAssignmentCurrent => 'موجودہ';

  @override
  String get driverWsAssignmentPrevious => 'سابقہ';

  @override
  String get driverWsNoVehicle => 'کوئی گاڑی نہیں';

  @override
  String get driverWsNotAssigned => 'تفویض نہیں';

  @override
  String get driverWsPresent => 'اب تک';

  @override
  String get driverWsAssignedWork => 'تفویض شدہ کام';

  @override
  String get driverWsNotSupplied => 'فراہم نہیں کیا گیا';

  @override
  String get driverWsVerifiedRecords => 'تصدیق شدہ کام اور ڈرائیور کے ریکارڈ';

  @override
  String get driverWsUnmatchedNotice =>
      'پرانے غیر منسلک ریکارڈ یہاں ظاہر ہونے سے پہلے شناخت کی تصدیق چاہتے ہیں۔';

  @override
  String get driverWsRecordUnavailable => 'ریکارڈ اب دستیاب نہیں';

  @override
  String get driverWsActivityHistory => 'سرگرمی کی تاریخ';

  @override
  String get driverWsRecordedUser => 'درج شدہ صارف';

  @override
  String get driverWsPhotoError =>
      'تصویر منسلک نہیں ہو سکی۔ آپ کی مقامی تصویر حذف نہیں ہوئی۔';

  @override
  String get driverWsAcknowledgeRespond => 'وصولی تسلیم کریں اور جواب دیں';

  @override
  String get driverWsReviewPayment => 'جائزہ لیں یا ادائیگی درج کریں';

  @override
  String get driverWsEvidenceOpenError => 'ثبوت نہیں کھل سکا۔';

  @override
  String get driverWsAttachReceipt => 'رسید کی تصویر منسلک کریں';

  @override
  String get driverWsAttachSupporting => 'معاون تصویر منسلک کریں';

  @override
  String get driverWsAttachNotice => 'سرکاری نوٹس کی تصویر منسلک کریں';

  @override
  String get driverWsSignatureUnavailable => 'دستخط دستیاب نہیں۔';

  @override
  String get driverWsViewSignature => 'دستخط شدہ رسید دیکھیں';

  @override
  String get driverWsSignatureDisplayError => 'دستخط دکھایا نہیں جا سکا۔';

  @override
  String get driverWsReceiptStatement =>
      'میں اس نوٹس کی وصولی اور جائزے کی تصدیق کرتا ہوں اور اوپر دیا گیا جواب جمع کرتا ہوں۔ وصولی ذمہ داری قبول کرنے کا اقرار نہیں ہے۔ ادائیگی یا وصولی کی درخواست خودکار ادائیگی یا تنخواہ کی کٹوتی کی اجازت نہیں دیتی۔';

  @override
  String get driverWsDraftReadError =>
      'محفوظ مسودہ پڑھا نہیں جا سکا۔ کچھ بھی تبدیل نہیں ہوا۔';

  @override
  String get driverWsSubmitError =>
      'جمع نہیں ہو سکا۔ لازمی خانے اور رابطہ چیک کریں۔ نوٹس بدل گیا ہو تو تازہ کریں۔';

  @override
  String get driverWsConnectionRequired =>
      'جمع کرنے کے لیے رابطہ ضروری ہے تاکہ موجودہ نوٹس اور آپ کی اجازت کی جانچ ہو۔';

  @override
  String get driverWsDraftSaved => 'مسودہ محفوظ ہو گیا۔ ابھی جمع نہیں ہوا۔';

  @override
  String get driverWsDraftSaveError => 'مسودہ محفوظ نہیں ہو سکا۔';

  @override
  String get driverWsSaveDraft => 'اس آلے پر مسودہ محفوظ کریں';

  @override
  String get driverWsReviewDisclaimer =>
      'منظوری جائزہ شدہ انتظام درج کرتی ہے۔ یہ ادائیگی یا تنخواہ سے کٹوتی نہیں کرتی۔ صرف تصدیق شدہ ادائیگیاں درج کریں۔';

  @override
  String get driverWsSaving => 'محفوظ ہو رہا ہے...';

  @override
  String get driverWsSubmit => 'جمع کریں';

  @override
  String get driverWsErrResolution => 'حل کا انتخاب کریں۔';

  @override
  String get driverWsErrExplanation =>
      'اپنی درخواست کی وضاحت کریں، مجوزہ انتظام سمیت۔';

  @override
  String get driverWsErrPaymentReference => 'اپنی ادائیگی کا حوالہ درج کریں۔';

  @override
  String get driverWsErrProposedDate =>
      'اپنی مجوزہ ادائیگی کی تاریخ منتخب کریں۔';

  @override
  String get driverWsErrSignature =>
      'جمع کرنے سے پہلے بیان کا جائزہ لیں اور دستخط کریں۔';

  @override
  String get driverWsOptionsError => 'اختیارات دستیاب نہیں۔ دوبارہ کوشش کریں۔';

  @override
  String get driverWsSearch => 'تلاش';

  @override
  String get driverWsClearSelection => 'کوئی نہیں یا انتخاب ختم کریں';

  @override
  String get driverWsPreviousOptions => 'پچھلے اختیارات';

  @override
  String get driverWsMoreOptions => 'مزید اختیارات';

  @override
  String get driverWsFieldEmployeeId => 'ملازم نمبر';

  @override
  String get driverWsFieldDriverName => 'ڈرائیور کا نام';

  @override
  String get driverWsFieldCountry => 'ملک';

  @override
  String get driverWsFieldSite => 'مقام';

  @override
  String get driverWsFieldLoginAccount =>
      'لاگ ان اکاؤنٹ (کوئی نہیں سے ربط ختم ہوگا)';

  @override
  String get driverWsFieldIdentityReason => 'شناخت کی تصدیق یا وجہ';

  @override
  String get driverWsFieldSupervisor => 'نگران';

  @override
  String get driverWsFieldManager => 'منیجر';

  @override
  String get driverWsFieldVehicle => 'گاڑی';

  @override
  String get driverWsFieldAssignmentReason => 'تفویض کی وجہ';

  @override
  String get driverWsFieldAuthority => 'جاری کرنے والا ادارہ';

  @override
  String get driverWsFieldNoticeReference => 'نوٹس کا حوالہ';

  @override
  String get driverWsFieldIncidentAt =>
      'واقعے کی تاریخ اور وقت (YYYY-MM-DDTHH:mm)';

  @override
  String get driverWsFieldDueDate => 'آخری تاریخ (YYYY-MM-DD)';

  @override
  String get driverWsFieldAmount => 'جرمانے کی رقم';

  @override
  String get driverWsFieldCurrency => 'کرنسی کوڈ';

  @override
  String get driverWsFieldNoticeDetails => 'نوٹس کی تفصیلات';

  @override
  String get driverWsFieldAssignmentEvidence =>
      'ڈرائیور کی ذمہ داری کی تصدیق کا ثبوت';

  @override
  String get driverWsFieldRecordType => 'ریکارڈ کی قسم';

  @override
  String get driverWsFieldExistingRecord => 'موجودہ ریکارڈ';

  @override
  String get driverWsFieldIdentityMethod =>
      'ڈرائیور کی شناخت کیسے تصدیق کی گئی';

  @override
  String get driverWsFieldResolution => 'مطلوبہ حل';

  @override
  String get driverWsFieldExplanation => 'وضاحت یا مجوزہ انتظام';

  @override
  String get driverWsFieldPaymentReference =>
      'ادائیگی کا حوالہ (اگر ادا ہو چکا ہے)';

  @override
  String get driverWsFieldProposedDate => 'مجوزہ ادائیگی کی تاریخ (YYYY-MM-DD)';

  @override
  String get driverWsFieldDecision => 'فیصلہ';

  @override
  String get driverWsFieldReviewReason => 'جائزے کی وجہ یا منظور شدہ انتظام';

  @override
  String get driverWsFieldVerifiedReference => 'تصدیق شدہ ادائیگی کا حوالہ';

  @override
  String get driverWsFieldVerifiedAmount => 'تصدیق شدہ ادائیگی کی رقم';

  @override
  String get driverWsPdfColNotice => 'نوٹس';

  @override
  String get driverWsPdfColCurrency => 'کرنسی';

  @override
  String get driverWsPdfColAmount => 'رقم';

  @override
  String get driverWsPdfColPaid => 'ادا شدہ';

  @override
  String get driverWsPdfColStatus => 'حالت';

  @override
  String get driverWsPdfColResponse => 'جواب';

  @override
  String driverWsDriverSubtitle(String site, String open, String awaiting) {
    return '$site · $open کھلے جرمانے · $awaiting جواب کے منتظر';
  }

  @override
  String driverWsOutstanding(String amount, String currency) {
    return 'واجب الادا: $amount $currency';
  }

  @override
  String driverWsSupervisorLine(String name) {
    return 'نگران: $name';
  }

  @override
  String driverWsManagerLine(String name) {
    return 'منیجر: $name';
  }

  @override
  String driverWsAssignmentPeriod(String start, String end) {
    return '$start سے $end تک';
  }

  @override
  String driverWsAssignmentLine(String reason) {
    return 'تفویض: $reason';
  }

  @override
  String driverWsDueLine(String due, String paid) {
    return 'آخری تاریخ: $due · ادا شدہ: $paid';
  }

  @override
  String driverWsPdfTitle(String name) {
    return 'ڈرائیور کا گوشوارہ: $name';
  }

  @override
  String driverWsPdfEmployeeId(String id) {
    return 'ملازم نمبر: $id';
  }

  @override
  String get vehicleClassTransitMixer => 'ٹرانزٹ مکسر';

  @override
  String get vehicleClassConcretePump => 'کنکریٹ پمپ';

  @override
  String get vehicleClassLinePump => 'ٹرک پر نصب لائن پمپ';

  @override
  String get vehicleClassStaffBus => 'اسٹاف بس';

  @override
  String get vehicleClassStaffVan => 'اسٹاف وین';

  @override
  String get vehicleClassDoubleCabPickup => 'ڈبل کیبن پک اپ';

  @override
  String get vehicleClassWheelLoader => 'وہیل لوڈر';

  @override
  String get vehicleClassSkidSteerLoader => 'اسکڈ اسٹیئر لوڈر';

  @override
  String get vehicleClassTowablePump => 'کھینچا جانے والا کنکریٹ پمپ';

  @override
  String get vehicleClassStationaryPump => 'ساکن کنکریٹ پمپ';

  @override
  String get vehicleClassGenerator => 'بند جنریٹر';

  @override
  String get vehicleClassChiller => 'صنعتی چلر';

  @override
  String get vehicleClassWaterChiller => 'صنعتی واٹر چلر';

  @override
  String get vehicleClassBatchingPlant => 'کنکریٹ بیچنگ پلانٹ';

  @override
  String get vehicleClassPlacingBoom => 'آزاد کھڑا پلیسنگ بوم';

  @override
  String vehicleClassConcretePumpAxles(int axles) {
    return 'کنکریٹ پمپ · $axles ایکسل';
  }

  @override
  String vehicleClassLinePumpAxles(int axles) {
    return 'ٹرک پر نصب لائن پمپ · $axles ایکسل';
  }

  @override
  String get scannerCameraStartFailedTitle => 'کیمرا شروع نہیں ہو سکا';

  @override
  String get scannerCameraStartFailedMessage =>
      'ہو سکتا ہے کوئی اور ایپ اسے استعمال کر رہی ہو یا یہ اچانک رک گیا ہو۔ دوبارہ کوشش کریں یا نیچے کوڈ لکھیں۔';

  @override
  String get managementOverviewSiteRollup => 'مقامات ایک نظر میں';

  @override
  String get managementOverviewSiteRollupEmpty =>
      'اس مدت میں کسی مقام پر ٹائر درج نہیں ہوئے۔';

  @override
  String get managementOverviewAtRiskShare => 'زیادہ یا انتہائی خطرے والے ٹائر';

  @override
  String get managementReportsShare => 'رپورٹ PDF شیئر کریں';

  @override
  String get managementReportsShareError =>
      'رپورٹ شیئر نہیں ہو سکی۔ دوبارہ کوشش کریں۔';

  @override
  String get managementReportsPdfMetric => 'پیمانہ';

  @override
  String get managementReportsPdfValue => 'قدر';

  @override
  String get managementReportsPdfShare => 'حصہ';

  @override
  String get managementTeamRole => 'کردار';

  @override
  String get managementTeamUsername => 'صارف نام';

  @override
  String get managementTeamSite => 'مقام';

  @override
  String get managementTeamCountry => 'ملک';

  @override
  String get managementTeamPhone => 'فون';

  @override
  String get managementTeamEmail => 'ای میل';

  @override
  String get managementTeamStatus => 'حالت';

  @override
  String get managementTeamApproved => 'منظور شدہ';

  @override
  String get managementTeamLastLogin => 'آخری سائن ان';

  @override
  String get managementTeamNotRecorded => 'درج نہیں';

  @override
  String get managementTeamCall => 'کال کریں';

  @override
  String get managementTeamSendEmail => 'ای میل بھیجیں';

  @override
  String get managementTeamActionError => 'یہ عمل اس آلے پر دستیاب نہیں۔';

  @override
  String managementOverviewSiteTyres(String count) {
    return '$count ٹائر';
  }

  @override
  String managementOverviewSiteShare(String percent) {
    return 'بیڑے کے ٹائروں کا $percent%';
  }

  @override
  String managementReportsPdfPeriod(int days) {
    return 'مدت: آخری $days دن';
  }

  @override
  String managementReportsPdfCurrency(String code) {
    return 'کرنسی: $code';
  }

  @override
  String get adminHubTitle => 'ایڈمن کنسول';

  @override
  String get adminHubSubtitle => 'صارفین، رسائی، منظوریاں اور سائٹس';

  @override
  String get adminHubPendingApprovals => 'زیر التوا منظوریاں';

  @override
  String get adminHubPendingSignups => 'زیر التوا رجسٹریشن';

  @override
  String get adminHubLockedUsers => 'مقفل صارفین';

  @override
  String get adminHubCountUnavailable => 'لوڈ نہیں ہو سکا';

  @override
  String get adminHubSectionManage => 'انتظام';

  @override
  String get adminHubSectionMore => 'رپورٹس اور ٹیم';

  @override
  String get adminHubUsersTitle => 'صارفین';

  @override
  String get adminHubUsersSubtitle => 'منظوری، مقفل کرنا اور کردار بدلنا';

  @override
  String get adminHubAccessTitle => 'موبائل رسائی';

  @override
  String get adminHubAccessSubtitle =>
      'ہر فرد کے لیے ایپ ماڈیول کی اجازت یا ممانعت';

  @override
  String get adminHubApprovalsTitle => 'منظوریاں';

  @override
  String get adminHubApprovalsSubtitle => 'دستخط کی منتظر معائنے اور چیک لسٹیں';

  @override
  String get adminHubSitesTitle => 'سائٹس';

  @override
  String get adminHubSitesSubtitle => 'علاقے اور فعال حیثیت';

  @override
  String get adminHubAiTitle => 'فلیٹ اے آئی چیٹ';

  @override
  String get adminHubAiSubtitle => 'فلیٹ مینجمنٹ کے بارے میں سوال پوچھیں';

  @override
  String get adminHubOpenModule => 'یہ ماڈیول کھولیں';

  @override
  String get adminModuleInspect => 'نیا معائنہ';

  @override
  String get adminModuleScan => 'اسکین';

  @override
  String get adminModuleSerial => 'سیریل تلاش';

  @override
  String get adminModuleTyreChange => 'ٹائر کی تبدیلی';

  @override
  String get adminModuleChecklists => 'چیک لسٹیں';

  @override
  String get adminModuleMeter => 'میٹر لاگ';

  @override
  String get adminModuleWashing => 'گاڑیوں کی دھلائی';

  @override
  String get adminModuleReportIssue => 'مسئلے کی اطلاع';

  @override
  String get adminModuleRepairRequest => 'مرمت کی درخواست';

  @override
  String get adminModuleRecords => 'ٹائر ریکارڈز';

  @override
  String get adminModuleVehicles => 'گاڑیاں';

  @override
  String get adminModuleHistory => 'تاریخچہ';

  @override
  String get adminModuleAlerts => 'الرٹس';

  @override
  String get adminModuleCalendar => 'کیلنڈر';

  @override
  String get adminModuleAccidents => 'حادثات';

  @override
  String get adminModuleReportAccident => 'حادثہ درج کریں';

  @override
  String get adminModuleWorkorders => 'ورک آرڈرز';

  @override
  String get adminModuleRca => 'بنیادی وجہ';

  @override
  String get adminModuleTasks => 'کام';

  @override
  String get adminModuleStock => 'اسٹاک گنتی';

  @override
  String get adminModulePm => 'واجب الادا دیکھ بھال';

  @override
  String get adminModuleWorkshop => 'میرے کام';

  @override
  String get adminModuleOverview => 'جائزہ';

  @override
  String get adminModuleReports => 'رپورٹس';

  @override
  String get adminModuleAnalytics => 'تجزیات';

  @override
  String get adminModuleStockManage => 'اسٹاک مینجمنٹ';

  @override
  String get adminModuleAi => 'فلیٹ اے آئی';

  @override
  String get adminModuleTeam => 'ٹیم';

  @override
  String get adminModuleApprovals => 'منظوریاں';

  @override
  String get adminModuleAdmin => 'ایڈمن کنسول';

  @override
  String get adminModuleUsers => 'صارفین کا انتظام';

  @override
  String get adminUsersTitle => 'صارفین';

  @override
  String adminUsersCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count صارفین',
      one: '1 صارف',
    );
    return '$_temp0';
  }

  @override
  String get adminUsersSearchHint => 'نام، یوزر نیم یا ملازم نمبر سے تلاش کریں';

  @override
  String get adminUsersFilterAll => 'سب';

  @override
  String get adminUsersStatusPending => 'زیر التوا';

  @override
  String get adminUsersStatusActive => 'فعال';

  @override
  String get adminUsersStatusLocked => 'مقفل';

  @override
  String get adminUsersAllRoles => 'تمام کردار';

  @override
  String get adminUsersEmptyTitle => 'کوئی صارف نہیں ملا';

  @override
  String get adminUsersEmptyMessage => 'کوئی اور تلاش یا فلٹر آزمائیں۔';

  @override
  String get adminUsersLoadFailed => 'صارفین لوڈ نہیں ہو سکے۔';

  @override
  String get adminUsersReadOnlyNote =>
      'صرف سپر ایڈمن صارفین میں تبدیلی کر سکتا ہے۔ آپ فہرست دیکھ سکتے ہیں۔';

  @override
  String get adminUsersSelfNote =>
      'یہ آپ کا اپنا اکاؤنٹ ہے۔ آپ اسے مقفل یا اس کا کردار تبدیل نہیں کر سکتے۔';

  @override
  String get adminUsersNoName => 'بے نام صارف';

  @override
  String get adminUsersNoRole => 'کوئی کردار تفویض نہیں';

  @override
  String get adminUsersSuperAdminBadge => 'سپر ایڈمن';

  @override
  String get adminUsersFieldRole => 'کردار';

  @override
  String get adminUsersFieldUsername => 'یوزر نیم';

  @override
  String get adminUsersFieldEmployeeId => 'ملازم نمبر';

  @override
  String get adminUsersFieldEmail => 'ای میل';

  @override
  String get adminUsersFieldSite => 'سائٹ';

  @override
  String get adminUsersFieldCountry => 'ملک';

  @override
  String get adminUsersFieldJoined => 'شمولیت';

  @override
  String get adminUsersFieldPendingReason => 'رجسٹریشن نوٹ';

  @override
  String get adminUsersActionApprove => 'منظور کریں';

  @override
  String get adminUsersActionLock => 'مقفل کریں';

  @override
  String get adminUsersActionUnlock => 'غیر مقفل کریں';

  @override
  String get adminUsersActionDeactivate => 'غیر فعال کریں';

  @override
  String get adminUsersActionSetRole => 'کردار تبدیل کریں';

  @override
  String get adminUsersConfirmApproveTitle => 'اس صارف کو منظور کریں؟';

  @override
  String adminUsersConfirmApproveMessage(String name) {
    return '$name سائن ان کر کے ایپ استعمال کر سکے گا۔';
  }

  @override
  String get adminUsersConfirmLockTitle => 'اس صارف کو مقفل کریں؟';

  @override
  String adminUsersConfirmLockMessage(String name) {
    return '$name غیر مقفل ہونے تک سائن ان نہیں کر سکے گا۔';
  }

  @override
  String get adminUsersConfirmUnlockTitle => 'اس صارف کو غیر مقفل کریں؟';

  @override
  String adminUsersConfirmUnlockMessage(String name) {
    return '$name دوبارہ سائن ان کر سکے گا۔';
  }

  @override
  String get adminUsersDeactivateTitle => 'اس صارف کو غیر فعال کریں';

  @override
  String adminUsersDeactivateMessage(String name) {
    return '$name کی رسائی ختم ہو جائے گی اور اکاؤنٹ مقفل ہو گا۔ وجہ لازمی ہے۔';
  }

  @override
  String get adminUsersSetRoleTitle => 'کردار تبدیل کریں';

  @override
  String adminUsersSetRoleMessage(String name) {
    return '$name کے لیے نیا کردار منتخب کریں۔ وجہ لازمی ہے۔';
  }

  @override
  String get adminUsersReasonLabel => 'وجہ';

  @override
  String get adminUsersReasonRequired => 'وجہ درج کریں۔';

  @override
  String get adminUsersRoleRequired => 'کردار منتخب کریں۔';

  @override
  String get adminUsersActionDone => 'محفوظ ہو گیا۔';

  @override
  String get adminUsersActionFailed => 'تبدیلی محفوظ نہیں ہو سکی۔';

  @override
  String get adminAccessTitle => 'موبائل رسائی';

  @override
  String get adminAccessPickUser => 'کسی فرد کو منتخب کریں';

  @override
  String get adminAccessChangeUser => 'فرد تبدیل کریں';

  @override
  String get adminAccessIntro =>
      'تبدیلیاں صرف اس فرد کی موبائل ایپ پر لاگو ہوتی ہیں۔ ڈیفالٹ ان کے کردار کے مطابق ہے۔';

  @override
  String get adminAccessDefault => 'ڈیفالٹ';

  @override
  String get adminAccessAllow => 'اجازت';

  @override
  String get adminAccessDeny => 'ممانعت';

  @override
  String get adminAccessRoleDefaultAllowed => 'کردار کا ڈیفالٹ: اجازت ہے';

  @override
  String get adminAccessRoleDefaultDenied => 'کردار کا ڈیفالٹ: اجازت نہیں';

  @override
  String get adminAccessRoleDefaultAdminOnly => 'ڈیفالٹ طور پر صرف ایڈمن';

  @override
  String get adminAccessAdminNote =>
      'ایڈمن اور سپر ایڈمن کی مکمل رسائی ہمیشہ برقرار رہتی ہے۔';

  @override
  String get adminAccessReadOnlyNote => 'صرف سپر ایڈمن رسائی تبدیل کر سکتا ہے۔';

  @override
  String get adminAccessLoadFailed => 'اس فرد کی رسائی لوڈ نہیں ہو سکی۔';

  @override
  String get adminAccessSaveFailed => 'رسائی اپ ڈیٹ نہیں ہو سکی۔';

  @override
  String get adminAccessSaved => 'رسائی اپ ڈیٹ ہو گئی۔';

  @override
  String get adminAccessGroupField => 'فیلڈ';

  @override
  String get adminAccessGroupFleet => 'فلیٹ';

  @override
  String get adminAccessGroupMaintenance => 'دیکھ بھال';

  @override
  String get adminAccessGroupManagement => 'انتظامیہ';

  @override
  String get adminAccessGroupAdmin => 'ایڈمن';

  @override
  String get adminApprovalsTabInspections => 'معائنے';

  @override
  String get adminApprovalsTabChecklists => 'چیک لسٹیں';

  @override
  String get adminSitesTitle => 'سائٹس';

  @override
  String adminSitesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count سائٹس',
      one: '1 سائٹ',
    );
    return '$_temp0';
  }

  @override
  String get adminSitesSearchHint => 'سائٹ، علاقہ یا کوڈ تلاش کریں';

  @override
  String get adminSitesActive => 'فعال';

  @override
  String get adminSitesInactive => 'غیر فعال';

  @override
  String get adminSitesNoRegion => 'کوئی علاقہ نہیں';

  @override
  String get adminSitesEmptyTitle => 'کوئی سائٹ نہیں';

  @override
  String get adminSitesEmptyMessage =>
      'آپ کی تنظیم کے لیے ابھی کوئی سائٹ درج نہیں ہے۔';

  @override
  String get adminSitesLoadFailed => 'سائٹس لوڈ نہیں ہو سکیں۔';

  @override
  String get adminSitesReadOnlyNote =>
      'صرف ایڈمن یا مینیجر سائٹس میں ترمیم کر سکتا ہے۔';

  @override
  String get adminSitesEditTitle => 'سائٹ میں ترمیم';

  @override
  String get adminSitesRegionLabel => 'علاقہ';

  @override
  String get adminSitesActiveLabel => 'فعال سائٹ';

  @override
  String get adminSitesSave => 'محفوظ کریں';

  @override
  String get adminSitesSaved => 'سائٹ اپ ڈیٹ ہو گئی۔';

  @override
  String get adminSitesSaveFailed => 'سائٹ اپ ڈیٹ نہیں ہو سکی۔';

  @override
  String get adminAiTitle => 'فلیٹ اے آئی چیٹ';

  @override
  String get adminAiSubtitle =>
      'جوابات اے آئی سروس سے آتے ہیں۔ اہم اعداد ایپ میں چیک کریں۔';

  @override
  String get adminAiHint => 'فلیٹ مینجمنٹ کے بارے میں پوچھیں';

  @override
  String get adminAiSend => 'بھیجیں';

  @override
  String get adminAiClear => 'چیٹ صاف کریں';

  @override
  String get adminAiEmptyTitle => 'سوال پوچھیں';

  @override
  String get adminAiEmptyMessage =>
      'مثلاً، فی کلومیٹر ٹائر کی لاگت کیسے کم کی جائے۔';

  @override
  String get adminAiThinking => 'سوچ رہا ہے';

  @override
  String get adminAiYou => 'آپ';

  @override
  String get adminAiAssistant => 'فلیٹ اے آئی';

  @override
  String get adminAiErrorDisabled =>
      'اے آئی خصوصیات آپ کے ایڈمن نے بند کر رکھی ہیں۔';

  @override
  String get adminAiErrorBudget => 'ماہانہ اے آئی بجٹ پورا ہو چکا ہے۔';

  @override
  String get adminAiErrorRateLimit =>
      'بہت زیادہ درخواستیں۔ تھوڑی دیر انتظار کر کے دوبارہ کوشش کریں۔';

  @override
  String get adminAiErrorEmpty => 'اے آئی سروس نے کوئی جواب نہیں دیا۔';

  @override
  String get adminAiErrorUnavailable =>
      'اے آئی سروس ابھی دستیاب نہیں۔ کچھ دیر بعد کوشش کریں۔';

  @override
  String get extrasFleetAiTitle => 'فلیٹ اے آئی';

  @override
  String get extrasFleetAiSubtitle => 'آپ کے فلیٹ کے تازہ ڈیٹا سے جوابات';

  @override
  String get extrasFleetAiSnapshotLoading => 'فلیٹ کا تازہ ڈیٹا پڑھا جا رہا ہے';

  @override
  String get extrasFleetAiNoData =>
      'فلیٹ کا تازہ ڈیٹا نہیں پڑھا جا سکا، اس لیے معاون ابھی آپ کے ریکارڈ سے جواب نہیں دے سکتا۔';

  @override
  String extrasFleetAiGroundedOn(int n) {
    return 'فلیٹ کی 5 تازہ گنتیوں میں سے $n کی بنیاد پر';
  }

  @override
  String get extrasFleetAiEmptyTitle => 'اپنے فلیٹ کے بارے میں پوچھیں';

  @override
  String get extrasFleetAiEmptyMessage =>
      'معاون صرف آپ کے فلیٹ کی تازہ گنتیوں سے جواب دیتا ہے اور بتائے گا جب کوئی چیز یہاں دستیاب نہ ہو۔';

  @override
  String get extrasFleetAiSuggestedTitle => 'یہ پوچھ کر دیکھیں';

  @override
  String get extrasFleetAiSuggestOverview => 'مجھے فلیٹ کی صحت کا جائزہ دیں';

  @override
  String get extrasFleetAiSuggestRisk =>
      'کتنے ٹائر شدید یا زیادہ خطرے میں ہیں؟';

  @override
  String get extrasFleetAiSuggestActions =>
      'سب سے پہلے کس چیز پر توجہ دینی چاہیے؟';

  @override
  String get extrasFleetAiSuggestAccidents =>
      'پچھلے 30 دنوں میں کتنے حادثات رپورٹ ہوئے؟';

  @override
  String get extrasFleetAiInputHint => 'اپنے فلیٹ کے بارے میں سوال پوچھیں';

  @override
  String get extrasFleetAiSend => 'بھیجیں';

  @override
  String get extrasFleetAiThinking => 'سوچا جا رہا ہے';

  @override
  String get extrasFleetAiClear => 'گفتگو صاف کریں';

  @override
  String get extrasFleetAiDisclaimer =>
      'اے آئی کے جوابات غلط ہو سکتے ہیں۔ کوئی قدم اٹھانے سے پہلے اہم اعداد ایپ میں چیک کریں۔';

  @override
  String get extrasFleetAiYou => 'آپ';

  @override
  String get extrasFleetAiErrDisabled =>
      'آپ کے منتظم نے اے آئی کی سہولیات بند کر دی ہیں۔';

  @override
  String get extrasFleetAiErrBudget =>
      'اے آئی کا ماہانہ بجٹ ختم ہو گیا ہے۔ اپنے منتظم سے رابطہ کریں۔';

  @override
  String get extrasFleetAiErrRateLimited =>
      'مختصر وقت میں بہت زیادہ سوالات۔ تھوڑا انتظار کر کے دوبارہ کوشش کریں۔';

  @override
  String get extrasFleetAiErrOffline =>
      'کنکشن نہیں ہے۔ آپ کا سوال نہیں بھیجا گیا۔';

  @override
  String get extrasFleetAiErrUnavailable =>
      'معاون اس وقت دستیاب نہیں ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔';

  @override
  String get repairReqCatEngine => 'انجن';

  @override
  String get repairReqCatTransmission => 'ٹرانسمیشن';

  @override
  String get repairReqCatBrakes => 'بریکیں';

  @override
  String get repairReqCatTyres => 'ٹائر';

  @override
  String get repairReqCatHydraulics => 'ہائیڈرولکس';

  @override
  String get repairReqCatElectrical => 'برقی نظام';

  @override
  String get repairReqCatBody => 'باڈی';

  @override
  String get repairReqCatDrumMixer => 'ڈرم / مکسر';

  @override
  String get repairReqCatPump => 'پمپ';

  @override
  String get repairReqCatAirSystem => 'ایئر سسٹم';

  @override
  String get repairReqCatCooling => 'کولنگ';

  @override
  String get repairReqCatOther => 'دیگر';

  @override
  String get repairReqTitle => 'مرمت کی درخواست';

  @override
  String get repairReqSubtitle => 'ورکشاپ کو خرابی کی اطلاع دیں';

  @override
  String get repairReqMachine => 'مشین';

  @override
  String get repairReqChooseAsset => 'مشین منتخب کریں';

  @override
  String get repairReqSelect => 'منتخب کریں';

  @override
  String get repairReqChange => 'تبدیل کریں';

  @override
  String repairReqPlate(String plate) {
    return 'پلیٹ $plate';
  }

  @override
  String get repairReqErrAsset => 'وہ مشین منتخب کریں جس میں خرابی ہے۔';

  @override
  String get repairReqSite => 'سائٹ';

  @override
  String get repairReqSiteHint => 'مشین کی رجسٹرڈ سائٹ سے بھرا جاتا ہے';

  @override
  String get repairReqCategory => 'کیا خرابی ہے';

  @override
  String get repairReqDescription => 'خرابی بیان کریں';

  @override
  String get repairReqDescriptionHint => 'کیا ہوا، آپ کیا دیکھ یا سن رہے ہیں';

  @override
  String get repairReqErrDescription => 'بھیجنے سے پہلے خرابی بیان کریں۔';

  @override
  String get repairReqPriority => 'ترجیح';

  @override
  String get repairReqOdometer => 'اوڈومیٹر (کلومیٹر)';

  @override
  String get repairReqEngineHours => 'انجن کے گھنٹے';

  @override
  String get repairReqOptional => 'اختیاری';

  @override
  String get repairReqErrMeter =>
      'صفر یا اس سے زیادہ عدد درج کریں، یا خالی چھوڑ دیں۔';

  @override
  String get repairReqOnlineNote =>
      'یہ درخواست براہ راست ورکشاپ کو بھیجی جاتی ہے اور اس کے لیے کنکشن ضروری ہے۔ آر ایف آر نمبر دفتر جاری کرتا ہے۔';

  @override
  String get repairReqSubmit => 'مرمت کی درخواست بھیجیں';

  @override
  String get repairReqErrNoProfile =>
      'آپ کی پروفائل ابھی لوڈ نہیں ہوئی۔ کچھ دیر بعد دوبارہ کوشش کریں۔';

  @override
  String get repairReqErrOffline =>
      'کنکشن نہیں ہے۔ کچھ نہیں بھیجا گیا۔ آپ کی معلومات محفوظ ہیں، سگنل آنے پر دوبارہ بھیجیں۔';

  @override
  String get repairReqErrPermission =>
      'آپ کے اکاؤنٹ کو مرمت کی درخواست دینے کی اجازت نہیں ہے۔ اپنے منتظم سے رابطہ کریں۔';

  @override
  String get repairReqErrFailed =>
      'درخواست نہیں بھیجی جا سکی۔ آپ کی معلومات محفوظ ہیں، دوبارہ کوشش کریں۔';

  @override
  String get repairReqSentTitle => 'مرمت کی درخواست بھیج دی گئی';

  @override
  String repairReqSentWithNumber(String rfr) {
    return 'ورکشاپ کو یہ $rfr کے طور پر موصول ہو گئی ہے۔';
  }

  @override
  String get repairReqSentNoNumber =>
      'ورکشاپ کو یہ موصول ہو گئی ہے۔ دفتر آر ایف آر نمبر جاری کرے گا۔';

  @override
  String get repairReqAnother => 'ایک اور درخواست';

  @override
  String get repairReqDone => 'مکمل';

  @override
  String get repairReqSearchHint => 'اثاثہ، پلیٹ، قسم یا سائٹ سے تلاش کریں';

  @override
  String get repairReqNoAssets =>
      'آپ کے دائرہ کار میں کوئی مشین رجسٹرڈ نہیں ہے۔';

  @override
  String get repairReqNoMatch => 'اس تلاش سے کوئی مشین نہیں ملی۔';

  @override
  String repairReqRefineSearch(int n) {
    return '$n مشینیں ملیں۔ فہرست محدود کرنے کے لیے مزید لکھیں۔';
  }

  @override
  String get repairReqCachedList =>
      'آف لائن: اس ڈیوائس پر محفوظ فلیٹ دکھایا جا رہا ہے۔';

  @override
  String get registerTitle => 'اکاؤنٹ بنائیں';

  @override
  String get registerChecking => 'دیکھا جا رہا ہے کہ رجسٹریشن کھلی ہے یا نہیں';

  @override
  String get registerUnreachableTitle => 'سرور تک رسائی نہیں ہو سکی';

  @override
  String get registerUnreachableMessage =>
      'رجسٹریشن کے لیے کنکشن ضروری ہے۔ سگنل چیک کر کے دوبارہ کوشش کریں۔';

  @override
  String get registerClosedTitle => 'رجسٹریشن بند ہے';

  @override
  String get registerClosedMessage =>
      'اکاؤنٹ آپ کا منتظم بناتا ہے۔ دعوت کے لیے اپنے منتظم سے رابطہ کریں۔';

  @override
  String get registerBackToSignIn => 'سائن ان پر واپس جائیں';

  @override
  String get registerDoneTitle => 'اکاؤنٹ بن گیا';

  @override
  String get registerDoneMessage =>
      'آپ کا اکاؤنٹ منظوری کا منتظر ہے۔ منتظم آپ کا کردار اور سائٹ مقرر کرے گا، پھر آپ سائن ان کر سکیں گے۔';

  @override
  String get registerIntro =>
      'اپنے صارف نام اور ملازم آئی ڈی سے اکاؤنٹ کی درخواست دیں۔ منتظم اسے منظور کر کے آپ کا کردار اور سائٹ مقرر کرتا ہے۔';

  @override
  String get registerFullName => 'پورا نام';

  @override
  String get registerOptional => 'اختیاری';

  @override
  String get registerUsername => 'صارف نام';

  @override
  String get registerUsernameHelp =>
      'کم از کم 3 حروف: حروف، اعداد، نقطہ، انڈر اسکور یا ہائفن';

  @override
  String get registerEmployeeId => 'ملازم آئی ڈی';

  @override
  String get registerPassword => 'پاس ورڈ';

  @override
  String registerPasswordHelp(int n) {
    return 'کم از کم $n حروف';
  }

  @override
  String get registerConfirm => 'پاس ورڈ کی تصدیق';

  @override
  String get registerShowPassword => 'پاس ورڈ دکھائیں';

  @override
  String get registerHidePassword => 'پاس ورڈ چھپائیں';

  @override
  String get registerApprovalNote =>
      'یہاں آپ کردار یا سائٹ منتخب نہیں کر سکتے۔ نئے اکاؤنٹ منتظم کی منظوری تک زیر التوا رہتے ہیں۔';

  @override
  String get registerSubmit => 'اکاؤنٹ کی درخواست کریں';

  @override
  String get registerHaveAccount => 'پہلے سے اکاؤنٹ ہے؟ سائن ان کریں';

  @override
  String get registerErrUsernameShort =>
      'کم از کم 3 حروف کا صارف نام درج کریں۔';

  @override
  String get registerErrUsernameChars =>
      'صرف حروف، اعداد، نقطہ، انڈر اسکور یا ہائفن استعمال کریں۔';

  @override
  String get registerErrEmployeeId => 'اپنی ملازم آئی ڈی درج کریں۔';

  @override
  String registerErrPasswordShort(int n) {
    return 'پاس ورڈ کم از کم $n حروف کا ہونا چاہیے۔';
  }

  @override
  String get registerErrMismatch => 'پاس ورڈ ایک جیسے نہیں ہیں۔';

  @override
  String get registerErrTaken =>
      'یہ صارف نام یا ملازم آئی ڈی پہلے سے استعمال میں ہے۔ کوئی اور منتخب کریں۔';

  @override
  String get registerErrOffline =>
      'کنکشن نہیں ہے۔ آپ کا اکاؤنٹ نہیں بنا۔ سگنل آنے پر دوبارہ کوشش کریں۔';

  @override
  String get registerErrFailed => 'آپ کا اکاؤنٹ نہیں بن سکا۔ دوبارہ کوشش کریں۔';

  @override
  String get loginCreateAccount => 'اکاؤنٹ بنائیں';

  @override
  String get accAssessmentLoadFailed => 'جائزہ لوڈ نہیں ہو سکا';

  @override
  String get accSafetyAndMobility => 'حفاظت اور نقل و حرکت';

  @override
  String get accSafeToMove => 'منتقل کرنا محفوظ ہے';

  @override
  String get accRecoveryTowRequired => 'ریکوری / ٹوئنگ درکار';

  @override
  String get accVehicleOffRoad => 'گاڑی سڑک سے باہر (VOR)';

  @override
  String get accDamageAssessment => 'نقصان کا جائزہ';

  @override
  String accDamageAreaCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count حصے',
      one: '1 حصہ',
    );
    return '$_temp0';
  }

  @override
  String get accNoDamageAreas =>
      'اس کیس پر ابھی تک نقصان کا کوئی حصہ نشان زد نہیں کیا گیا۔';

  @override
  String get accLabourAndPartsEstimate => 'مزدوری اور پرزوں کا تخمینہ';

  @override
  String get accLabourHours => 'مزدوری کے گھنٹے';

  @override
  String get accLabourEstimate => 'مزدوری کا تخمینہ';

  @override
  String get accPartsEstimate => 'پرزوں کا تخمینہ';

  @override
  String get accTotalPreliminaryEstimate => 'کل ابتدائی تخمینہ';

  @override
  String get accPartsAvailable => 'دستیاب پرزے';

  @override
  String get accSpecialOrder => 'خصوصی آرڈر';

  @override
  String get accPartsAvailability => 'پرزوں کی دستیابی';

  @override
  String get accRepairRouteRecommendation => 'مرمت کے راستے کی سفارش';

  @override
  String get accTotalLossPossible => 'مکمل نقصان ممکن';

  @override
  String get accSelectedWorkshop => 'منتخب ورکشاپ';

  @override
  String get accCity => 'شہر';

  @override
  String get accExpectedDurationDays => 'متوقع مدت (دن)';

  @override
  String get accQuotationStatus => 'کوٹیشن کی حالت';

  @override
  String accRequiredAttachments(int count) {
    return 'لازمی منسلکات ($count)';
  }

  @override
  String get accAttachVendorQuotation =>
      'بیرونی ورکشاپ کو بھیجنے کے لیے وینڈر کی کوٹیشن منسلک کریں۔';

  @override
  String get accAfterSubmitNotify => 'جمع کرانے کے بعد اطلاع';

  @override
  String get accSaveAssessment => 'جائزہ محفوظ کریں';

  @override
  String get accAssessmentSubmitted => 'جائزہ جمع ہو گیا';

  @override
  String get accSubmitAssessment => 'جائزہ جمع کریں اور آگے بھیجیں';

  @override
  String get accSubmissionNeedsQuotation =>
      'بیرونی راستے کے لیے جمع کرانے میں وینڈر کی کوٹیشن درکار ہے۔';

  @override
  String accFieldsNotStored(String fields) {
    return 'یہ فیلڈز سرور پر محفوظ نہیں ہو سکیں: $fields۔';
  }

  @override
  String accAssessmentRouted(String route) {
    return 'جائزہ جمع ہو کر $route کو بھیج دیا گیا۔';
  }

  @override
  String get accAssessmentSaved => 'جائزہ محفوظ ہو گیا۔';

  @override
  String accDocumentAttached(String document) {
    return '$document منسلک ہو گئی۔';
  }

  @override
  String get accKm => 'کلومیٹر';

  @override
  String accKmValue(String km) {
    return '$km کلومیٹر';
  }

  @override
  String get accPlate => 'نمبر پلیٹ';

  @override
  String get accSiteLocation => 'سائٹ · مقام';

  @override
  String accViewDamageMap(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'نقصان کا نقشہ دیکھیں · $count حصے',
      one: 'نقصان کا نقشہ دیکھیں · 1 حصہ',
    );
    return '$_temp0';
  }

  @override
  String get accActionNotAssessed => 'کارروائی: ابھی جائزہ نہیں لیا گیا';

  @override
  String accActionValue(String value) {
    return 'کارروائی: $value';
  }

  @override
  String get accRecommended => 'تجویز کردہ';

  @override
  String accUploadNamedDocument(String document) {
    return '$document اپ لوڈ کریں';
  }

  @override
  String get accClaimLoadFailed => 'دعویٰ لوڈ نہیں ہو سکا';

  @override
  String get accClaimExternalRepairBanner => 'بیرونی مرمت کا جائزہ';

  @override
  String get accClaimDocumentPackage => 'دعوے کی دستاویزات کا پیکج';

  @override
  String get accClaimRegistrationLocked =>
      'تمام لازمی دستاویزات مکمل ہونے پر دعوے کا اندراج کھل جائے گا۔';

  @override
  String accRequestDocument(String document) {
    return '$document کی درخواست کریں';
  }

  @override
  String get accUploadDocument => 'دستاویز اپ لوڈ کریں';

  @override
  String get accClaimRegistration => 'دعوے کا اندراج';

  @override
  String get accInsurer => 'بیمہ کمپنی';

  @override
  String get accPolicyNo => 'پالیسی نمبر';

  @override
  String get accClaimNumber => 'دعویٰ نمبر';

  @override
  String get accClaimNumberAuto => 'اندراج کے بعد خودکار طور پر بنے گا';

  @override
  String get accLiability => 'ذمہ داری';

  @override
  String get accGccLiabilityPct => 'GCC کی ذمہ داری %';

  @override
  String get accClaimAmount => 'دعوے کی رقم';

  @override
  String get accDeductible => 'کٹوتی';

  @override
  String get accNetClaimable => 'قابل دعویٰ خالص رقم';

  @override
  String get accClaimRegistered => 'دعویٰ بیمہ کمپنی کے پاس درج ہو گیا';

  @override
  String get accRegisterClaim => 'بیمہ کمپنی کے پاس دعویٰ درج کریں';

  @override
  String get accClaimEnableWhenComplete =>
      'تمام لازمی دستاویزات مکمل ہونے پر فعال ہوگا۔';

  @override
  String get accPaymentAndRecovery => 'ادائیگی اور وصولی';

  @override
  String get accApprovedAmount => 'منظور شدہ رقم';

  @override
  String get accRecoveredAmount => 'وصول شدہ رقم';

  @override
  String get accOutstanding => 'بقایا';

  @override
  String get accRecoverySource => 'وصولی کا ذریعہ';

  @override
  String get accRecoverySourceHint => 'بیمہ کمپنی، تیسرا فریق، ڈرائیور';

  @override
  String get accLastUpdated => 'آخری تازہ کاری';

  @override
  String get accSaveRecovery => 'وصولی محفوظ کریں';

  @override
  String get accUpdateRecovery => 'وصولی کی رقم اپ ڈیٹ کریں';

  @override
  String get accRegisterClaimFirst => 'پہلے دعویٰ درج کریں۔';

  @override
  String get accRecoveryEditableNote =>
      'کیس کی آپریشنل بندش کے بعد بھی وصولی کی رقوم قابل ترمیم رہتی ہیں۔ ہر ترمیم کا وقت درج اور آڈٹ ہوتا ہے۔';

  @override
  String get accAfterRegistrationNotify => 'اندراج کے بعد اطلاع';

  @override
  String get accClaimNotificationIncludes =>
      'اطلاع میں دعویٰ نمبر، دستاویزات کی حالت، دعوے کی رقم اور اگلا قدم شامل ہے۔';

  @override
  String get accSaveClaimDraft => 'دعوے کا مسودہ محفوظ کریں';

  @override
  String get accCompleteDocuments => 'دستاویزات مکمل کریں';

  @override
  String accCommandCenterMonitoring(String owner) {
    return '$owner مقررہ مدت اور نامکمل دستاویزات کی نگرانی کر رہا ہے۔';
  }

  @override
  String accCommandCenterRole(String role) {
    return '$role (کمانڈ سینٹر)';
  }

  @override
  String get accClaimDraftSaved =>
      'دعوے کا مسودہ اس ڈیوائس پر محفوظ ہو گیا۔ کچھ بھیجا نہیں گیا۔';

  @override
  String accDocumentRequestLogged(String document) {
    return '$document کی درخواست کیس میں درج ہو گئی۔';
  }

  @override
  String get accWhichDocument => 'یہ کون سی دستاویز ہے؟';

  @override
  String accDocumentUploaded(String document) {
    return '$document دعوے کے پیکج میں اپ لوڈ ہو گئی۔';
  }

  @override
  String get accClaimRegisterMissing =>
      'پہلے بیمہ کمپنی، پالیسی نمبر اور دعوے کی رقم درج کریں۔';

  @override
  String accRegisterClaimConfirm(
      String claimNo, String insurer, String policyNo) {
    return 'پالیسی $policyNo کے تحت $insurer کے لیے دعویٰ $claimNo کیس میں درج ہو جائے گا۔ ایپ سے اسے واپس نہیں لیا جا سکتا۔';
  }

  @override
  String get accRegister => 'درج کریں';

  @override
  String accClaimRegisteredSnack(String claimNo) {
    return 'دعویٰ $claimNo بیمہ کمپنی کے پاس درج ہو گیا۔';
  }

  @override
  String get accRecoveryMissing => 'وصول شدہ رقم اور اس کا ذریعہ درج کریں۔';

  @override
  String get accRecoveryRecorded => 'وصولی درج ہو گئی۔';

  @override
  String accOptionalSuffix(String label) {
    return '$label (اختیاری)';
  }

  @override
  String get accIntakeFleetMasterLockNote =>
      'یہ تفصیلات فلیٹ ریکارڈ سے لی گئی ہیں اور یہاں تبدیل نہیں ہو سکتیں۔ اگر کوئی تفصیل غلط ہو تو براہ کرم فلیٹ سسٹم میں اسے اپ ڈیٹ کریں۔';

  @override
  String get accIntakeIncidentSiteHelp =>
      'اس واقعے کی سائٹ / مقام منتخب کریں۔ یہ اثاثے کی بنیادی سائٹ سے مختلف ہو سکتی ہے۔';

  @override
  String get accIntakeAssetNo => 'اثاثہ نمبر';

  @override
  String get accIntakeVehicleType => 'گاڑی کی قسم';

  @override
  String get accIntakeMakeModel => 'میک / ماڈل';

  @override
  String get accIntakeHomeSite => 'سائٹ (بنیادی)';

  @override
  String get accIntakeCountry => 'ملک';

  @override
  String get accIntakeCurrentMeter => 'موجودہ میٹر';

  @override
  String get accIntakeStatus => 'حالت';

  @override
  String get accIntakeAssetLoaded => 'اثاثہ فلیٹ ریکارڈ سے لوڈ ہو گیا';

  @override
  String get accIntakeAutoFilled => 'فلیٹ ریکارڈ سے خودکار طور پر بھرا گیا';

  @override
  String get accIntakeWhereOccurred => 'واقعہ کہاں پیش آیا؟';

  @override
  String get accIntakeSiteHint => 'سائٹ یا مقام کا نام';

  @override
  String accIntakeHomeSiteChip(String site) {
    return '$site (بنیادی)';
  }

  @override
  String accIntakeRequiredPhotos(int done, int total) {
    return '$total میں سے $done لازمی تصاویر';
  }

  @override
  String accIntakeMissingCount(int count) {
    return '$count باقی';
  }

  @override
  String get accIntakeAttachedOnDevice => 'اس ڈیوائس پر منسلک';

  @override
  String accIntakeRequiredCategory(String category) {
    return '$category · لازمی';
  }

  @override
  String get accIntakeRemovePhoto => 'تصویر ہٹائیں';

  @override
  String get accIntakeSupportingDocuments => 'معاون دستاویزات';

  @override
  String get accIntakeSupportingDocumentsHelp =>
      'جو ابھی دستیاب ہے منسلک کریں۔ کیس کے جائزے کے دوران راستے اور ملک کے اصول مزید کا تقاضا کر سکتے ہیں۔';

  @override
  String get accIntakeOptionalAtIntake => 'اندراج کے وقت اختیاری';

  @override
  String get accIntakeRemoveAttachment => 'منسلکہ ہٹائیں';

  @override
  String get accIntakeAttachDocumentPhoto => 'دستاویز کی تصویر منسلک کریں';

  @override
  String get accYes => 'ہاں';

  @override
  String get accNo => 'نہیں';

  @override
  String get accCaseSummaryTitle => 'حادثے کے کیس کا خلاصہ';

  @override
  String accCaseSummaryGenerated(String date) {
    return 'تیار کردہ $date';
  }

  @override
  String get accCaseSummaryWorkstreams => 'کیس کے ورک اسٹریمز';

  @override
  String get accCaseSummaryWorkstreamColumn => 'ورک اسٹریم';

  @override
  String get accCaseSummaryTeamColumn => 'ٹیم';

  @override
  String get accCaseSummaryStatusColumn => 'حالت';

  @override
  String get accCaseSummaryProgressColumn => 'پیش رفت';

  @override
  String get accCaseSummaryOverallCompletion => 'مجموعی تکمیل';

  @override
  String get accCaseSummaryEvidencePhotos => 'ثبوت کی تصاویر';

  @override
  String get accCaseSummaryShare => 'کیس کا خلاصہ PDF شیئر کریں';

  @override
  String get accCaseSummaryShareFailed =>
      'کیس کا خلاصہ شیئر نہیں ہو سکا۔ دوبارہ کوشش کریں۔';

  @override
  String get accCaseSummarySharedInEnglish =>
      'عربی فونٹ لوڈ نہیں ہو سکا، اس لیے خلاصہ انگریزی میں شیئر کیا گیا۔';

  @override
  String get accReportDraftRestoreFailed =>
      'محفوظ رپورٹ کا مسودہ بحال نہیں ہو سکا۔ آپ کا محفوظ ڈیٹا تبدیل نہیں ہوا۔';

  @override
  String get accWorkspaceLoading =>
      'آپ کا ورک اسپیس ابھی لوڈ ہو رہا ہے۔ دوبارہ کوشش کریں۔';

  @override
  String get accReportDraftSaveFailed =>
      'یہ ڈیوائس مسودہ محفوظ نہیں کر سکی۔ پہلے سے محفوظ کچھ بھی تبدیل نہیں ہوا۔ دوبارہ کوشش کریں۔';

  @override
  String get accReportUseScannedAsset =>
      'مطابقت رکھنے والا فلیٹ ریکارڈ منتخب کرنے کے لیے اسکین شدہ اثاثہ نمبر استعمال کریں۔';

  @override
  String get accReportAddCloseUpPhoto => 'قریبی تصویر شامل کریں';

  @override
  String get accReportTakePhoto => 'تصویر لیں';

  @override
  String get accReportChooseGallery => 'گیلری سے منتخب کریں';

  @override
  String get accReportQueued => 'رپورٹ آف لائن قطار میں محفوظ ہو گئی۔';

  @override
  String get accReportQueuedWithNotes =>
      'رپورٹ قطار میں شامل ہو گئی۔ کچھ غیر معاون اختیاری فیلڈز اندراج کے نوٹس میں رکھی گئیں۔';

  @override
  String get accReportStepAssetSubtitle =>
      'اس واقعے میں شامل فلیٹ اثاثہ منتخب کریں۔';

  @override
  String get accReportStepIncidentSubtitle => 'درج کریں کب، کہاں اور کیا ہوا۔';

  @override
  String get accReportStepPeopleSubtitle =>
      'موقع پر درکار صرف افراد، حفاظت، نجم اور تیسرے فریق سے متعلق حقائق درج کریں۔';

  @override
  String get accReportStepEvidenceSubtitle =>
      'ہر نشان زدہ نقصان والے حصے کے لیے ایک منظر کی تصویر اور ایک قریبی تصویر شامل کریں۔ معاون دستاویزات اندراج کے وقت اختیاری ہیں۔';

  @override
  String get accReportStepDocumentsSubtitle =>
      'دستیاب معاون دستاویزات شامل کریں۔ اندراج کے وقت اختیاری۔';

  @override
  String get accReportStepReviewSubtitle =>
      'رپورٹ کو اچھی طرح چیک کریں اور فلیٹ تصدیق کو بھیجیں۔ اختیاری دستاویزات اس جمع کرانے کو کبھی نہیں روکتیں۔';

  @override
  String get accReportScanCode => 'QR / بارکوڈ اسکین کریں';

  @override
  String accReportMatchingAssets(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count مطابق اثاثے',
      one: '1 مطابق اثاثہ',
    );
    return '$_temp0';
  }

  @override
  String get accReportNoMatchingAsset => 'کوئی مطابق فلیٹ اثاثہ نہیں';

  @override
  String accReportMatchOverflow(int shown, int total, int hidden) {
    return '$total میں سے پہلے $shown نتائج دکھائے جا رہے ہیں۔ مزید $hidden نتائج ہیں، اپنی تلاش بہتر کریں۔';
  }

  @override
  String get accReportSavedFleetData => 'محفوظ فلیٹ ڈیٹا دکھایا جا رہا ہے';

  @override
  String get accReportChangeAsset => 'اثاثہ تبدیل کریں';

  @override
  String get accReportManualAsset => 'اثاثہ نمبر (دستی متبادل)';

  @override
  String get accReportManualAssetHint =>
      'صرف اس وقت استعمال کریں جب فلیٹ میں مطابقت دستیاب نہ ہو';

  @override
  String get accReportMeterAtIncident => 'واقعے کے وقت میٹر';

  @override
  String get accReportMeterHint => 'اوڈومیٹر یا گھنٹہ میٹر کی ریڈنگ';

  @override
  String accReportMeterFleetMaster(String km) {
    return 'فلیٹ ریکارڈ: $km کلومیٹر';
  }

  @override
  String get accReportRoadLocation => 'سڑک / درست مقام';

  @override
  String get accReportIncidentDate => 'واقعے کی تاریخ';

  @override
  String get accReportIncidentTime => 'واقعے کا وقت';

  @override
  String get accReportIncidentSite => 'واقعے کی سائٹ';

  @override
  String get accReportIncidentSiteHelper =>
      'قابل ترمیم واقعے کی سائٹ؛ فلیٹ کی مقفل بنیادی سائٹ سے الگ۔';

  @override
  String get accReportRoadLocationHint =>
      'گیٹ، سڑک، پروجیکٹ کا علاقہ یا GPS کی تفصیل';

  @override
  String get accReportEventType => 'واقعے کی قسم';

  @override
  String get accReportSelectEventType => 'واقعے کی قسم منتخب کریں';

  @override
  String get accReportInitialSeverity => 'ابتدائی شدت';

  @override
  String get accSeverityMinor => 'معمولی';

  @override
  String get accSeverityModerate => 'درمیانہ';

  @override
  String get accSeverityMajorSevere => 'بڑا / شدید';

  @override
  String get accSeverityFatal => 'جان لیوا';

  @override
  String get accReportWhatHappened => 'کیا ہوا؟';

  @override
  String get accReportWhatHappenedHint =>
      'واقعات کی ترتیب اور فوری حالات بیان کریں';

  @override
  String get accReportDriverName => 'ڈرائیور کا نام';

  @override
  String get accReportDriverId => 'ڈرائیور کا ملازمت / لائسنس نمبر';

  @override
  String get accReportPassengersInvolved => 'کیا مسافر شامل تھے؟';

  @override
  String get accReportPassengerCount => 'مسافروں کی تعداد';

  @override
  String get accReportPassengerDetails => 'مسافروں کی تفصیلات';

  @override
  String get accReportInjuries => 'کیا کوئی زخمی ہوا؟';

  @override
  String get accReportInjuryCount => 'زخمیوں کی تعداد';

  @override
  String get accReportInjuryDetails => 'چوٹوں کی تفصیلات';

  @override
  String get accReportEmergencyServices => 'کیا ہنگامی خدمات سے رابطہ کیا گیا؟';

  @override
  String get accReportEmergencyDetails => 'ہنگامی ردعمل کی تفصیلات';

  @override
  String get accReportVehicleMovable => 'کیا گاڑی حرکت کر سکتی ہے؟';

  @override
  String get accReportRecoveryRequired => 'کیا ریکوری / ٹوئنگ درکار ہے؟';

  @override
  String get accReportSafeToOperate => 'کیا گاڑی چلانے کے لیے محفوظ ہے؟';

  @override
  String get accReportThirdPartyInvolved => 'کیا کوئی تیسرا فریق شامل تھا؟';

  @override
  String get accReportThirdPartyName => 'تیسرے فریق کا نام';

  @override
  String get accReportThirdPartyVehicle => 'تیسرے فریق کی گاڑی';

  @override
  String get accReportThirdPartyPlate => 'تیسرے فریق کی نمبر پلیٹ';

  @override
  String get accReportThirdPartyContact => 'تیسرے فریق کا رابطہ';

  @override
  String get accReportThirdPartyInsurer => 'تیسرے فریق کی بیمہ کمپنی';

  @override
  String get accReportThirdPartyInvoice => 'کیا تیسرے فریق کی رسید دستیاب ہے؟';

  @override
  String get accReportThirdPartyInvoiceHelper =>
      'یہ اختیاری ہے۔ اگر دستیاب ہو تو صرف رسید نمبر درج کریں؛ انشورنس ٹیم بعد میں فائل منگوا سکتی ہے۔';

  @override
  String get accReportThirdPartyInvoiceNumber => 'تیسرے فریق کی رسید کا نمبر';

  @override
  String get accReportNajmOpened => 'کیا نجم کیس کھولا گیا؟';

  @override
  String get accReportNajmHelper =>
      'صرف اس وقت درج کریں جب اس واقعے پر نجم لاگو ہو۔';

  @override
  String get accReportNajmReference => 'نجم حوالہ';

  @override
  String get accReportWitnessDetails => 'گواہوں کی تفصیلات';

  @override
  String get accReportImmediateAction => 'فوری طور پر کی گئی کارروائی';

  @override
  String get accReportAdditionalNotes => 'اضافی نوٹس';

  @override
  String get accReportReadyToSubmit => 'جمع کرانے کے لیے تیار';

  @override
  String get accReportMissingBeforeSubmit => 'جمع کرانے سے پہلے کمی';

  @override
  String get accReportComplete => 'مکمل';

  @override
  String get accNotRecorded => 'درج نہیں';

  @override
  String get accNotAnswered => 'جواب نہیں دیا گیا';

  @override
  String get accReportReviewAsset => 'اثاثہ';

  @override
  String get accReportReviewIncident => 'واقعہ';

  @override
  String get accReportReviewDateTime => 'تاریخ اور وقت';

  @override
  String get accReportReviewSiteLocation => 'سائٹ / مقام';

  @override
  String get accReportReviewWhatHappened => 'کیا ہوا';

  @override
  String get accReportReviewPeople => 'افراد';

  @override
  String accReportReviewPeopleValue(String driver, String injuries) {
    return 'ڈرائیور $driver · چوٹیں $injuries';
  }

  @override
  String get accReportReviewDamageMarks => 'نقصان کے نشانات';

  @override
  String get accReportReviewFocusedPhotos => 'مخصوص تصاویر';

  @override
  String accReportReviewPhotosValue(int done, int total) {
    return '$total میں سے $done';
  }

  @override
  String get accReportReviewOptionalDocuments => 'اختیاری دستاویزات';

  @override
  String accReportReviewAttachedValue(int count) {
    return '$count منسلک';
  }

  @override
  String get accReportWorkflowResolvesOnSync =>
      'جب یہ قطار میں موجود رپورٹ مطابقت پائے گی تو ترتیب شدہ حادثہ ورک فلو وصول کنندگان، راستہ اور ابتدائی مقررہ مدت طے کرے گا۔';

  @override
  String get accReportDraftAutoSaves => 'مسودہ ڈیوائس پر خودکار محفوظ ہوتا ہے';

  @override
  String get accReportDraftUnsaved => 'غیر محفوظ تبدیلیاں';

  @override
  String get accReportDraftSaving => 'مسودہ محفوظ ہو رہا ہے…';

  @override
  String get accReportDraftSaved => 'مسودہ ڈیوائس پر محفوظ ہو گیا';

  @override
  String accReportDraftSavedAt(String time) {
    return 'مسودہ ڈیوائس پر محفوظ ہو گیا · $time';
  }

  @override
  String get accReportDraftSaveFailedShort => 'مسودہ محفوظ نہیں ہو سکا';

  @override
  String get accReportDraftRestoring => 'محفوظ مسودہ بحال ہو رہا ہے…';

  @override
  String get accReportSaveAndExit => 'محفوظ کریں اور باہر نکلیں';

  @override
  String get accReportBack => 'واپس';

  @override
  String get accReportSubmit => 'حادثہ جمع کریں';

  @override
  String get accReportContinueToIncident => 'واقعے کی تفصیلات پر جائیں';

  @override
  String get accReportContinueToEvidence => 'ثبوت پر جائیں';

  @override
  String get accReportSaveAndContinue => 'محفوظ کریں اور جاری رکھیں';

  @override
  String accReportFleetResults(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$count فلیٹ نتائج · اثاثہ، فلیٹ، پلیٹ، قسم، میک، ماڈل یا سائٹ سے تلاش کریں',
      one:
          '1 فلیٹ نتیجہ · اثاثہ، فلیٹ، پلیٹ، قسم، میک، ماڈل یا سائٹ سے تلاش کریں',
    );
    return '$_temp0';
  }

  @override
  String get accTypeCollision => 'تصادم';

  @override
  String get accTypeRollover => 'الٹ جانا';

  @override
  String get accTypeRearEnd => 'پیچھے سے ٹکر';

  @override
  String get accTypeSideSwipe => 'پہلو سے رگڑ';

  @override
  String get accTypeReversing => 'ریورس کرتے ہوئے';

  @override
  String get accTypeFire => 'آگ';

  @override
  String get accTypeVandalism => 'توڑ پھوڑ';

  @override
  String get accTypeWeather => 'موسم';

  @override
  String get accTypeTyreFailure => 'ٹائر کی خرابی';

  @override
  String get accTypeMechanical => 'مکینیکل';

  @override
  String get accTypeNearMiss => 'بال بال بچاؤ';

  @override
  String get accTypePropertyDamage => 'املاک کو نقصان';

  @override
  String get accTypeOther => 'دیگر';

  @override
  String get accNotSet => 'مقرر نہیں';

  @override
  String get accErrorFileUnsupported => 'یہ فائل قابل قبول نہیں۔';

  @override
  String get accErrorCheckValues => 'اقدار چیک کریں اور دوبارہ کوشش کریں۔';

  @override
  String get accErrorGeneric => 'کچھ غلط ہو گیا۔ براہ کرم دوبارہ کوشش کریں۔';

  @override
  String accNotifyForVisibility(String role) {
    return '$role (صرف اطلاع کے لیے)';
  }

  @override
  String get accTakePhoto => 'تصویر لیں';

  @override
  String get accChooseDeviceFile => 'ڈیوائس سے فائل منتخب کریں';

  @override
  String get accDhDispatchHandover => 'روانگی اور حوالگی';

  @override
  String get accDhRepairRoute => 'مرمت کا راستہ';

  @override
  String get accDhDispatchStatus => 'روانگی کی حالت';

  @override
  String get accDhTransitElapsed => 'سفر کا گزرا وقت';

  @override
  String get accDhVendorRepairSla => 'وینڈر مرمت کی مدت';

  @override
  String get accDhSlaUnavailable => 'مدت دستیاب نہیں';

  @override
  String get accDhVendorSlaStartsOnlyAfterSigned =>
      'وینڈر کی مدت صرف دستخط شدہ وصولی کے بعد شروع ہوتی ہے۔';

  @override
  String get accDhTheSlaClockStartsWhenThe =>
      'مدت کا وقت تب شروع ہوتا ہے جب ورکشاپ گاڑی کی وصولی پر دستخط کرے۔';

  @override
  String get accDhRetry => 'دوبارہ کوشش کریں';

  @override
  String get accDhDispatchLegsAreNotProvisionedOn =>
      'روانگی کے ریکارڈ اس ڈیٹا بیس میں ابھی فراہم نہیں کیے گئے۔ مائیگریشن لاگو ہونے تک تفصیلات درج نہیں ہو سکتیں۔';

  @override
  String get accDhVendorContactFieldsAreNotProvisioned =>
      'وینڈر رابطہ فیلڈز ابھی فراہم نہیں؛ صرف ورکشاپ کا نام محفوظ ہوتا ہے۔';

  @override
  String get accDhAfterAcceptanceVendorCanAddInspection =>
      'قبولیت کے بعد وینڈر اپنے ورک اسپیس میں معائنہ، کوٹیشن، پرزے، شیڈول اور پیش رفت شامل کر سکتا ہے۔ PO صرف کوٹیشن کے جائزے اور منظوری کے بعد بنتا ہے۔';

  @override
  String get accDhOpenCaseTimeline => 'کیس ٹائم لائن کھولیں';

  @override
  String get accDhOpenWorkshopAssessment => 'ورکشاپ تشخیص کھولیں';

  @override
  String get accDhNotStarted => 'شروع نہیں ہوئی';

  @override
  String get accDhMet => 'پوری ہوئی';

  @override
  String get accDhBreached => 'خلاف ورزی';

  @override
  String get accDhPaused => 'موقوف';

  @override
  String get accDhRunning => 'جاری';

  @override
  String get accDhCancelled => 'منسوخ';

  @override
  String get accDhStartedNoSlaTarget => 'شروع، کوئی ہدف نہیں';

  @override
  String get accDhDestinationAndVendor => 'منزل اور وینڈر';

  @override
  String get accDhWorkshopName => 'ورکشاپ کا نام';

  @override
  String get accDhCity => 'شہر';

  @override
  String get accDhVendorContactName => 'رابطہ کا نام';

  @override
  String get accDhPhone => 'فون';

  @override
  String get accDhEmail => 'ای میل';

  @override
  String get accDhWorkshopRegistrationTaxNo => 'ورکشاپ رجسٹریشن / ٹیکس نمبر';

  @override
  String get accDhAssignedVendorInspector => 'مقررہ وینڈر معائنہ کار';

  @override
  String get accDhUnassigned => 'غیر مقرر';

  @override
  String get accDhEditVendorDetails => 'وینڈر کی تفصیلات بدلیں';

  @override
  String get accDhContactWorkshop => 'ورکشاپ سے رابطہ';

  @override
  String get accDhCancel => 'منسوخ';

  @override
  String get accDhSaveVendor => 'وینڈر محفوظ کریں';

  @override
  String get accDhDispatchDetails => 'روانگی کی تفصیلات';

  @override
  String get accDhSentBy => 'روانہ کرنے والا';

  @override
  String get accDhDeparture => 'روانگی';

  @override
  String get accDhCarrier => 'ٹرانسپورٹر';

  @override
  String get accDhDriver => 'ڈرائیور';

  @override
  String get accDhRecoveryVehicle => 'ریکوری گاڑی';

  @override
  String get accDhOrigin => 'روانگی کی جگہ';

  @override
  String get accDhDestination => 'منزل';

  @override
  String get accDhEstimatedArrival => 'متوقع آمد';

  @override
  String get accDhLiveStatus => 'موجودہ حالت';

  @override
  String get accDhRecordDispatch => 'روانگی درج کریں';

  @override
  String get accDhOdometerKm => 'اوڈومیٹر (کلومیٹر)';

  @override
  String get accDhEngineHours => 'انجن کے گھنٹے';

  @override
  String get accDhFuel => 'ایندھن %';

  @override
  String get accDhKeys => 'چابیاں';

  @override
  String get accDhDocumentsSentOnePerLine =>
      'ارسال کردہ دستاویزات (ہر سطر میں ایک)';

  @override
  String get accDhAccessoriesChecklistOnePerLine =>
      'لوازمات / چیک لسٹ (ہر سطر میں ایک)';

  @override
  String get accDhOutgoingDamagePhotos => 'روانگی کے نقصان کی تصاویر';

  @override
  String get accDhOutgoingConditionSignedBy => 'روانگی کی حالت پر دستخط کنندہ';

  @override
  String get accDhOutgoingSignature => 'روانگی کے دستخط';

  @override
  String get accDhSaveDispatch => 'روانگی محفوظ کریں';

  @override
  String get accDhVehicleHandoverCondition => 'حوالگی کے وقت گاڑی کی حالت';

  @override
  String get accDhOdometer => 'اوڈومیٹر';

  @override
  String get accDhFuel2 => 'ایندھن';

  @override
  String get accDhDocumentsSent => 'ارسال کردہ دستاویزات';

  @override
  String get accDhDocuments => 'دستاویزات';

  @override
  String get accDhAccessoriesChecklist => 'لوازمات / چیک لسٹ';

  @override
  String get accDhItems => 'اشیاء';

  @override
  String get accDhPhotos => 'تصاویر';

  @override
  String get accDhWorkshopReceipt => 'ورکشاپ کی وصولی';

  @override
  String get accDhCompletedByVendor => 'وینڈر نے مکمل کیا';

  @override
  String get accDhArrived => 'آمد';

  @override
  String get accDhReceivedBy => 'وصول کنندہ';

  @override
  String get accDhIncomingOdometer => 'آمد کا اوڈومیٹر';

  @override
  String get accDhIncomingEngineHours => 'آمد کے انجن گھنٹے';

  @override
  String get accDhIncomingFuel => 'آمد کا ایندھن';

  @override
  String get accDhConditionMatchesDispatch => 'حالت روانگی سے مطابقت رکھتی ہے';

  @override
  String get accDhYes => 'ہاں';

  @override
  String get accDhNo => 'نہیں';

  @override
  String get accDhAdditionalDamageRemarks => 'اضافی نقصان / تبصرے';

  @override
  String get accDhReceivingPhotos => 'وصولی کی تصاویر';

  @override
  String get accDhCustodyAccepted => 'تحویل قبول';

  @override
  String get accDhVendorReceiverSignature => 'وینڈر وصول کنندہ کے دستخط';

  @override
  String get accDhSenderDriverSignature => 'بھیجنے والے / ڈرائیور کے دستخط';

  @override
  String get accDhCompletedByVendor2 => 'وینڈر مکمل کرے گا';

  @override
  String get accDhNoDispatchLegIsRecordedYet =>
      'ابھی کوئی روانگی درج نہیں۔ پہلے روانگی درج کریں؛ وصولی اسی پر دستخط ہوتی ہے۔';

  @override
  String get accDhArrivedDateTime => 'آمد کی تاریخ / وقت *';

  @override
  String get accDhReceivedByName => 'وصول کنندہ (نام) *';

  @override
  String get accDhDesignation => 'عہدہ *';

  @override
  String get accDhIncomingOdometerKm => 'آمد کا اوڈومیٹر';

  @override
  String get accDhIncomingFuel2 => 'آمد کا ایندھن %';

  @override
  String get accDhUploadReceivingPhotos => 'وصولی کی تصاویر اپ لوڈ کریں *';

  @override
  String get accDhUploadSignedHandoverPaper =>
      'دستخط شدہ حوالگی کاغذ اپ لوڈ کریں *';

  @override
  String get accDhVendorReceiverSignature2 => 'وینڈر وصول کنندہ کے دستخط *';

  @override
  String get accDhSenderDriverSignatureCaptured =>
      'بھیجنے والے / ڈرائیور کے دستخط (ریکارڈ شدہ)';

  @override
  String get accDhIAcceptCustodyOfThisVehicle =>
      'میں اس گاڑی کی تحویل قبول کرتا ہوں';

  @override
  String get accDhSignAndAcceptVehicle => 'دستخط کرکے گاڑی قبول کریں';

  @override
  String get accDhCompleteAllRequiredFieldsToEnable =>
      'فعال کرنے کے لیے تمام مطلوبہ فیلڈز مکمل کریں';

  @override
  String get accDhMissing => 'باقی';

  @override
  String get accDhArrivedDateTime2 => 'آمد کا وقت';

  @override
  String get accDhDesignation2 => 'عہدہ';

  @override
  String get accDhSignedHandoverPaper => 'حوالگی کاغذ';

  @override
  String get accDhVendorReceiverSignature3 => 'وصول کنندہ دستخط';

  @override
  String get accDhCustodyCheckbox => 'تحویل کا خانہ';

  @override
  String get accDhComplete => 'مکمل';

  @override
  String get accDhNext => 'اگلا';

  @override
  String get accDhPending => 'زیر التوا';

  @override
  String get accDhDispatched => 'روانہ';

  @override
  String get accDhArrived2 => 'پہنچ گئی';

  @override
  String get accDhSignedAcceptance => 'دستخط شدہ قبولیت';

  @override
  String get accDhVendorAssessmentQuotationStarts =>
      'وینڈر تشخیص / کوٹیشن شروع';

  @override
  String get accDhPick => 'منتخب کریں';

  @override
  String get accDhUseNow => 'ابھی';

  @override
  String get accDhAttached => 'منسلک';

  @override
  String get accDhCamera => 'کیمرہ';

  @override
  String get accDhGallery => 'گیلری';

  @override
  String get accTlAddTimelineNote => 'ٹائم لائن نوٹ';

  @override
  String get accTlNote => 'نوٹ';

  @override
  String get accTlSaveNote => 'نوٹ محفوظ کریں';

  @override
  String get accTlNotifyParticipants => 'شرکاء کو اطلاع';

  @override
  String get accTlThisLogsTheNotificationOnThe =>
      'یہ اطلاع کیس لیجر میں درج ہوتی ہے۔ افراد تک ترسیل سرور کا نوٹیفکیشن انجن کرتا ہے۔';

  @override
  String get accTlSubject => 'موضوع';

  @override
  String get accTlMessage => 'پیغام';

  @override
  String get accTlLogNotification => 'اطلاع درج';

  @override
  String get accTlManageRecipientGroups => 'وصول کنندگان کے گروپس';

  @override
  String get accTlRecipientsAreSetByAdminPer =>
      'وصول کنندگان ایڈمن ہر ایونٹ اور کردار کے لیے مقرر کرتا ہے۔ نیچے دیے گئے گروپ وہ کردار ہیں جن تک ہر ایونٹ پہنچتا ہے؛ رکنیت صارف پروفائلز سے آتی ہے۔';

  @override
  String get accTlVisibility => 'صرف دیکھنا';

  @override
  String get accTlTime => 'وقت';

  @override
  String get accTlBy => 'از';

  @override
  String get accTlTo => 'کو';

  @override
  String get accTlStatus => 'حالت';

  @override
  String get accTlElapsed => 'گزرا وقت';

  @override
  String get accTlCaseTimelineNotifications => 'کیس کی ٹائم لائن اور اطلاعات';

  @override
  String get accTlOpen => 'کھلا';

  @override
  String get accTlCurrentOwner => 'موجودہ ذمہ دار';

  @override
  String get accTlNextSla => 'اگلی مقررہ مدت';

  @override
  String get accTlDueIn => 'مقررہ وقت میں باقی';

  @override
  String get accTlAddTimelineNote2 => 'ٹائم لائن میں نوٹ شامل کریں';

  @override
  String get accTlNotifyParticipants2 => 'شرکاء کو اطلاع دیں';

  @override
  String get accTlNotProvisionedYetOnThisDatabase =>
      'اس ڈیٹا بیس میں ابھی فراہم نہیں';

  @override
  String get accTlCouldNotBeReadTheFeed =>
      'پڑھا نہیں جا سکا؛ فیڈ میں شامل نہیں';

  @override
  String get accTlCommunications => 'مواصلات';

  @override
  String get accTlEvidence => 'ثبوت';

  @override
  String get accTlSlaClocks => 'مقررہ مدتیں';

  @override
  String get accTlDispatchLeg => 'روانگی';

  @override
  String get accTlGpsFix => 'GPS مقام';

  @override
  String get accTlTimeline => 'ٹائم لائن';

  @override
  String get accTlNotifications => 'اطلاعات';

  @override
  String get accTlParticipants => 'شرکاء';

  @override
  String get accTlAll => 'سب';

  @override
  String get accTlActions => 'کارروائیاں';

  @override
  String get accTlDocuments => 'دستاویزات';

  @override
  String get accTlSla => 'مدت';

  @override
  String get accTlEmails => 'ای میلز';

  @override
  String get accTlCompleted => 'مکمل';

  @override
  String get accTlInTransit => 'راستے میں';

  @override
  String get accTlNoRecordedEventsForThisFilter =>
      'اس فلٹر کے لیے کوئی درج شدہ واقعہ نہیں۔';

  @override
  String get accTlNotificationDeliveryLog => 'اطلاعات کی ترسیل کا ریکارڈ';

  @override
  String get accTlNoNotificationsRecordedForThisCase =>
      'اس کیس کے لیے کوئی اطلاع درج نہیں۔';

  @override
  String get accTlTrigger => 'محرک';

  @override
  String get accTlRecipients => 'وصول کنندگان';

  @override
  String get accTlChannel => 'چینل';

  @override
  String get accTlShowStatus => 'حالت دکھائیں';

  @override
  String get accTlViewAllNotifications => 'تمام اطلاعات دیکھیں';

  @override
  String get accTlManageRecipientGroups2 => 'وصول کنندگان کے گروپس سنبھالیں';

  @override
  String get accTlRecipientsAreSetByAdminPer2 =>
      'وصول کنندگان ایڈمن ہر ایونٹ اور کردار کے لیے مقرر کرتا ہے۔';

  @override
  String get accTlParticipantsAndOwnership => 'شرکاء اور ذمہ داری';

  @override
  String get accTlBy2 => 'از';

  @override
  String get accTlTo2 => 'کو';

  @override
  String get accTlSlaMet => 'مدت پوری';

  @override
  String get accDhChangeNotSaved =>
      'تبدیلی محفوظ نہیں ہو سکی۔ دوبارہ کوشش کریں۔';

  @override
  String get accDhContactOpenFailed =>
      'اس ڈیوائس پر ورکشاپ رابطہ نہیں کھل سکا۔';

  @override
  String get accDhRecordDepartureFirst => 'پہلے روانگی کا وقت درج کریں۔';

  @override
  String get accTlLoadFailed => 'ٹائم لائن لوڈ نہیں ہو سکی۔ دوبارہ کوشش کریں۔';

  @override
  String accTlOverdueBy(String elapsed) {
    return 'تاخیر $elapsed';
  }

  @override
  String tyreMockRecordsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ٹائر',
      one: '1 ٹائر',
      zero: 'کوئی ٹائر نہیں',
    );
    return '$_temp0';
  }

  @override
  String get tyreMockTabAll => 'سب';

  @override
  String get tyreMockTabInstalled => 'نصب شدہ';

  @override
  String get tyreMockTabRemoved => 'اتارے گئے';

  @override
  String get tyreMockTabScrapped => 'اسکریپ شدہ';

  @override
  String get tyreMockShowingInstalled => 'نصب شدہ ٹائر دکھائے جا رہے ہیں';

  @override
  String get tyreMockShowingRemoved => 'اتارے گئے ٹائر دکھائے جا رہے ہیں';

  @override
  String get tyreMockShowingScrapped => 'اسکریپ شدہ ٹائر دکھائے جا رہے ہیں';

  @override
  String get tyreMockShowingAll => 'تمام ٹائر دکھائے جا رہے ہیں';

  @override
  String tyreMockLoadedAt(String time) {
    return 'لوڈ ہوا $time';
  }

  @override
  String get tyreMockSortTooltip => 'ترتیب';

  @override
  String get tyreMockSortNewest => 'تازہ ترین نصب';

  @override
  String get tyreMockSortOldest => 'قدیم ترین نصب';

  @override
  String tyreMockSitePill(String value) {
    return 'سائٹ: $value';
  }

  @override
  String tyreMockRiskPill(String value) {
    return 'خطرہ: $value';
  }

  @override
  String get tyreMockMetricFitted => 'نصب کی تاریخ';

  @override
  String get tyreMockMetricRemoved => 'اتارنے کی تاریخ';

  @override
  String get tyreMockMetricTread => 'ٹریڈ';

  @override
  String get tyreMockMetricKmRun => 'طے شدہ کلومیٹر';

  @override
  String tyreMockKmValue(String value) {
    return '$value کلومیٹر';
  }

  @override
  String tyreMockHoursValue(String value) {
    return '$value گھنٹے';
  }

  @override
  String get tyreMockScanSerial => 'ٹائر سیریل اسکین کریں';

  @override
  String get tyreMockInspectionTitle => 'ٹائر معائنہ';

  @override
  String get tyreMockInspectionProgress => 'معائنے کی پیش رفت';

  @override
  String tyreMockProgressComplete(int percent) {
    return '$percent% مکمل';
  }

  @override
  String get tyreMockMachineMeter => 'مشین میٹر';

  @override
  String get tyreMockPreviousTyre => 'پچھلا ٹائر';

  @override
  String get tyreMockNextTyre => 'اگلا ٹائر';

  @override
  String get fleetMockClassVehicles => 'گاڑیاں';

  @override
  String get fleetMockClassPlant => 'پلانٹ اور آلات';

  @override
  String get fleetMockClassStationary => 'اسٹیشنری';

  @override
  String fleetMockActiveAssets(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count فعال اثاثے',
      one: '1 فعال اثاثہ',
      zero: 'کوئی فعال اثاثہ نہیں',
    );
    return '$_temp0';
  }

  @override
  String get fleetMockScopeAllSites => 'تمام مجاز سائٹس';

  @override
  String get fleetMockScopeAllCountries => 'تمام ممالک';

  @override
  String get fleetMockScanAssetQr => 'اثاثے کا QR اسکین کریں';

  @override
  String get fleetMockTabTimeline => 'ٹائم لائن';

  @override
  String get fleetMockTabCosts => 'اخراجات';

  @override
  String get fleetMockPeriodYtd => 'اس سال اب تک';

  @override
  String get fleetMockPeriod12m => 'پچھلے 12 ماہ';

  @override
  String get fleetMockPeriod90d => 'پچھلے 90 دن';

  @override
  String get fleetMockPeriod30d => 'پچھلے 30 دن';

  @override
  String get fleetMockTimelineAll => 'تمام واقعات';

  @override
  String get fleetMockTimelineWorkOrders => 'ورک آرڈرز';

  @override
  String get fleetMockTimelineInspections => 'معائنے';

  @override
  String get fleetMockTimelineWashes => 'دھلائی';

  @override
  String get fleetMockTimelineTyres => 'ٹائر';

  @override
  String get fleetMockTimelineAccidents => 'حادثات';

  @override
  String get fleetMockEventWorkOrder => 'جاب کارڈ کھولا گیا';

  @override
  String get fleetMockEventInspection => 'ٹائر معائنہ';

  @override
  String get fleetMockEventWash => 'گاڑی کی دھلائی';

  @override
  String get fleetMockEventTyreFitted => 'ٹائر لگایا گیا';

  @override
  String get fleetMockEventTyreRemoved => 'ٹائر اتارا گیا';

  @override
  String get fleetMockEventAccident => 'حادثے کی اطلاع دی گئی';

  @override
  String fleetMockEventPhotos(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count تصاویر',
      one: '1 تصویر',
    );
    return '$_temp0';
  }

  @override
  String get fleetMockTimelineEmptyTitle => 'اس مدت میں کوئی ریکارڈ نہیں';

  @override
  String get fleetMockTimelineEmptyBody =>
      'منتخب مدت میں اس اثاثے کے لیے کچھ ریکارڈ نہیں ہوا۔';

  @override
  String get fleetMockTimelinePartial =>
      'کچھ ریکارڈ لوڈ نہیں ہو سکا۔ فہرست نامکمل ہو سکتی ہے۔';

  @override
  String get fleetMockSnapshotTitle => 'مالی خلاصہ';

  @override
  String get fleetMockOpenFinReport => 'مکمل مالی رپورٹ کھولیں';

  @override
  String get fleetMockFinReportTitle => 'مالی رپورٹ';

  @override
  String fleetMockFinScopeNote(String currency) {
    return 'ایک اثاثے کی رپورٹ، قدریں صرف $currency میں';
  }

  @override
  String fleetMockFinVsYear(String year) {
    return '$year کی اسی مدت کے مقابلے میں';
  }

  @override
  String get fleetMockFinTotalOperating => 'کل آپریٹنگ لاگت';

  @override
  String get fleetMockFinMaintenance => 'دیکھ بھال';

  @override
  String get fleetMockFinCostPerKm => 'فی کلومیٹر لاگت';

  @override
  String get fleetMockFinCostPerHour => 'فی انجن گھنٹہ لاگت';

  @override
  String get fleetMockFinDowntime => 'ڈاؤن ٹائم';

  @override
  String fleetMockFinHours(String hours) {
    return '$hours گھنٹے';
  }

  @override
  String get fleetMockFinNotMeasurable => 'قابل پیمائش نہیں';

  @override
  String get fleetMockFinNoKmReadings =>
      'مدت میں اوڈومیٹر کی دو ریڈنگز درکار ہیں';

  @override
  String get fleetMockFinNotRecorded => 'درج نہیں';

  @override
  String get fleetMockFinNoComparison => 'موازنے کے لیے ڈیٹا نہیں';

  @override
  String get fleetMockFinCostTrend => 'لاگت کا رجحان';

  @override
  String fleetMockFinMonthlyCost(String currency) {
    return 'ماہانہ لاگت ($currency)';
  }

  @override
  String get fleetMockFinComposition => 'لاگت کی تقسیم';

  @override
  String get fleetMockFinBucketParts => 'اسپیئر پارٹس';

  @override
  String get fleetMockFinBucketLubricants => 'تیل اور چکنائی';

  @override
  String get fleetMockFinBucketTyres => 'ٹائر';

  @override
  String get fleetMockFinBucketLabour => 'مزدوری';

  @override
  String get fleetMockFinRecentEntries => 'حالیہ لاگت کے اندراجات';

  @override
  String fleetMockFinViewAll(int count) {
    return 'تمام لاگت کے اندراجات دیکھیں ($count)';
  }

  @override
  String get fleetMockFinShowFewer => 'کم دکھائیں';

  @override
  String fleetMockFinLines(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count لائنیں',
      one: '1 لائن',
    );
    return '$_temp0';
  }

  @override
  String get fleetMockFinExport => 'رپورٹ ایکسپورٹ کریں';

  @override
  String get fleetMockFinExportError =>
      'رپورٹ ایکسپورٹ نہیں ہو سکی۔ دوبارہ کوشش کریں۔';

  @override
  String get fleetMockFinNoCostTitle => 'کوئی لاگت درج نہیں';

  @override
  String get fleetMockFinNoCostBody =>
      'منتخب مدت میں اس اثاثے کے لیے کوئی اخراجات یا مزدوری درج نہیں ہوئی۔';

  @override
  String get fleetMockFinMixedTitle => 'ایک سے زیادہ کرنسی';

  @override
  String fleetMockFinMixedBody(String currencies) {
    return 'اس اثاثے کی لاگت کی لائنیں $currencies استعمال کرتی ہیں۔ مختلف کرنسیوں کو کبھی جمع نہیں کیا جاتا۔ اعداد دیکھنے کے لیے ایک ملک منتخب کریں۔';
  }

  @override
  String get fleetMockFinLabourMissing => 'جاب کارڈز کی مزدوری شامل نہیں ہے۔';

  @override
  String get fleetMockFinSourceNote =>
      'پارٹس، تیل اور ٹائر اخراجات کے ریکارڈ سے۔ مزدوری اور ڈاؤن ٹائم جاب کارڈز سے۔ اس اثاثے کا کوئی بجٹ درج نہیں۔';

  @override
  String get fleetMockFinMeters => 'مدت میں میٹر';

  @override
  String get fleetMockFinDistance => 'فاصلہ';

  @override
  String get fleetMockFinRunningHours => 'انجن گھنٹے';

  @override
  String get myWorkAllSites => 'تمام تفویض شدہ سائٹس';

  @override
  String myWorkAnswered(int answered, int total) {
    return '$answered/$total جواب دیے گئے';
  }

  @override
  String get myWorkApprovalQueues => 'منظوری کی قطاریں';

  @override
  String get myWorkAssignedTo => 'تفویض کردہ';

  @override
  String get myWorkChecklistApprovals => 'عمومی چیک لسٹ منظوریاں';

  @override
  String get myWorkCompletedEmpty => 'ابھی کوئی مکمل کام نہیں';

  @override
  String myWorkContentAvailable(String languages) {
    return '$languages مواد دستیاب ہے';
  }

  @override
  String get myWorkContentLanguage => 'چیک لسٹ مواد کی زبان';

  @override
  String get myWorkDayEmpty => 'اس دن کے لیے کچھ منصوبہ بند نہیں';

  @override
  String get myWorkDraftSaved => 'مسودہ محفوظ ہے';

  @override
  String myWorkDueOn(String date) {
    return 'واجب الادا $date';
  }

  @override
  String get myWorkDueToday => 'آج واجب';

  @override
  String get myWorkEmptyBody =>
      'آپ یا آپ کے کردار کو تفویض کردہ کام یہاں ظاہر ہوتا ہے۔';

  @override
  String get myWorkEmptyFiltered => 'اس فلٹر سے کوئی کام میل نہیں کھاتا';

  @override
  String get myWorkEmptyTitle => 'کچھ تفویض نہیں';

  @override
  String get myWorkFieldPlanTitle => 'آج کا فیلڈ پلان';

  @override
  String get myWorkFilterAll => 'تمام اقسام';

  @override
  String get myWorkFilterTooltip => 'قسم کے لحاظ سے فلٹر';

  @override
  String get myWorkHistory => 'میرے کام کی تاریخ دیکھیں';

  @override
  String get myWorkInspectionApprovals => 'ٹائر معائنہ منظوریاں';

  @override
  String get myWorkKindChecklist => 'چیک لسٹ';

  @override
  String get myWorkKindCorrective => 'اصلاحی کارروائی';

  @override
  String get myWorkKindDraft => 'چیک لسٹ مسودہ';

  @override
  String get myWorkKindInspection => 'ٹائر معائنہ';

  @override
  String get myWorkKindWorkOrder => 'ورک آرڈر';

  @override
  String myWorkLateDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count دن',
      one: '1 دن',
    );
    return '$_temp0';
  }

  @override
  String myWorkLateHours(int count) {
    return '$count گھنٹے';
  }

  @override
  String myWorkLateMinutes(int count) {
    return '$count منٹ';
  }

  @override
  String get myWorkLoadError => 'میرا کام ابھی لوڈ نہیں ہو سکا۔';

  @override
  String get myWorkNoDueDate => 'کوئی مقررہ تاریخ نہیں';

  @override
  String get myWorkNotRecorded => 'درج نہیں';

  @override
  String get myWorkOverdueBy => 'تاخیر';

  @override
  String myWorkPartial(String sources) {
    return 'کچھ کام چیک نہیں ہو سکا: $sources۔';
  }

  @override
  String get myWorkPriority => 'ترجیح';

  @override
  String get myWorkReportIssue => 'مسئلہ رپورٹ کریں';

  @override
  String get myWorkResume => 'دوبارہ شروع کریں';

  @override
  String get myWorkRetry => 'دوبارہ کوشش کریں';

  @override
  String get myWorkSearchHint => 'کام، اثاثہ یا سائٹ تلاش کریں';

  @override
  String get myWorkSearchTooltip => 'تلاش';

  @override
  String get myWorkSectionComingUp => 'آنے والا';

  @override
  String get myWorkSectionCompleted => 'مکمل';

  @override
  String get myWorkSectionDueToday => 'آج واجب';

  @override
  String get myWorkSectionInProgress => 'جاری';

  @override
  String get myWorkSectionOverdue => 'تاخیر شدہ';

  @override
  String get myWorkSectionWorkOrders => 'ورک آرڈرز';

  @override
  String get myWorkSourceApprovals => 'منظوری کی قطاریں';

  @override
  String get myWorkSourceChecklists => 'چیک لسٹیں';

  @override
  String get myWorkSourceCorrective => 'اصلاحی کارروائیاں';

  @override
  String get myWorkSourceDrafts => 'اس ڈیوائس پر مسودے';

  @override
  String get myWorkSourcePlans => 'معائنہ منصوبے';

  @override
  String get myWorkSourceWorkOrders => 'ورک آرڈرز';

  @override
  String get myWorkStart => 'شروع کریں';

  @override
  String get myWorkStartInspection => 'معائنہ شروع کریں';

  @override
  String get myWorkStatAssigned => 'تفویض شدہ';

  @override
  String get myWorkStatCompleted => 'مکمل';

  @override
  String get myWorkStatDueToday => 'آج واجب';

  @override
  String get myWorkStatOverdue => 'تاخیر شدہ';

  @override
  String get myWorkStatTasks => 'کام';

  @override
  String get myWorkStateCompleted => 'مکمل';

  @override
  String get myWorkStateDueToday => 'آج واجب';

  @override
  String get myWorkStateInProgress => 'جاری';

  @override
  String get myWorkStateOverdue => 'تاخیر شدہ';

  @override
  String get myWorkStateUpcoming => 'آنے والا';

  @override
  String get myWorkStatus => 'حیثیت';

  @override
  String myWorkSyncPending(int count) {
    return '$count مطابقت کے منتظر';
  }

  @override
  String get myWorkTabAssigned => 'تفویض شدہ';

  @override
  String get myWorkTabCompleted => 'مکمل';

  @override
  String get myWorkTabInProgress => 'جاری';

  @override
  String get myWorkTasksTitle => 'میرے کام';

  @override
  String get myWorkTyreWorkflowTag => 'خصوصی ٹائر ورک فلو';

  @override
  String get myWorkView => 'دیکھیں';

  @override
  String get clMockDueNow => 'ابھی واجب';

  @override
  String get clMockDueTomorrow => 'کل واجب';

  @override
  String clMockDueOn(String date) {
    return 'واجب $date';
  }

  @override
  String get clMockCadenceDaily => 'روزانہ';

  @override
  String get clMockCadenceWeekly => 'ہفتہ وار';

  @override
  String get clMockCadenceMonthly => 'ماہانہ';

  @override
  String clMockCadenceEveryDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'ہر $count دن',
      one: 'ہر روز',
    );
    return '$_temp0';
  }

  @override
  String get clMockMeterRowTitle => 'اوڈومیٹر اور آور میٹر ریڈنگ';

  @override
  String clMockMeterLastRecorded(String date) {
    return 'آخری اندراج $date';
  }

  @override
  String get clMockMeterNoReading => 'ابھی کوئی ریڈنگ درج نہیں';

  @override
  String get clMockMeterRecord => 'درج کریں';

  @override
  String get clMockPendingApproval => 'منظوری زیر التوا';

  @override
  String get clMockAwaitingYourApproval => 'آپ کی منظوری کا انتظار';

  @override
  String get clMockReviewerLabel => 'جائزہ کار';

  @override
  String clMockSubmittedOn(String date) {
    return 'جمع کرایا گیا $date';
  }

  @override
  String clMockFilledBy(String name) {
    return '$name نے پُر کیا';
  }

  @override
  String get clMockOperatorSignatureCaptured => 'آپریٹر کے دستخط محفوظ ہیں';

  @override
  String get clMockOperatorSignatureMissing => 'آپریٹر کے دستخط نہیں';

  @override
  String get clMockRungInProgress => 'جاری ہے';

  @override
  String get clMockRungPending => 'زیر التوا';

  @override
  String get clMockInspectionOutcome => 'معائنے کا نتیجہ';

  @override
  String get clMockPass => 'درست';

  @override
  String get clMockFail => 'ناکام';

  @override
  String get clMockNotApplicable => 'لاگو نہیں';

  @override
  String get clMockNoChecksScored => 'اس شیٹ میں درست یا ناکام جانچ نہیں ہے';

  @override
  String get clMockRequiredFields => 'لازمی خانے';

  @override
  String get clMockPhotos => 'تصاویر';

  @override
  String get clMockSignatures => 'دستخط';

  @override
  String get clMockFindingsTitle => 'جائزے کے متقاضی نتائج';

  @override
  String clMockFindingNote(String note) {
    return 'نوٹ: $note';
  }

  @override
  String clMockPhotosAttached(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count تصاویر منسلک',
      one: '1 تصویر منسلک',
      zero: 'کوئی تصویر منسلک نہیں',
    );
    return '$_temp0';
  }

  @override
  String get clMockSectionGeneral => 'عمومی';

  @override
  String clMockSectionFindings(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count نتائج',
      one: '1 نتیجہ',
    );
    return '$_temp0';
  }

  @override
  String clMockSectionPassed(int passed, int total) {
    return '$passed/$total درست';
  }

  @override
  String get clMockSectionComplete => 'مکمل';

  @override
  String clMockSectionAnswered(int answered, int total) {
    return '$answered/$total جواب دیے گئے';
  }

  @override
  String get clMockViewAllAnswers => 'چیک لسٹ کے تمام جوابات دیکھیں';

  @override
  String get clMockHideAllAnswers => 'چیک لسٹ کے جوابات چھپائیں';

  @override
  String get clMockReviewerAction => 'جائزہ کار کی کارروائی';

  @override
  String get clMockDecisionNote => 'فیصلے کا نوٹ';

  @override
  String get clMockDecisionNoteHint => 'درستی کے لیے واپس بھیجتے وقت لازمی';

  @override
  String get clMockReturnForCorrection => 'درستی کے لیے واپس کریں';

  @override
  String get clMockApprove => 'منظور کریں';

  @override
  String get clMockApproveNeeds =>
      'منظوری کے لیے دستخط کریں اور اپنا نام درج کریں';

  @override
  String get clMockDecisionRecorded =>
      'فیصلہ، نوٹ، دستخط اور وقت محفوظ کیے جاتے ہیں۔';

  @override
  String get clMockSavedSignatureApplied =>
      'آپ کے محفوظ دستخط شامل کر دیے گئے ہیں۔ منظوری کے لیے پھر بھی آپ کو بٹن دبانا ہوگا۔';

  @override
  String get clMockProfileVerified => 'تصدیق شدہ اکاؤنٹ';

  @override
  String get clMockPendingDrafts => 'زیر التوا مسودے';

  @override
  String get clMockActiveSite => 'فعال سائٹ';

  @override
  String get clMockCountryCurrency => 'ملک اور کرنسی';

  @override
  String get clMockRolesAccess => 'میرے کردار اور رسائی';

  @override
  String clMockModuleCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ماڈیولز',
      one: '1 ماڈیول',
    );
    return '$_temp0';
  }

  @override
  String get clMockChecklistLanguage => 'چیک لسٹ مواد کی زبان';

  @override
  String get clMockChecklistLanguageCaption => 'ایپ کی زبان سے الگ';

  @override
  String get clMockSectionSecurity => 'سیکیورٹی اور شناخت';

  @override
  String get clMockSavedSignature => 'میرے محفوظ دستخط';

  @override
  String get clMockSignatureNotSaved => 'محفوظ نہیں';

  @override
  String get clMockSignatureCaptured => 'محفوظ شدہ';

  @override
  String clMockSignatureCapturedOn(String date) {
    return 'محفوظ · تازہ کاری $date';
  }

  @override
  String get clMockSignatureSheetHint =>
      'منظوری کی اسکرینیں یہ آپ کے لیے بھر دیتی ہیں۔ منظور آپ خود ہی دباتے ہیں۔';

  @override
  String get clMockSignatureSave => 'بطور میرے دستخط محفوظ کریں';

  @override
  String get clMockSignatureRemove => 'محفوظ دستخط ہٹائیں';

  @override
  String get clMockSignatureRemoveTitle =>
      'کیا آپ اپنے محفوظ دستخط ہٹانا چاہتے ہیں؟';

  @override
  String get clMockSignatureRemoveMessage =>
      'نئے دستخط محفوظ کرنے تک منظوریاں خالی دستخط خانے سے شروع ہوں گی۔';

  @override
  String get clMockSignatureSaveFailed =>
      'آپ کے دستخط اپ ڈیٹ نہیں ہو سکے۔ کنکشن چیک کریں اور دوبارہ کوشش کریں۔';

  @override
  String get clMockOfflineDrafts => 'آف لائن مسودے';

  @override
  String clMockDraftsStored(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count اس ڈیوائس پر محفوظ',
      one: '1 اس ڈیوائس پر محفوظ',
      zero: 'کوئی نہیں',
    );
    return '$_temp0';
  }
}
