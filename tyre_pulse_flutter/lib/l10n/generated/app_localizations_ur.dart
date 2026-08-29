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
  String get vehiclesSearchHint => 'اثاثہ نمبر، ساخت، قسم یا سائٹ تلاش کریں';

  @override
  String get vehiclesTyreAssetsFilter => 'ٹائر والے اثاثے';

  @override
  String get vehiclesAllFilter => 'تمام';

  @override
  String get vehiclesEmptyTitle => 'کوئی گاڑی نہیں ملی';

  @override
  String get vehiclesEmptySearchMessage => 'مختلف تلاش کی اصطلاح آزمائیں۔';

  @override
  String get vehiclesDetailSubtitle => 'گاڑی کی تفصیلات';

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
  String get checklistsLibraryTitle => 'معائنہ لائبریری';

  @override
  String get checklistsLibrarySubtitle =>
      'اثاثے کے لیے درست ورک فلو منتخب کریں';

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
  String get checklistPhotosOnFailure =>
      'ناکام آئٹمز کے لیے تصاویر درکار ہیں';

  @override
  String get checklistStartAction => 'شروع کریں';

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
  String get checklistApprovalReviewTitle => 'منظوری';

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
  String get meterLogNavTitle => 'روزانہ میٹر لاگ';

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
  String get washNavTitle => 'گاڑی دھلائی';

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
  String get loginTagline => 'TyrePulse · ٹائر مین پورٹل';

  @override
  String get loginCardTitle => 'سائن ان کریں';

  @override
  String get loginCardSubtitle =>
      'اپنا ای میل، صارف نام یا ملازم نمبر استعمال کریں';

  @override
  String get loginIdentifierLabel => 'ای میل / صارف نام / ملازم نمبر';

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
  String get loginOperationsTitle => 'مکمل PMV آپریشنز';

  @override
  String get loginWelcomeTitle => 'دوبارہ خوش آمدید';

  @override
  String get loginWelcomeSubtitle =>
      'اپنی تفویض کردہ کارروائیوں میں سائن ان کریں';

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
  String get tasksCopyCatalog =>
      'title=میرا کام~today=آج~inProgress=جاری~completed=مکمل~urgent=فوری~upcoming=آنے والا~open=کھلے~emptyTitle=کوئی کام نہیں~emptyMessage=اس منظر سے کوئی کام مطابقت نہیں رکھتا۔~loadError=میرا کام ابھی لوڈ نہیں ہو سکا۔~due=مقررہ تاریخ~assigned=تفویض شدہ~unassigned=غیر تفویض شدہ~normal=عام~overdue=تاخیر شدہ~details=کام کی تفصیل~description=تفصیل~site=سائٹ~asset=اثاثہ~priority=ترجیح~status=حالت~retry=دوبارہ کوشش';

  @override
  String get alertsCopyCatalog =>
      'title=ٹائر الرٹس~all=تمام~critical=سنگین~warnings=انتباہات~info=معلومات~flagged=نشان زدہ~criticalCount=سنگین~emptyTitle=کوئی فعال الرٹ نہیں~emptyFilter=اس فلٹر سے کوئی الرٹ نہیں ملا۔~loadError=الرٹس لوڈ نہیں ہو سکے۔ دوبارہ کوشش کے لیے نیچے کھینچیں۔~unknownAsset=نامعلوم اثاثہ~pressureLow=ٹائر کا دباؤ کم ہے~treadLow=ٹریڈ کی گہرائی کم ہے~position=پوزیشن~serial=سیریل~tread=ٹریڈ~retry=دوبارہ کوشش';

  @override
  String get notificationInboxCopyCatalog =>
      'title=اطلاعات~markAll=سب کو پڑھا ہوا کریں~fallbackTitle=اطلاع~emptyTitle=آپ تمام تازہ معلومات دیکھ چکے ہیں~emptyBody=ذمہ داریاں، منظوریوں اور عملی اپ ڈیٹس یہاں نظر آئیں گی۔~loadFailed=اطلاعات لوڈ نہیں ہو سکیں۔ دوبارہ کوشش کے لیے نیچے کھینچیں۔~markFailed=اس اطلاع کو پڑھا ہوا نہیں کیا جا سکا۔~markAllFailed=تمام اطلاعات کو پڑھا ہوا نہیں کیا جا سکا۔~justNow=ابھی~minutesAgo=%count% منٹ پہلے~hoursAgo=%count% گھنٹے پہلے~daysAgo=%count% دن پہلے';

  @override
  String get reportIssueCopyCatalog =>
      'title=مسئلہ رپورٹ کریں~problem=مسئلہ کیا ہے؟~problemHint=مسئلے کی مختصر وضاحت کریں~priority=ترجیح~low=کم~medium=درمیانی~high=زیادہ~critical=سنگین~site=سائٹ~siteHint=جہاں مسئلہ ملا~asset=اثاثہ~assetHint=اثاثہ نمبر~due=مقررہ مدت~noDate=کوئی تاریخ نہیں~threeDays=3 دن~oneWeek=1 ہفتہ~twoWeeks=2 ہفتے~details=تفصیلات~detailsHint=علامات، مقام اور فوری کارروائی درج کریں~photos=تصاویر~optional=(اختیاری)~addPhoto=تصویر شامل کریں~camera=کیمرہ~gallery=گیلری~photoFailed=تصویر شامل نہیں ہو سکی۔~submit=مسئلہ درج کریں~titleRequired=محفوظ کرنے سے پہلے مسئلے کا عنوان درج کریں۔~workspaceUnavailable=آپ کی ورک اسپیس لوڈ ہو رہی ہے۔ کچھ دیر بعد دوبارہ کوشش کریں۔~savedTitle=مسئلہ محفوظ ہو گیا~savedBody=مسئلہ میرے کام میں شامل ہے اور خودکار طور پر سنک ہو گا۔~stay=یہیں رہیں~viewTasks=میرا کام دیکھیں~saveFailed=مسئلہ محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔';

  @override
  String get rcaCopyCatalog =>
      'title=بنیادی وجہ کا تجزیہ~records=ریکارڈز~newRecord=نیا تجزیہ~none=کوئی تجزیاتی ریکارڈ نہیں~noneBody=مکمل بنیادی وجہ کے ریکارڈ یہاں نظر آئیں گے۔~unknown=نامعلوم اثاثہ~asset=اثاثہ~serial=ٹائر سیریل~brand=برانڈ~site=سائٹ~km=خرابی کے وقت کلومیٹر~factors=معاون عوامل~rootCause=بنیادی وجہ~photos=ثبوت کی تصاویر~photo=تصویر~addPhoto=تصویر شامل کریں~camera=کیمرہ~gallery=گیلری~photoFailed=تصویر شامل نہیں ہو سکی۔~save=تجزیہ محفوظ کریں~missingCause=محفوظ کرنے سے پہلے بنیادی وجہ درج کریں۔~invalidKm=درست کلومیٹر ریڈنگ درج کریں۔~loadFailed=تجزیاتی ریکارڈ لوڈ نہیں ہو سکے۔~saveFailed=تجزیہ محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔';

  @override
  String get pmCopyCatalog =>
      'title=احتیاطی دیکھ بھال~overdue=تاخیر شدہ~dueSoon=جلد واجب~active=فعال منصوبے~due=اب واجب~all=تمام منصوبے~empty=دیکھ بھال کا کوئی منصوبہ نہیں~emptyDue=اگلے 14 دنوں میں کوئی احتیاطی دیکھ بھال واجب نہیں۔~emptyAll=کوئی فعال احتیاطی دیکھ بھال منصوبہ دستیاب نہیں۔~plan=دیکھ بھال منصوبہ~daysOverdue=دن تاخیر~daysLeft=دن باقی~noDate=واجب تاریخ نہیں~record=سروس ریکارڈ کریں~meter=میٹر ریڈنگ~performedBy=کام کرنے والا~workshop=ورکشاپ~partsCost=پرزوں کی قیمت~labourCost=مزدوری کی قیمت~findings=مشاہدات~completed=مکمل~partial=جزوی مکمل~deferred=ملتوی~failed=ناکام~save=سروس محفوظ کریں~invalidNumber=درست عددی قدریں درج کریں۔~loadFailed=دیکھ بھال منصوبے لوڈ نہیں ہو سکے۔~saveFailed=سروس ریکارڈ محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔';

  @override
  String get stockCountCopyCatalog =>
      'title=اسٹاک گنتی~items=اشیاء~reorder=دوبارہ آرڈر~notToday=آج نہیں گنا~search=تفصیل یا سائٹ تلاش کریں~all=تمام~low=کم اسٹاک~stale=آج نہیں گنا~empty=کوئی اسٹاک آئٹم نہیں~emptyBody=کوئی اسٹاک ریکارڈ ان فلٹرز سے میل نہیں کھاتا۔~count=گنتی~stockItem=اسٹاک آئٹم~physicalCount=اصل گنتی~reason=وجہ (اختیاری)~cancel=منسوخ~save=گنتی محفوظ کریں~invalid=صفر یا زیادہ گنتی درج کریں۔~offlineSaved=گنتی آف لائن محفوظ اور ہم وقت سازی کے لیے قطار میں ہے۔~saveFailed=اسٹاک گنتی محفوظ نہیں ہو سکی۔~loadFailed=اسٹاک ریکارڈ لوڈ نہیں ہو سکے۔~Critical=انتہائی کم~Low=کم~OK=درست~onHand=دستیاب';

  @override
  String get calendarCopyCatalog =>
      'title=کیلنڈر~scheduled=مقررہ~overdue=تاخیر شدہ~today=آج واجب~week=اس ہفتے~later=بعد میں~inspection=معائنہ~maintenance=دیکھ بھال~task=اصلاحی کام~empty=کچھ مقرر نہیں~emptyBody=آنے والے معائنے، دیکھ بھال اور اصلاحی کام یہاں نظر آئیں گے۔~loadFailed=شیڈول لوڈ نہیں ہو سکا۔';

  @override
  String get managementCopyCatalog =>
      'overviewTitle=فلیٹ جائزہ~analyticsTitle=فلیٹ تجزیات~reportsTitle=رپورٹس~reportsSubtitle=مستند انتظامی خلاصہ~teamTitle=ٹیم~last=آخری~days=دن~days30=30 دن~days90=90 دن~year1=1 سال~allSites=تمام سائٹس~tyres=ٹائر~vehicles=گاڑیاں~critical=انتہائی اہم~openActions=کھلے اقدامات~highRisk=زیادہ خطرہ~inspections30=معائنے (30 دن)~tyreSpend=ٹائر خرچ~risk=خطرے کی تقسیم~sites=نمایاں سائٹس~brands=نمایاں برانڈز~analyticsFailed=تجزیات لوڈ نہیں ہو سکے۔~reportsFailed=رپورٹ ڈیٹا لوڈ نہیں ہو سکا۔~reportUnavailable=براہ راست رپورٹ دستیاب نہیں~reportUnavailableBody=مستند سرور خلاصہ دستیاب نہیں۔ کوئی اعداد وضع نہیں کیے گئے۔~retry=دوبارہ کوشش~generated=تیار شدہ~costPerformance=لاگت اور کارکردگی~fleet=فلیٹ~tyre_spend=ٹائر خرچ~accidents=حادثات~open_accidents=کھلے حادثات~claims_claimed=جمع دعوے~claims_recovered=وصول دعوے~inspections=معائنے~work_orders_open=کھلے ورک آرڈر~tyre_cost=ٹائر لاگت~maintenance_cost=دیکھ بھال لاگت~total_cost=کل لاگت~km=کلومیٹر~engine_hours=انجن گھنٹے~m3=پیداوار م3~cost_per_km=فی کلومیٹر لاگت~cost_per_hour=فی گھنٹہ لاگت~cost_per_m3=فی م3 لاگت~tyre_cpk=ٹائر سی پی کے~severity=حادثے کی شدت~accidents_by_site=سائٹ کے لحاظ سے حادثات~tyres_by_site=سائٹ کے لحاظ سے ٹائر~claim_status=دعویٰ حالت~members=ارکان~manage=ٹیم انتظام~active=فعال~pending=زیر التوا~teamSearch=نام، کردار یا سائٹ تلاش کریں~noMembers=کوئی رکن نہیں~trySearch=دوسری تلاش آزمائیں۔~teamFailed=ٹیم ڈائریکٹری لوڈ نہیں ہو سکی۔';

  @override
  String get profileSignOutConfirmTitle => 'سائن آؤٹ کریں؟';

  @override
  String get profileSignOutConfirmMessage =>
      'کام جاری رکھنے کے لیے آپ کو دوبارہ سائن ان کرنا ہوگا۔ اس ڈیوائس پر پہلے سے محفوظ کام محفوظ رہے گا۔';

  @override
  String get accidentCopyCatalog =>
      'loadFailed=حادثہ ریکارڈ لوڈ نہیں ہو سکا۔ دوبارہ کوشش کریں۔~notRecorded=درج نہیں~dashboardTitle=حادثہ کمانڈ سینٹر~dashboardSubtitle=اجازت کے مطابق براہ راست رجسٹر~reportAction=حادثہ رپورٹ کریں~reportShort=رپورٹ~loadingRegister=حادثہ رجسٹر لوڈ ہو رہا ہے…~dashboardEyebrow=PMV حادثہ کنٹرول~dashboardHeroTitle=ہر کیس، ایک جواب دہ راستہ~dashboardHeroMessage=فلیٹ، انشورنس، ورکشاپ، QC، حوالگی اور ریکوری بغیر فرضی KPI کے واضح رہتے ہیں۔~searchHint=اثاثہ، حوالہ، سائٹ یا مقام تلاش کریں~allCases=تمام کیس~reportedByMe=میری رپورٹس~anyStatus=کوئی بھی حالت~open=کھلا~closed=بند~noMatches=کوئی مماثل کیس نہیں~noMatchesMessage=فلٹر بدلیں یا نئی حادثہ رپورٹ بنائیں۔~loadMore=مزید کیس لوڈ کریں~loading=لوڈ ہو رہا ہے…~detailTitle=حادثے کی تفصیل~loadingFacts=کیس کے حقائق لوڈ ہو رہے ہیں…~notFound=حادثہ نہیں ملا~notFoundMessage=یہ ریکارڈ آپ کی رسائی سے باہر ہے یا موجود نہیں۔~openFlow=جواب دہ کیس فلو کھولیں~incidentFacts=حادثے کے حقائق~incidentFactsHint=رپورٹر کے ثبوت اور گاڑی کی شناخت~liability=ذمہ داری اور ادائیگی~liabilityHint=قصوروار، ذمہ دار اور ادائیگی کرنے والا~insurance=انشورنس اور ریکوری~insuranceHint=دعویٰ اور ریکوری بندش سے الگ ہیں~workshopRelease=ورکشاپ اور ریلیز~workshopReleaseHint=تشخیص، مرمت، QC اور گاڑی کی واپسی~closure=بندش کے کنٹرول~closureHint=پرانا منظوری عمل اور جدید کیس حالت الگ ہیں~vehicleType=گاڑی کی قسم~plate=پلیٹ / فلیٹ نمبر~type=حادثے کی قسم~severity=شدت~reporter=رپورٹر~evidenceFiles=ثبوت فائلیں~description=تفصیل~damage=نقصان~fault=غلطی کی حالت~responsible=قصوروار فریق~liable=ذمہ دار فریق~payer=ادائیگی کرنے والا~insurer=انشورنس کمپنی~policy=پالیسی~claimNo=دعویٰ نمبر~claimStatus=دعویٰ حالت~claimed=دعویٰ رقم~approved=منظور رقم~recoveryStatus=ریکوری حالت~recovered=وصول رقم~repairType=مرمت کی قسم~workshop=ورکشاپ~repairCost=مرمت لاگت~expectedRelease=متوقع ریلیز~actualRelease=اصل ریلیز~nextAction=اگلا اقدام~workflowStage=ورک فلو مرحلہ~caseStatus=کیس حالت~closureRequest=بندش درخواست~closureLevel=بندش سطح~caseTitle=کیس جواب دہی~loadingWorkstreams=ورک اسٹریم لوڈ ہو رہے ہیں…~caseNotFound=کیس نہیں ملا~caseNotFoundMessage=یہ حادثہ آپ کی اجازت سے باہر ہے یا موجود نہیں۔~endToEnd=مکمل کیس فلو~notActivated=کیس ورک فلو فعال نہیں~notActivatedMessage=حادثہ موجود ہے لیکن ورک اسٹریم ماڈل تیار نہیں۔ کوئی پیش رفت فرض نہیں کی گئی۔~noWorkstreams=کوئی ورک اسٹریم مقرر نہیں~noWorkstreamsMessage=کیس ماڈل دستیاب ہے لیکن ابھی راستہ مقرر نہیں ہوا۔~timeline=جواب دہ ٹائم لائن~timelineHint=کیس ورک اسٹریم لیجر کی صرف پڑھنے والی حقیقت~boundary=کنٹرول حد~boundaryHint=اقدامات فرض نہیں کیے گئے~boundaryMessage=انشورنس، تشخیص، مرمت، QC، حوالگی، بندش اور ریکوری فیصلوں کے لیے تصدیق شدہ سرور عمل ضروری ہیں۔ غیر محفوظ براہ راست ترمیم نہیں۔~done=مکمل~inProgress=جاری~pending=زیر التوا~notRequired=ضروری نہیں~reason=وجہ~wsIncident=حادثہ اور ثبوت~wsFleet=فلیٹ تصدیق~wsLiability=ذمہ داری اور حفاظت~wsInsurance=انشورنس دعویٰ~wsAssessment=ورکشاپ تشخیص~wsRepair=مرمت عمل~wsQc=ورکشاپ QC~wsHandover=گاڑی حوالگی~wsFinance=ریکوری اور مالیات~wsCorrective=اصلاحی اقدامات~selectAsset=فلیٹ اثاثہ منتخب کریں~changeAsset=اثاثہ بدلیں~assetSearch=اثاثہ، فلیٹ نمبر، پلیٹ یا ماڈل~unrecordedAsset=غیر درج اثاثہ~photoFailed=ثبوت تصویر محفوظ نہیں ہو سکی۔ دوبارہ کوشش کریں۔~workspaceLoading=ورک اسپیس ابھی لوڈ ہو رہی ہے۔ دوبارہ کوشش کریں۔~required=اثاثہ، سائٹ، تفصیل اور کم از کم ایک ثبوت تصویر ضروری ہے۔~fieldsDropped=تمام فیلڈ محفوظ نہیں ہوئے۔ رپورٹ جمع شدہ نہیں دکھائی گئی۔~saveFailed=رپورٹ اس آلے پر محفوظ نہیں ہو سکی۔ دوبارہ کوشش کریں۔~saved=رپورٹ محفوظ~savedTitle=حادثہ رپورٹ محفوظ ہو گئی~savedMessage=رپورٹ اور ثبوت آلے کی سنک قطار میں ہیں اور فعال ورک اسپیس کے تحت اپلوڈ ہوں گے۔~backRegister=حادثہ رجسٹر واپس جائیں~reportTitle=حادثہ رپورٹ کریں~reportSubtitle=آف لائن محفوظ ثبوت~firstResponse=پہلا ردعمل~captureFacts=موقع پر حقائق درج کریں~captureFactsMessage=پہلے اثاثہ منتخب کریں تاکہ PMV ماسٹر سائٹ اور شناخت بھرے۔ کم از کم ایک ثبوت تصویر لازمی ہے۔~assetLocation=1. اثاثہ اور مقام~assetLocationHint=دستیاب ہونے پر فلیٹ ماسٹر مستند ہے~fleetUnavailable=فلیٹ تلاش دستیاب نہیں۔ دستی اندراج دستیاب ہے۔~assetNo=اثاثہ نمبر~site=سائٹ~exactLocation=حادثے کا درست مقام~classification=2. درجہ بندی~classificationHint=ابتدائی میدانی درجہ بندی بعد میں دیکھی جا سکتی ہے~minor=معمولی~moderate=درمیانہ~severe=شدید~fatal=جان لیوا~collision=تصادم~rollover=الٹنا~propertyDamage=املاک نقصان~other=دیگر~whatHappened=کیا ہوا؟~notes=فوری نوٹس~evidence=3. ثبوت~evidenceAttached=ثبوت تصاویر منسلک • کم از کم 1~camera=کیمرہ~gallery=گیلری~evidencePhoto=ثبوت تصویر~removePhoto=تصویر ہٹائیں~saveReport=حادثہ رپورٹ محفوظ کریں';
}
