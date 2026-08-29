// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appTitle => 'Tyre Pulse';

  @override
  String get actionBack => 'رجوع';

  @override
  String get actionRetry => 'أعد المحاولة';

  @override
  String get actionClose => 'إغلاق';

  @override
  String get actionCancel => 'إلغاء';

  @override
  String get actionSignIn => 'تسجيل الدخول';

  @override
  String get actionSignOut => 'تسجيل الخروج';

  @override
  String get actionOpenStore => 'افتح المتجر';

  @override
  String get actionClear => 'مسح';

  @override
  String get valueUnavailable => 'غير متاح';

  @override
  String get valueNotMeasured => '-';

  @override
  String get stateLoading => 'جارٍ التحميل';

  @override
  String get stateEmptyTitle => 'لا يوجد شيء بعد';

  @override
  String get stateEmptyMessage => 'عند توفر بيانات سوف تظهر هنا.';

  @override
  String get stateErrorTitle => 'حدث خطأ ما';

  @override
  String get stateErrorMessage =>
      'لم يكتمل الإجراء الأخير. لم يتم تغيير أي شيء.';

  @override
  String get stateOfflineCachedTitle => 'عرض بيانات محفوظة';

  @override
  String get stateOfflineCachedMessage =>
      'أنت غير متصل. هذه نسخة محفوظة على هذا الجهاز وقد تكون قديمة.';

  @override
  String stateOfflineCachedAt(String timestamp) {
    return 'محفوظة $timestamp';
  }

  @override
  String get stateBackendUnavailableTitle => 'الخادم لا يستجيب';

  @override
  String get stateBackendUnavailableMessage =>
      'عملك محفوظ على هذا الجهاز وسوف يُرسل عند عودة الاتصال.';

  @override
  String get stateNotConfiguredTitle => 'غير مهيأ';

  @override
  String get stateNotConfiguredMessage =>
      'لم يتم تفعيل هذا الجزء من التطبيق لمؤسستك. يمكن لمسؤول النظام تفعيله.';

  @override
  String get stateScreenNotAvailableTitle => 'هذه الشاشة غير جاهزة بعد';

  @override
  String get stateScreenNotAvailableMessage =>
      'التنقل إليها يعمل، لكن الشاشة نفسها لم تُبنَ بعد. هذا عمل قيد التطوير وليس خطأ في حسابك.';

  @override
  String get deniedTitle => 'لا تملك صلاحية الوصول إلى هذه الشاشة';

  @override
  String get deniedNotGranted =>
      'لا تملك صلاحية الوصول إلى هذه الوحدة. تواصل مع مسؤول النظام.';

  @override
  String get deniedAdminOnly => 'هذه الشاشة لمسؤولي النظام فقط.';

  @override
  String get deniedSuperAdminOnly => 'هذه الشاشة لمالك المنصة فقط.';

  @override
  String get deniedPermissionsUnavailable =>
      'تعذرت قراءة صلاحياتك، لذلك أُغلقت هذه الشاشة حتى يمكن قراءتها. بقية التطبيق تعمل.';

  @override
  String get offlineTitle => 'غير متصل';

  @override
  String get offlineMessage =>
      'يمكنك متابعة العمل. كل شيء محفوظ على هذا الجهاز.';

  @override
  String syncPendingChanges(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count تغيير بانتظار المزامنة',
      many: '$count تغييرًا بانتظار المزامنة',
      few: '$count تغييرات بانتظار المزامنة',
      two: 'تغييران بانتظار المزامنة',
      one: 'تغيير واحد بانتظار المزامنة',
      zero: 'لا توجد تغييرات بانتظار المزامنة',
    );
    return '$_temp0';
  }

  @override
  String syncInProgress(int completed, int total) {
    return 'جارٍ المزامنة $completed من $total';
  }

  @override
  String get syncAllSynced => 'تمت مزامنة جميع التغييرات';

  @override
  String syncNeedsAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count عنصر يحتاج انتباهًا',
      many: '$count عنصرًا يحتاج انتباهًا',
      few: '$count عناصر تحتاج انتباهًا',
      two: 'عنصران يحتاجان انتباهًا',
      one: 'عنصر واحد يحتاج انتباهًا',
      zero: 'لا يوجد ما يحتاج انتباهًا',
    );
    return '$_temp0';
  }

  @override
  String get syncStatusUnknown => 'حالة الاتصال غير معروفة';

  @override
  String get sessionRestoringTitle => 'جارٍ فتح Tyre Pulse';

  @override
  String get sessionTimedOutTitle => 'الأمر يستغرق وقتًا أطول من المعتاد';

  @override
  String get sessionTimedOutMessage =>
      'تعذر فتح تسجيل دخولك المحفوظ. يمكنك إعادة المحاولة أو تسجيل الدخول من جديد.';

  @override
  String get updateRequiredTitle => 'التحديث مطلوب';

  @override
  String get updateRequiredMessage =>
      'هذه النسخة من Tyre Pulse قديمة جدًا للاستمرار. ثبّت التحديث للمتابعة.';

  @override
  String get profileUnavailableTitle => 'تعذر تحميل ملفك الشخصي';

  @override
  String get profileUnavailableMessage =>
      'لم تُحمّل بيانات حسابك، لذلك لا يستطيع التطبيق تحديد صلاحياتك. أعد المحاولة أو سجّل الخروج ثم الدخول.';

  @override
  String get accessBlockedTitle => 'حسابك غير مفعّل';

  @override
  String get accessBlockedMessage =>
      'حسابك بانتظار الموافقة أو تم قفله. يمكن لمسؤول النظام معالجة ذلك.';

  @override
  String get routeNotFoundTitle => 'هذه الشاشة غير موجودة';

  @override
  String get routeNotFoundMessage =>
      'الرابط الذي فتحته لا يشير إلى أي مكان في هذا التطبيق.';

  @override
  String get tabHome => 'الرئيسية';

  @override
  String get tabInspect => 'الفحص';

  @override
  String get tabAccidents => 'الحوادث';

  @override
  String get tabMeter => 'العداد';

  @override
  String get tabWashing => 'الغسيل';

  @override
  String get tabProfile => 'حسابي';

  @override
  String get tabHistory => 'السجل';

  @override
  String get tabChecklists => 'قوائم الفحص';

  @override
  String get tabApprovals => 'الاعتمادات';

  @override
  String get searchHint => 'بحث';

  @override
  String get dropdownHint => 'اختر';

  @override
  String get fieldRequired => 'مطلوب';

  @override
  String get statusOk => 'سليم';

  @override
  String get statusWarning => 'يحتاج انتباه';

  @override
  String get statusCritical => 'حرج';

  @override
  String get statusInfo => 'معلومة';

  @override
  String get statusNeutral => 'محايد';

  @override
  String get statusUnknown => 'لم يُقَس';

  @override
  String get vehiclesTitle => 'المركبات';

  @override
  String vehiclesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count مركبة في الأسطول',
      many: '$count مركبةً في الأسطول',
      few: '$count مركبات في الأسطول',
      two: 'مركبتان في الأسطول',
      one: 'مركبة واحدة في الأسطول',
      zero: 'لا توجد مركبات في الأسطول',
    );
    return '$_temp0';
  }

  @override
  String get vehiclesSearchHint => 'ابحث بالأصل أو النوع أو الموقع';

  @override
  String get vehiclesTyreAssetsFilter => 'أصول الإطارات';

  @override
  String get vehiclesAllFilter => 'الكل';

  @override
  String get vehiclesEmptyTitle => 'لا توجد مركبات';

  @override
  String get vehiclesEmptySearchMessage => 'جرّب مصطلح بحث مختلف.';

  @override
  String get vehiclesDetailSubtitle => 'تفاصيل المركبة';

  @override
  String get vehiclesUnknownAsset => 'مركبة غير معروفة';

  @override
  String get vehiclesFieldFleetNo => 'رقم الأسطول';

  @override
  String get vehiclesFieldType => 'النوع';

  @override
  String get vehiclesFieldMakeModel => 'الصنع والطراز';

  @override
  String get vehiclesFieldYear => 'السنة';

  @override
  String get vehiclesFieldCurrentKm => 'عداد المسافات الحالي';

  @override
  String get vehiclesFieldOperator => 'المشغّل';

  @override
  String get vehiclesFieldDepartment => 'القسم';

  @override
  String get vehiclesFieldSite => 'الموقع';

  @override
  String get vehiclesFieldRegion => 'المنطقة';

  @override
  String get vehiclesFieldCountry => 'الدولة';

  @override
  String get vehiclesFieldTyreSize => 'مقاس الإطار';

  @override
  String get vehiclesFieldRegistration => 'التسجيل';

  @override
  String get vehiclesStartInspection => 'بدء الفحص';

  @override
  String get vehiclesNotFoundTitle => 'المركبة غير موجودة';

  @override
  String get vehiclesNotFoundMessage =>
      'تعذّر العثور على هذه المركبة في سجل الأسطول. ربما تمت إزالتها أو نقلها إلى دولة أخرى.';

  @override
  String get vehiclesTruncatedNotice =>
      'يتم عرض جزء من الأسطول. ضيّق نطاق البحث للعثور على مركبة معيّنة.';

  @override
  String get serialSearchTitle => 'البحث بالرقم التسلسلي';

  @override
  String get serialSearchSubtitle => 'ابحث عن إطار برقمه التسلسلي';

  @override
  String get serialSearchLabel => 'الرقم التسلسلي للإطار';

  @override
  String get serialSearchPlaceholder => 'اكتب أو الصق رقماً تسلسلياً';

  @override
  String get serialSearchHelp =>
      'يتم فك تغليف الملصقات والروابط ونصوص QR الممسوحة تلقائياً.';

  @override
  String get serialSearchSearching => 'جارٍ البحث عن الإطار...';

  @override
  String get serialSearchFound => 'تم العثور على الإطار';

  @override
  String get serialSearchBrand => 'العلامة التجارية';

  @override
  String get serialSearchSize => 'المقاس';

  @override
  String get serialSearchPosition => 'الموضع';

  @override
  String get serialSearchAsset => 'الأصل';

  @override
  String get serialSearchSite => 'الموقع';

  @override
  String get serialSearchLastReading => 'آخر قراءة';

  @override
  String get serialSearchInspectThis => 'افحص هذا الإطار';

  @override
  String get serialSearchNoAssetNote =>
      'هذا الإطار غير مركّب على أصل، لذا لا يمكن بدء فحص من هنا.';

  @override
  String get serialSearchEmptyTitle => 'لم يُعثر على إطار بهذا الرقم التسلسلي';

  @override
  String get serialSearchEmptyMessage =>
      'تحقق من الرقم التسلسلي وحاول مجدداً. قد يكون تابعاً لموقع آخر، أو قد لا يكون مسجّلاً بعد.';

  @override
  String get serialSearchIdleTitle => 'ابحث عن رقم تسلسلي للإطار';

  @override
  String get serialSearchIdleMessage =>
      'أدخل رقماً تسلسلياً أعلاه لعرض علامة الإطار ومقاسه وموضع تركيبه وآخر قراءة.';

  @override
  String get serialSearchScrappedBadge => 'مشطوب';

  @override
  String get serialSearchScrapReasonLabel => 'السبب';

  @override
  String get serialSearchScrapReasonPlaceholder => 'لماذا يتم شطب هذا الإطار؟';

  @override
  String get serialSearchMarkScrap => 'وضع علامة شطب';

  @override
  String get serialSearchUndoScrap => 'التراجع عن الشطب';

  @override
  String get serialSearchScrapModalTitle => 'شطب هذا الإطار';

  @override
  String get serialSearchConfirmScrap => 'تأكيد الشطب';

  @override
  String get serialSearchUndoConfirmTitle => 'التراجع عن هذا الشطب؟';

  @override
  String get serialSearchUndoConfirmMessage =>
      'سيتم تعيين هذا الإطار كنشط مرة أخرى.';

  @override
  String get scannerTitle => 'مسح ضوئي';

  @override
  String get scannerCameraUnavailableTitle =>
      'المسح بالكاميرا غير متاح في هذا الإصدار';

  @override
  String get scannerCameraUnavailableMessage =>
      'اكتب أو الصق الرمز الموجود على الملصق بدلاً من ذلك. كل ما يلي يعمل تمامًا كما لو تم مسحه.';

  @override
  String get scannerCameraPermissionDeniedReason =>
      'تم رفض الوصول إلى الكاميرا. اكتب أو الصق الرمز الموجود على الملصق بدلاً من ذلك.';

  @override
  String get scannerManualEntryLabel => 'أدخل رمزاً';

  @override
  String get scannerCodeFieldLabel => 'رمز الأصل أو الإطار';

  @override
  String get scannerCodeFieldHint => 'مثال: TM514 أو رقم تسلسلي لإطار';

  @override
  String get scannerLookUpAction => 'ابحث';

  @override
  String get scannerNoMatchTitle => 'لا توجد نتيجة لهذا الرمز';

  @override
  String get scannerNoMatchMessage =>
      'تحقق من الرمز وحاول مجدداً، أو افتح البحث بالرقم التسلسلي لمزيد من البحث.';

  @override
  String get scannerOpenSerialSearchAction => 'افتح البحث بالرقم التسلسلي';

  @override
  String get scannerScanAnotherAction => 'ابحث عن رمز آخر';

  @override
  String get scannerViewAssetAction => 'عرض الأصل';

  @override
  String get scannerStartInspectionAction => 'بدء الفحص';

  @override
  String get scannerViewTyreAction => 'عرض الإطار';

  @override
  String get recordsTitle => 'سجلات الإطارات';

  @override
  String recordsShownCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'يُعرض $count سجل إطار',
      many: 'يُعرض $count سجل إطار',
      few: 'تُعرض $count سجلات إطارات',
      two: 'يُعرض سجلا إطار',
      one: 'يُعرض سجل إطار واحد',
      zero: 'لا توجد سجلات إطارات',
    );
    return '$_temp0';
  }

  @override
  String get recordsSearchHint =>
      'البحث برقم الأصل أو الرقم التسلسلي أو العلامة التجارية';

  @override
  String get recordsEmptyTitle => 'لم يتم العثور على سجلات';

  @override
  String get recordsEmptyMessage => 'جرّب بحثاً مختلفاً أو امسح عوامل التصفية.';

  @override
  String get recordsLoadMoreError => 'تعذّر تحميل المزيد من السجلات.';

  @override
  String get recordsEndOfList => 'لقد وصلت إلى نهاية القائمة.';

  @override
  String get recordsFilterTitle => 'تصفية السجلات';

  @override
  String get recordsRiskLevel => 'مستوى الخطورة';

  @override
  String get recordsSite => 'الموقع';

  @override
  String get recordsApplyFilters => 'تطبيق عوامل التصفية';

  @override
  String get recordsClearFilters => 'مسح عوامل التصفية';

  @override
  String recordsActiveFilters(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count عامل تصفية نشط',
      many: '$count عامل تصفية نشطاً',
      few: '$count عوامل تصفية نشطة',
      two: 'عاملا تصفية نشطان',
      one: 'عامل تصفية واحد نشط',
      zero: 'لا توجد عوامل تصفية نشطة',
    );
    return '$_temp0';
  }

  @override
  String get recordsSerialNo => 'الرقم التسلسلي';

  @override
  String get recordsIssueDate => 'تاريخ الإصدار';

  @override
  String get recordsCategory => 'الفئة';

  @override
  String get recordsCostPerTyre => 'التكلفة لكل إطار';

  @override
  String get recordsKmFitment => 'الكيلومترات عند التركيب';

  @override
  String get recordsKmRemoval => 'الكيلومترات عند الإزالة';

  @override
  String get recordsTyreLife => 'عمر الإطار (كم)';

  @override
  String get recordsCountry => 'الدولة';

  @override
  String get recordsDescription => 'الوصف';

  @override
  String get recordsRemarks => 'ملاحظات';

  @override
  String get recordsDetailFallbackTitle => 'سجل إطار';

  @override
  String get tyreDiagramFrontLabel => 'الأمام';

  @override
  String get tyreDiagramTapHint => 'اضغط على إطار لتسجيل حالته';

  @override
  String tyreDiagramTyreCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count إطار',
      many: '$count إطارًا',
      few: '$count إطارات',
      two: 'إطاران',
      one: 'إطار واحد',
      zero: 'لا إطارات',
    );
    return '$_temp0';
  }

  @override
  String tyreDiagramPendingLeadIn(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count إطار لا يزال بحاجة إلى تفاصيل',
      many: '$count إطارًا لا يزال بحاجة إلى تفاصيل',
      few: '$count إطارات لا تزال بحاجة إلى تفاصيل',
      two: 'إطاران لا يزالان بحاجة إلى تفاصيل',
      one: 'إطار واحد لا يزال بحاجة إلى تفاصيل',
      zero: 'لا إطارات لا تزال بحاجة إلى تفاصيل',
    );
    return '$_temp0';
  }

  @override
  String get tyreDiagramTyrelessMessage => 'معدات ثابتة، لا توجد إطارات للفحص.';

  @override
  String get tyreDiagramEmptyMessage => 'لا توجد مواضع إطارات لعرضها.';

  @override
  String tyreDiagramPressureDetail(String value) {
    return 'الضغط $value رطل/بوصة²';
  }

  @override
  String get tyreConditionGood => 'جيد';

  @override
  String get tyreConditionWorn => 'مهترئ';

  @override
  String get tyreConditionDamaged => 'تالف';

  @override
  String get tyreConditionPuncture => 'مثقوب';

  @override
  String get tyreConditionFlat => 'فارغ';

  @override
  String get tyreConditionMissing => 'مفقود';

  @override
  String get inspectionNavTitle => 'فحص جديد';

  @override
  String get inspectionStep1Label => '1';

  @override
  String get inspectionStep2Label => '2';

  @override
  String get inspectionStep3Label => '3';

  @override
  String get inspectionResumeTitle => 'متابعة العمل غير المكتمل';

  @override
  String inspectionResumeProgress(int filled, int total) {
    return 'تم فحص $filled من $total';
  }

  @override
  String get inspectionWorkflowNotStarted => 'لم يبدأ';

  @override
  String get inspectionWorkflowInProgress => 'قيد التنفيذ';

  @override
  String get inspectionWorkflowReadyForReview => 'جاهز للمراجعة';

  @override
  String inspectionWorkflowResumeSummary(String status, String progress) {
    return '$status • $progress';
  }

  @override
  String get inspectionWorkflowTapTyre => 'اضغط على إطار لإضافة تفاصيل الفحص.';

  @override
  String get inspectionWorkflowContinueChecking =>
      'واصل فحص مواضع الإطارات حتى يحتوي كل موضع على تفاصيل كافية.';

  @override
  String get inspectionWorkflowAllChecked =>
      'تم فحص جميع مواضع الإطارات. يمكنك الآن المراجعة والتوقيع.';

  @override
  String get inspectionChangeVehicleButton => 'تغيير';

  @override
  String get inspectionSiteLabel => 'الموقع';

  @override
  String get inspectionTypeSiteName => 'اكتب اسم الموقع';

  @override
  String get inspectionOdometerLabel => 'عداد المسافة (كم)';

  @override
  String get inspectionOdometerHint => 'اختياري';

  @override
  String get inspectionHourMeterLabel => 'عداد الساعات';

  @override
  String get inspectionHourMeterHint => 'اختياري';

  @override
  String get inspectionNextButton => 'التالي: مواضع الإطارات';

  @override
  String get inspectionVehicleSearchPlaceholder => 'ابحث برقم الأصل أو النوع';

  @override
  String get inspectionSearchToBeginHint => 'ابدأ الكتابة للبحث في الأسطول.';

  @override
  String get inspectionVehicleNoMatch => 'لا توجد مركبة تطابق هذا البحث.';

  @override
  String get inspectionEnterAssetManually => 'إدخال رقم الأصل يدويًا';

  @override
  String get inspectionManualAssetLabel => 'رقم الأصل';

  @override
  String get inspectionManualUseButton => 'استخدام هذا الأصل';

  @override
  String get inspectionTyrePositionsTitle => 'مواضع الإطارات';

  @override
  String get inspectionDraftLabel => 'مسودة';

  @override
  String inspectionTyreConfiguration(int count) {
    return 'تكوين $count إطارًا';
  }

  @override
  String inspectionStepOfTotal(int step, int total) {
    return 'الخطوة $step من $total';
  }

  @override
  String get inspectionRearLabel => 'الخلف';

  @override
  String get inspectionSelectedTyre => 'الإطار المحدد';

  @override
  String get inspectionPressureShort => 'الضغط';

  @override
  String get inspectionTreadDepthShort => 'عمق النقشة';

  @override
  String get inspectionAddEvidencePhoto => 'إضافة دليل (صورة)';

  @override
  String get inspectionSaveAndNext => 'حفظ والتالي';

  @override
  String get inspectionFrontLeft => 'أمامي يسار';

  @override
  String get inspectionFrontRight => 'أمامي يمين';

  @override
  String get inspectionInnerLeft => 'داخلي يسار';

  @override
  String get inspectionOuterLeft => 'خارجي يسار';

  @override
  String get inspectionInnerRight => 'داخلي يمين';

  @override
  String get inspectionOuterRight => 'خارجي يمين';

  @override
  String get inspectionRearLeft => 'خلفي يسار';

  @override
  String get inspectionRearRight => 'خلفي يمين';

  @override
  String get inspectionTyrePositionFallback => 'موضع الإطار';

  @override
  String get inspectionNotRecordedYet => 'لم يُسجَّل بعد';

  @override
  String get inspectionValidationRecordTyre =>
      'سجّل إطارًا واحدًا على الأقل قبل المتابعة.';

  @override
  String inspectionTyresIncompleteLead(int count, int total) {
    return '$count من $total إطارات لا تزال بحاجة إلى تفاصيل قبل المتابعة.';
  }

  @override
  String get inspectionReviewButton => 'مراجعة والتوقيع';

  @override
  String get inspectionGpsCaptured => 'تم تحديد الموقع';

  @override
  String get inspectionGpsCapturing => 'جارٍ تحديد الموقع...';

  @override
  String get inspectionGpsUnavailable => 'الموقع غير متاح';

  @override
  String get inspectionGpsRetry => 'إعادة المحاولة';

  @override
  String get inspectionReviewTitle => 'المراجعة';

  @override
  String inspectionPositionsRecorded(int touched, int total) {
    return '$touched من $total مواضع إطارات مسجلة';
  }

  @override
  String get inspectionObservationsLabel => 'ملاحظات';

  @override
  String get inspectionObservationsPlaceholder =>
      'أي شيء آخر يستحق الذكر حول هذا الفحص';

  @override
  String get inspectionInspectorSignatureLabel => 'توقيع الفاحص';

  @override
  String get inspectionSubmitForApproval => 'إرسال للموافقة';

  @override
  String get inspectionSignatureRequiredMsg =>
      'التوقيع مطلوب قبل إرسال هذا الفحص.';

  @override
  String get inspectionSubmittedForApprovalTitle => 'تم الإرسال للموافقة';

  @override
  String get inspectionQueuedTitle => 'تم الحفظ على هذا الجهاز';

  @override
  String get inspectionQueuedWithWarningTitle =>
      'تم الحفظ، لكن الخادم لم يقبله بعد';

  @override
  String get inspectionBackHome => 'العودة إلى الرئيسية';

  @override
  String get inspectionNewInspection => 'فحص جديد';

  @override
  String get inspectionConditionLabel => 'الحالة';

  @override
  String get inspectionPressureLabel => 'الضغط (رطل/بوصة²)';

  @override
  String get inspectionPressureHint => 'مثال: 110';

  @override
  String get inspectionTreadLabel => 'عمق النقش (مم)';

  @override
  String get inspectionTreadHint => 'مثال: 8.5';

  @override
  String get inspectionSerialLabel => 'الرقم التسلسلي للإطار';

  @override
  String get inspectionPhotoLabel => 'صورة';

  @override
  String get inspectionPhotoNone => 'لم يتم التقاط صورة';

  @override
  String get inspectionPhotoCamera => 'الكاميرا';

  @override
  String get inspectionPhotoGallery => 'المعرض';

  @override
  String get inspectionNotesLabel => 'ملاحظات';

  @override
  String get inspectionSignatureSavedLabel => 'تم حفظ التوقيع';

  @override
  String get inspectionSignatureRedraw => 'رسم توقيع جديد';

  @override
  String get inspectionDetailTitle => 'الفحص';

  @override
  String get inspectionNotFoundTitle => 'الفحص غير موجود';

  @override
  String get inspectionNotFoundMessage =>
      'تعذر العثور على هذا الفحص على هذا الجهاز أو على الخادم.';

  @override
  String get inspectionStatusUnknown => 'غير معروف';

  @override
  String get inspectionInspectorUnknown => 'لم يُسجَّل اسم الفاحص';

  @override
  String get inspectionSignatureMissing => 'لا يوجد توقيع مسجل';

  @override
  String get inspectionGpsSectionTitle => 'الموقع';

  @override
  String inspectionGpsCoordinates(String lat, String lng) {
    return '$lat، $lng';
  }

  @override
  String get inspectionQueueFailedLabel => 'فشلت المزامنة';

  @override
  String get inspectionQueuePendingLabel => 'بانتظار المزامنة';

  @override
  String get inspectionRetrySyncButton => 'إعادة المحاولة';

  @override
  String get inspectionStatusSynced => 'تمت المزامنة';

  @override
  String get inspectionHistoryTitle => 'فحوصاتي';

  @override
  String get inspectionHistoryEmptyTitle => 'لا توجد فحوصات بعد';

  @override
  String get inspectionHistoryEmptyMessage =>
      'ستظهر هنا الفحوصات التي تبدأها أو ترسلها.';

  @override
  String get inspectionHistoryInProgressSection => 'قيد التنفيذ';

  @override
  String get inspectionHistorySubmittedSection => 'تم الإرسال';

  @override
  String get checklistAddPhotoTitle => 'إضافة صورة';

  @override
  String get checklistPhotoSourceCamera => 'التقاط صورة';

  @override
  String get checklistPhotoSourceGallery => 'الاختيار من المعرض';

  @override
  String get checklistNoteRequiredLabel => 'ملاحظة (مطلوبة)';

  @override
  String get checklistNoteLabel => 'ملاحظة';

  @override
  String get checklistYes => 'نعم';

  @override
  String get checklistNo => 'لا';

  @override
  String get checklistSignatureSavedLabel => 'تم حفظ التوقيع';

  @override
  String get checklistSignatureRedraw => 'رسم توقيع جديد';

  @override
  String get checklistsHomeTitle => 'قوائم التحقق';

  @override
  String get checklistsLibraryTitle => 'مكتبة الفحص';

  @override
  String get checklistsLibrarySubtitle => 'اختر سير العمل الصحيح للأصل';

  @override
  String checklistsAvailableCount(int count) {
    return '$count متاح';
  }

  @override
  String checklistItemCount(int count) {
    return '$count بندًا';
  }

  @override
  String checklistPositionCount(int count) {
    return '$count موضعًا';
  }

  @override
  String get checklistPhotosOnFailure => 'الصور مطلوبة للعناصر غير المجتازة';

  @override
  String get checklistStartAction => 'ابدأ';

  @override
  String get checklistsHistoryAction => 'سجل قوائم التحقق الخاص بي';

  @override
  String get checklistsEmptyTitle => 'لا يوجد شيء لتعبئته الآن';

  @override
  String get checklistsEmptyMessage =>
      'لا توجد قوائم تحقق أو مهام أو استمارات غير مكتملة متاحة لك حاليًا.';

  @override
  String get checklistsUnfinishedSection => 'عمل غير مكتمل';

  @override
  String get checklistsAssignmentsSection => 'المهام المستحقة';

  @override
  String get checklistsAvailableSection => 'قوائم التحقق المتاحة';

  @override
  String get checklistNoAssetLabel => 'لم يتم اختيار أصل بعد';

  @override
  String checklistResumeProgress(int filled, int total) {
    return 'تمت الإجابة عن $filled من $total';
  }

  @override
  String get checklistHistoryTitle => 'سجل قوائم التحقق';

  @override
  String get checklistHistorySearchHint =>
      'البحث حسب المستند أو النموذج أو الأصل أو الموقع';

  @override
  String get checklistHistoryFilterAll => 'الكل';

  @override
  String get checklistHistoryFilterWaiting => 'قيد الانتظار';

  @override
  String get checklistHistoryFilterClosed => 'مغلق';

  @override
  String get checklistHistoryFilterSentBack => 'أُعيد';

  @override
  String get checklistHistoryEmptyTitle => 'لا يوجد سجل قوائم تحقق بعد';

  @override
  String get checklistHistoryEmptyMessage =>
      'ستظهر هنا الاستمارات التي تقوم بتعبئتها، سواء كانت لا تزال في طريقها إلى الخادم أو تم تأكيدها بالفعل.';

  @override
  String get checklistHistoryQueuedSection => 'لا تزال على هذا الجهاز';

  @override
  String get checklistHistoryCompletedSection => 'مؤكدة';

  @override
  String get checklistQueueFailedLabel => 'يحتاج إلى انتباه';

  @override
  String get checklistQueuePendingLabel => 'بانتظار المزامنة';

  @override
  String get checklistHistoryStatusClosed => 'مغلق';

  @override
  String get checklistHistoryStatusSentBack => 'أُعيد';

  @override
  String get checklistHistoryStatusWaiting => 'بانتظار الموافقة';

  @override
  String get checklistHistoryStatusNoApproval => 'لا حاجة إلى موافقة';

  @override
  String get checklistFillLoadingTitle => 'قائمة التحقق';

  @override
  String get checklistSubmittedTitle => 'تم إرسال قائمة التحقق';

  @override
  String get checklistSubmittedMessage =>
      'تم حفظ استمارتك. ستصل إلى الخادم بمجرد اتصال هذا الجهاز بالإنترنت.';

  @override
  String get checklistLastSubmissionKnown =>
      'توجد لهذه الآلية استمارة سابقة لقائمة التحقق هذه.';

  @override
  String checklistLastSubmissionDaysAgo(int daysAgo) {
    return 'تم فحص هذه الآلية آخر مرة قبل $daysAgo يومًا على قائمة التحقق هذه.';
  }

  @override
  String get checklistPrimarySignatureLabel => 'توقيع الاعتماد';

  @override
  String get checklistSubmitAction => 'إرسال قائمة التحقق';

  @override
  String get checklistSiteLabel => 'الموقع';

  @override
  String get checklistPrintedNameLabel => 'الاسم بخط واضح';

  @override
  String get checklistPrintedNamePlaceholder => 'اكتب اسمك الكامل';

  @override
  String checklistGateFieldErrors(int count) {
    return 'يحتاج $count حقل (حقول) إلى مراجعة';
  }

  @override
  String checklistGateSignatureErrors(int count) {
    return 'مطلوب $count توقيع (تواقيع)';
  }

  @override
  String checklistGateMissingNotes(int count) {
    return 'يحتاج $count عنصر (عناصر) إلى ملاحظة توضح العلامة';
  }

  @override
  String checklistGateUnsatisfiedGroups(int count) {
    return 'تحتاج $count مجموعة قراءات إلى قيمة واحدة على الأقل';
  }

  @override
  String get checklistGatePrimarySignature =>
      'التوقيع مطلوب لإرسال هذه الاستمارة';

  @override
  String get inspectionApprovalsTitle => 'اعتمادات الفحوصات';

  @override
  String inspectionApprovalsAwaitingCount(int count) {
    return '$count بانتظار الموافقة';
  }

  @override
  String get inspectionApprovalsEmptyTitle => 'لا شيء بانتظار الموافقة';

  @override
  String get inspectionApprovalsEmptyMessage =>
      'تمت مراجعة جميع الفحوصات. اسحب للأسفل للتحقق مرة أخرى.';

  @override
  String get inspectionApprovalsLoadErrorMessage =>
      'تعذر تحميل الاعتمادات. تحقق من اتصالك وحاول مرة أخرى.';

  @override
  String get inspectionApprovalsPendingBadge => 'قيد الانتظار';

  @override
  String get inspectionApprovalFallbackTitle => 'الفحص';

  @override
  String get inspectionApprovalReviewTitle => 'الموافقة';

  @override
  String get inspectionApprovalLoadErrorMessage =>
      'تعذر تحميل هذا الفحص. تحقق من اتصالك وحاول مرة أخرى.';

  @override
  String get inspectionApprovalNotFoundMessage =>
      'تعذر العثور على هذا الفحص. ربما تمت مراجعته أو إزالته بالفعل.';

  @override
  String inspectionApprovalTyreConditionsTitle(int count) {
    return 'حالة الإطارات ($count)';
  }

  @override
  String get inspectionApprovalNoTyreConditions =>
      'لم تُسجَّل أي حالة للإطارات.';

  @override
  String get inspectionApprovalYourDecisionTitle => 'قرارك';

  @override
  String get inspectionApprovalDecisionTitle => 'القرار';

  @override
  String get inspectionApprovalDecisionApproved => 'تمت الموافقة';

  @override
  String get inspectionApprovalDecisionReturned => 'أُعيد إلى الميدان';

  @override
  String inspectionApprovalApprovedBy(String name) {
    return 'تمت الموافقة بواسطة $name';
  }

  @override
  String inspectionApprovalReturnedBy(String name) {
    return 'أعاده $name';
  }

  @override
  String get inspectionApprovalApproverSignatureLabel => 'توقيع المعتمِد';

  @override
  String inspectionApprovalSigningAs(String name) {
    return 'التوقيع باسم $name';
  }

  @override
  String get inspectionApprovalNoteLabel => 'ملاحظة (مطلوبة عند الإعادة)';

  @override
  String get inspectionApprovalNoteHint => 'السبب في حال الإعادة إلى الفاحص';

  @override
  String get inspectionApprovalApproveButton => 'موافقة';

  @override
  String get inspectionApprovalReturnButton => 'إعادة';

  @override
  String get inspectionApprovalSignatureRequiredTitle => 'التوقيع مطلوب';

  @override
  String get inspectionApprovalSignatureRequiredMessage =>
      'وقّع في خانة المعتمِد للموافقة على هذا الفحص.';

  @override
  String get inspectionApprovalReasonRequiredTitle => 'السبب مطلوب';

  @override
  String get inspectionApprovalReasonRequiredMessage =>
      'أضف ملاحظة قصيرة ليعرف الفاحص ما يجب إصلاحه.';

  @override
  String get inspectionApprovalApprovedOutcomeTitle => 'تمت الموافقة على الفحص';

  @override
  String get inspectionApprovalReturnedOutcomeTitle => 'أُعيد الفحص';

  @override
  String get inspectionApprovalApprovedOutcomeMessage =>
      'تمت الموافقة على الفحص. يمكنك مراجعته هنا، أو العودة إلى القائمة.';

  @override
  String get inspectionApprovalReturnedOutcomeMessage =>
      'أُعيد الفحص إلى الميدان. يمكنك مراجعته هنا، أو العودة إلى القائمة.';

  @override
  String get inspectionApprovalStayHereAction => 'البقاء هنا';

  @override
  String get inspectionApprovalBackToListAction => 'العودة إلى القائمة';

  @override
  String get inspectionApprovalSaveFailedTitle => 'تعذر حفظ القرار';

  @override
  String get inspectionApprovalDecideGenericError => 'يرجى المحاولة مرة أخرى.';

  @override
  String get inspectionApprovalSignatureSavedLabel => 'تم حفظ التوقيع';

  @override
  String get inspectionApprovalSignatureRedraw => 'رسم توقيع جديد';

  @override
  String get checklistApprovalsTitle => 'اعتماد قوائم التحقق';

  @override
  String checklistApprovalsAwaitingCount(int count) {
    return '$count بانتظار التوقيع';
  }

  @override
  String get checklistApprovalsLoadErrorMessage =>
      'تعذّر تحميل الموافقات. تحقق من اتصالك وحاول مرة أخرى.';

  @override
  String get checklistApprovalsEmptyTitle => 'لا يوجد ما ينتظر الموافقة';

  @override
  String get checklistApprovalsEmptyMessage =>
      'تمت مراجعة جميع قوائم التحقق. اسحب للأسفل للتحقق مرة أخرى.';

  @override
  String get checklistApprovalsEmptyMineTitle => 'لا شيء يحتاج إليك الآن';

  @override
  String get checklistApprovalsEmptyMineMessage =>
      'لا توجد قائمة تحقق في هذه القائمة تنتظر توقيعك في الوقت الحالي.';

  @override
  String get checklistApprovalsFilterAll => 'الكل';

  @override
  String get checklistApprovalsFilterMine => 'بحاجة إليّ';

  @override
  String get checklistApprovalsYourTurn => 'دورك';

  @override
  String get checklistApprovalFallbackTitle => 'قائمة تحقق';

  @override
  String checklistApprovalsBlockedTitle(int count) {
    return '$count قرار يحتاج إلى الانتباه';
  }

  @override
  String get checklistApprovalsBlockedMessage =>
      'تعذّر إرسال هذه القرارات ولن تتم إعادة المحاولة تلقائيًا. حاول مرة أخرى أدناه، أو أعد فتح قائمة التحقق لاتخاذ القرار مجددًا.';

  @override
  String get checklistApprovalsStatusClosed => 'مغلقة';

  @override
  String get checklistApprovalsStatusSentBack => 'أُعيدت';

  @override
  String get checklistApprovalsStatusWaitingAreaManager =>
      'بانتظار مدير المنطقة';

  @override
  String get checklistApprovalsStatusWaitingSupervisor => 'بانتظار المشرف';

  @override
  String get checklistApprovalsStatusWaitingApproval => 'بانتظار الموافقة';

  @override
  String get checklistApprovalsStatusNoApproval => 'لا حاجة إلى موافقة';

  @override
  String get checklistApprovalReviewTitle => 'الموافقة على قائمة التحقق';

  @override
  String get checklistApprovalLoadErrorMessage =>
      'تعذّر تحميل قائمة التحقق هذه. تحقق من اتصالك وحاول مرة أخرى.';

  @override
  String get checklistApprovalNotFoundTitle => 'قائمة التحقق غير موجودة';

  @override
  String get checklistApprovalNotFoundMessage =>
      'تعذّر العثور على قائمة التحقق هذه. ربما تمت مراجعتها أو إزالتها بالفعل.';

  @override
  String get checklistApprovalSignOffsTitle => 'التوقيعات';

  @override
  String get checklistApprovalResponsesTitle => 'الردود';

  @override
  String get checklistApprovalNoResponses => 'لم يتم تسجيل أي ردود.';

  @override
  String get checklistApprovalStageFilledBy => 'مَلأها';

  @override
  String get checklistApprovalStageSupervisor => 'توقيع المشرف';

  @override
  String get checklistApprovalStageAreaManager => 'موافقة مدير المنطقة';

  @override
  String get checklistApprovalStageApproval => 'الموافقة';

  @override
  String get checklistApprovalNotSignedYet => 'لم يتم التوقيع بعد';

  @override
  String get checklistApprovalYourDecisionTitle => 'قرارك';

  @override
  String get checklistApprovalSupervisorSignatureLabel => 'توقيع المشرف';

  @override
  String get checklistApprovalAreaManagerSignatureLabel => 'توقيع مدير المنطقة';

  @override
  String get checklistApprovalYourNameLabel => 'اسمك';

  @override
  String get checklistApprovalYourNamePlaceholder => 'اكتب اسمك';

  @override
  String get checklistApprovalNoteLabel => 'ملاحظة (مطلوبة للإعادة)';

  @override
  String get checklistApprovalNoteHint => 'السبب في حال إعادة هذه القائمة';

  @override
  String get checklistApprovalReturnButton => 'إعادة';

  @override
  String get checklistApprovalSignOffButton => 'توقيع';

  @override
  String get checklistApprovalApproveAndCloseButton => 'الموافقة والإغلاق';

  @override
  String get checklistApprovalRequirementTitle => 'لا يمكن التوقيع';

  @override
  String get checklistApprovalReasonRequiredTitle => 'السبب مطلوب';

  @override
  String get checklistApprovalReasonRequiredMessage =>
      'أضف ملاحظة قصيرة حتى يعرف من ملأ هذه القائمة ما الذي يجب إصلاحه.';

  @override
  String get checklistApprovalNameRequiredMessage =>
      'أدخل اسمك للتوقيع على هذا.';

  @override
  String get checklistApprovalSignatureRequiredMessage =>
      'وقّع في المربع أعلاه للتوقيع على هذا.';

  @override
  String get checklistApprovalNothingToDecide =>
      'لم يتبقَّ في قائمة التحقق هذه ما يستدعي قرارًا.';

  @override
  String checklistApprovalNotYourRung(String status) {
    return 'هذا ليس من اختصاصك اتخاذ القرار بشأنه. $status';
  }

  @override
  String get checklistApprovalSaveFailedTitle => 'تعذّر حفظ القرار';

  @override
  String get checklistApprovalDecideGenericError => 'يرجى المحاولة مرة أخرى.';

  @override
  String get checklistApprovalSentBackTitle => 'تمت إعادة قائمة التحقق';

  @override
  String get checklistApprovalSentBackMessage =>
      'تمت إعادة قائمة التحقق هذه إلى الميدان. يمكنك مراجعتها هنا، أو العودة إلى القائمة.';

  @override
  String get checklistApprovalSignedOffTitle => 'تم التوقيع';

  @override
  String get checklistApprovalSignedOffMessage =>
      'تم تسجيل توقيعك. تنتظر قائمة التحقق هذه الآن مدير المنطقة. يمكنك مراجعتها هنا، أو العودة إلى القائمة.';

  @override
  String get checklistApprovalApprovedTitle => 'تمت الموافقة على قائمة التحقق';

  @override
  String get checklistApprovalApprovedMessage =>
      'تمت الموافقة على قائمة التحقق هذه وإغلاقها. يمكنك مراجعتها هنا، أو العودة إلى القائمة.';

  @override
  String get checklistApprovalStayHereAction => 'البقاء هنا';

  @override
  String get checklistApprovalBackToListAction => 'العودة إلى القائمة';

  @override
  String get checklistApprovalQueuedTitle => 'تم الحفظ';

  @override
  String get checklistApprovalQueuedOffline =>
      'تم حفظ قرارك على هذا الجهاز وسيتم إرساله عند عودة الاتصال بالإنترنت.';

  @override
  String checklistApprovalScoreLine(int pct, String status) {
    return 'النتيجة: $pct٪ ($status)';
  }

  @override
  String get checklistApprovalScorePassed => 'ناجح';

  @override
  String get checklistApprovalScoreFailed => 'راسب';

  @override
  String get checklistApprovalSignatureSavedLabel => 'تم حفظ التوقيع';

  @override
  String get checklistApprovalSignatureRedraw => 'ارسم توقيعًا جديدًا';

  @override
  String get meterLogNavTitle => 'تسجيل قراءة العداد';

  @override
  String get meterLogWorkspaceLoadingMessage =>
      'لا تزال بيانات مساحة العمل قيد التحميل. يرجى المحاولة مرة أخرى بعد لحظات.';

  @override
  String get meterLogAssetLabel => 'الأصل';

  @override
  String get meterLogAssetHint => 'اكتب رقم الأصل أو امسحه ضوئيًا';

  @override
  String get meterLogSiteLabel => 'الموقع';

  @override
  String get meterLogSiteHint => 'أين تم أخذ هذه القراءة';

  @override
  String get meterLogSiteHelp =>
      'يتم تعبئته تلقائيًا من سجل الأسطول. غيّره إذا كانت هذه القراءة من موقع مختلف.';

  @override
  String get meterLogLastReadingChecking => 'جارٍ التحقق من آخر قراءة...';

  @override
  String get meterLogLastReadingUnknown =>
      'لا توجد قراءة سابقة مسجَّلة لهذا الأصل.';

  @override
  String meterLogLastReadingKnown(String km, String date) {
    return 'آخر قراءة: $km كم بتاريخ $date';
  }

  @override
  String get meterLogOdometerLabel => 'عداد المسافات (كم)';

  @override
  String get meterLogOdometerHint => 'أدخل القراءة';

  @override
  String get meterLogEngineHoursLabel => 'ساعات المحرك';

  @override
  String get meterLogEngineHoursHint => 'اختياري';

  @override
  String get meterLogEngineHoursHelpWithHours =>
      'سيُطلب منك تصوير عداد الساعات في الخطوة التالية.';

  @override
  String get meterLogEngineHoursHelpWithoutHours =>
      'اترك هذا الحقل فارغًا إذا لم تكن المركبة مزوّدة بعداد ساعات.';

  @override
  String get meterLogNotesLabel => 'ملاحظات';

  @override
  String get meterLogNotesHint => 'أي شيء يستحق التسجيل';

  @override
  String get meterLogSignatureLabel => 'التوقيع';

  @override
  String get meterLogSignatureSavedLabel => 'تم حفظ التوقيع';

  @override
  String get meterLogSignatureRedraw => 'ارسم توقيعًا جديدًا';

  @override
  String get meterLogContinueAction => 'مراجعة وحفظ';

  @override
  String get meterLogAssetRequiredTitle => 'الأصل مطلوب';

  @override
  String get meterLogAssetRequiredMessage => 'أدخل الأصل قبل المتابعة.';

  @override
  String get meterLogReadingRequiredTitle => 'القراءة مطلوبة';

  @override
  String get meterLogReadingRequiredMessage =>
      'أدخل قراءة عداد المسافات قبل المتابعة.';

  @override
  String get meterLogInvalidReadingTitle => 'هذه القراءة غير صحيحة على ما يبدو';

  @override
  String get meterLogInvalidReadingMessage =>
      'لا يمكن أن تكون قراءة عداد المسافات رقمًا سالبًا.';

  @override
  String get meterLogBelowLastTitle => 'هذه القراءة أقل من القراءة السابقة';

  @override
  String meterLogBelowLastMessage(String km) {
    return 'آخر قراءة مسجَّلة لهذا الأصل كانت $km كم. سيؤدي حفظ هذه القراءة إلى وضع علامة عليها لمراجعة الإدارة.';
  }

  @override
  String get meterLogRecheckAction => 'إعادة التحقق';

  @override
  String get meterLogSaveAndFlagAction => 'الحفظ على أي حال';

  @override
  String get meterLogBigJumpTitle => 'هذه قفزة كبيرة';

  @override
  String meterLogBigJumpMessage(String km) {
    return 'هذا يزيد بمقدار $km كم عن القراءة السابقة.';
  }

  @override
  String get meterLogLogAnywayAction => 'التسجيل على أي حال';

  @override
  String get meterLogReviewTitle => 'تأكيد القراءة';

  @override
  String get meterLogPhotographGaugeLabel => 'صوّر المؤشر';

  @override
  String get meterLogPhotoCamera => 'الكاميرا';

  @override
  String get meterLogPhotoGallery => 'المعرض';

  @override
  String get meterLogPhotoNone => 'لم يتم التقاط صورة';

  @override
  String get meterLogPhotoRequiredTitle => 'الصورة مطلوبة';

  @override
  String get meterLogPhotoRequiredMessage =>
      'يجب تصوير عداد المسافات قبل الحفظ.';

  @override
  String get meterLogSaveReadingAction => 'حفظ القراءة';

  @override
  String get meterLogFlaggedNote =>
      'هذه القراءة أقل من السابقة وسيتم وضع علامة عليها لمراجعة الإدارة.';

  @override
  String get meterLogSavedMessage => 'تم حفظ القراءة. ستتم مزامنتها تلقائيًا.';

  @override
  String get meterLogSavedAndFlaggedMessage =>
      'تم حفظ القراءة ووضع علامة عليها لمراجعة الإدارة لأنها أقل من القراءة السابقة.';

  @override
  String get meterLogTryAgainFallback => 'حدث خطأ ما. حاول مرة أخرى.';

  @override
  String get meterLogRecentTitle => 'القراءات الأخيرة';

  @override
  String get meterLogRecentEmptyMessage => 'لم تُسجَّل أي قراءات بعد.';

  @override
  String get meterLogRecentLoadErrorMessage => 'تعذّر تحميل القراءات الأخيرة.';

  @override
  String meterLogRecentKmValue(String km) {
    return '$km كم';
  }

  @override
  String get washNavTitle => 'تسجيل غسيل المركبة';

  @override
  String get washWorkspaceLoadingMessage =>
      'لا تزال بيانات مساحة العمل قيد التحميل. يرجى المحاولة مرة أخرى بعد لحظات.';

  @override
  String get washDueTitle => 'بحاجة إلى الغسيل';

  @override
  String get washDueNone => 'لا توجد مركبات بحاجة إلى الغسيل حاليًا.';

  @override
  String get washDueToday => 'مستحق اليوم';

  @override
  String washDueOverdue(int days) {
    return 'متأخر بواقع $days يوم';
  }

  @override
  String get washDueLoadErrorMessage =>
      'تعذّر التحقق من قائمة المستحقات في الوقت الحالي.';

  @override
  String get washAssetLabel => 'الأصل';

  @override
  String get washAssetHint => 'اكتب رقم الأصل أو امسحه ضوئيًا';

  @override
  String washMasterFleetNumber(String fleetNo) {
    return 'الأسطول $fleetNo';
  }

  @override
  String get washSiteLabel => 'الموقع';

  @override
  String get washSiteHint => 'أين تم غسل المركبة';

  @override
  String get washSiteHelp =>
      'يتم تعبئته تلقائيًا من سجل الأسطول. غيّره إذا تم هذا الغسيل في موقع مختلف.';

  @override
  String get washDateLabel => 'التاريخ';

  @override
  String washDateTodayLine(String date) {
    return 'اليوم · $date';
  }

  @override
  String get washTypeLabel => 'نوع الغسيل';

  @override
  String get washTypeExterior => 'خارجي';

  @override
  String get washTypeInterior => 'داخلي';

  @override
  String get washTypeFull => 'شامل';

  @override
  String get washTypeEngineBay => 'حجرة المحرك';

  @override
  String get washTypeUndercarriage => 'الهيكل السفلي';

  @override
  String get washTypeSteam => 'بالبخار';

  @override
  String get washTypeWaterless => 'بدون ماء';

  @override
  String get washStatusLabel => 'الحالة';

  @override
  String get washStatusInProgress => 'قيد التنفيذ';

  @override
  String get washStatusCompleted => 'مكتمل';

  @override
  String get washPhotosLabel => 'الصور';

  @override
  String get washAddPhoto => 'إضافة صورة';

  @override
  String get washPhotoCamera => 'الكاميرا';

  @override
  String get washPhotoGallery => 'المعرض';

  @override
  String get washDetailsLabel => 'التفاصيل';

  @override
  String get washOperatorLabel => 'اسم القائم بالعملية';

  @override
  String get washOperatorHint => 'من قام بغسل المركبة';

  @override
  String get washBayLabel => 'الحظيرة';

  @override
  String get washBayHint => 'اختياري';

  @override
  String get washOdometerLabel => 'عداد المسافات (كم)';

  @override
  String get washOdometerHint => 'اختياري';

  @override
  String get washNotesLabel => 'ملاحظات';

  @override
  String get washNotesHint => 'أي شيء يستحق التسجيل';

  @override
  String get washTypeRequiredTitle => 'نوع الغسيل مطلوب';

  @override
  String get washTypeRequiredMessage => 'اختر نوع الغسيل قبل الحفظ.';

  @override
  String get washAssetRequiredTitle => 'الأصل مطلوب';

  @override
  String get washAssetRequiredMessage => 'أدخل الأصل قبل الحفظ.';

  @override
  String get washSaveAction => 'حفظ الغسيل';

  @override
  String get washSavedMessage => 'تم تسجيل الغسيل. ستتم مزامنته تلقائيًا.';

  @override
  String get washSaveFailedTitle => 'تعذّر حفظ الغسيل';

  @override
  String get washTryAgainFallback => 'حدث خطأ ما. حاول مرة أخرى.';

  @override
  String get washRecentTitle => 'عمليات الغسيل الأخيرة';

  @override
  String get washRecentEmptyMessage => 'لم تُسجَّل أي عمليات غسيل بعد.';

  @override
  String get washRecentLoadErrorMessage => 'تعذّر تحميل عمليات الغسيل الأخيرة.';

  @override
  String get homeNavTitle => 'الرئيسية';

  @override
  String get homeGreeting => 'مرحبًا بعودتك';

  @override
  String get homeGoodMorning => 'صباح الخير،';

  @override
  String get homeGoodAfternoon => 'مساء الخير،';

  @override
  String get homeGoodEvening => 'مساء الخير،';

  @override
  String get homeFallbackUser => 'عضو الفريق';

  @override
  String get homeSearchAssetsHint => 'ابحث عن أصل أو إطار أو مهمة...';

  @override
  String get homeAttentionRequired => 'يتطلب الانتباه';

  @override
  String get homeViewAll => 'عرض الكل';

  @override
  String get homeApprovalsMetric => 'الموافقات';

  @override
  String get homeOverdueMetric => 'متأخر';

  @override
  String get homeCriticalMetric => 'حرج';

  @override
  String get homeTyreIssueDetected => 'تم اكتشاف مشكلة في الإطار';

  @override
  String get homeNoCriticalIssueTitle => 'لا توجد مشكلة حرجة في الإطارات';

  @override
  String get homeNoCriticalIssueMessage =>
      'لم يتم العثور على تنبيه حرج نشط للإطارات.';

  @override
  String get homeReviewAction => 'مراجعة';

  @override
  String get homeMyWork => 'عملي';

  @override
  String get homeQuickActions => 'إجراءات سريعة';

  @override
  String get homeInspectAction => 'فحص';

  @override
  String get homeAssetAction => 'الأصل';

  @override
  String get homeReportIssueAction => 'الإبلاغ عن مشكلة';

  @override
  String get homeOpenAction => 'فتح';

  @override
  String get homeNoUrgentWorkTitle => 'لا يوجد عمل عاجل';

  @override
  String get homeNoUrgentWorkMessage =>
      'لا توجد مهمة متأخرة أو عالية الأولوية مسندة.';

  @override
  String get homeMoreAction => 'المزيد';

  @override
  String get homeAlertsAction => 'التنبيهات';

  @override
  String get homeMenuTooltip => 'فتح الخدمات';

  @override
  String get homeNotificationsTooltip => 'فتح تنبيهات الإطارات';

  @override
  String get homeSiteSelectorTooltip => 'عرض الموقع الحالي';

  @override
  String get homeReportIssueSheetTitle => 'الإبلاغ عن مشكلة';

  @override
  String get homeReportAccidentAction => 'الإبلاغ عن حادث';

  @override
  String get homeFieldSectionHeading => 'الميدان';

  @override
  String get homeFleetSectionHeading => 'الأسطول';

  @override
  String get homeMaintenanceSectionHeading => 'الصيانة';

  @override
  String get homeSyncStatLabel => 'بانتظار المزامنة';

  @override
  String get homeSiteStatLabel => 'الموقع';

  @override
  String get homeSiteStatUnavailable => 'لا يوجد موقع مسجل';

  @override
  String get homeFleetSizeStatLabel => 'حجم الأسطول';

  @override
  String get homeStatLoadingCaption => 'جارٍ التحقق';

  @override
  String get homeStatUnavailableCaption => 'تعذر التحقق';

  @override
  String get homeNoQuickActionsMessage =>
      'لا يتوفر لك شيء هنا بعد. تواصل مع المسؤول إذا احتجت إلى الوصول إلى إحدى الميزات.';

  @override
  String get workOrdersNavTitle => 'أوامر العمل';

  @override
  String workOrdersActiveCount(int count) {
    return '$count نشطة';
  }

  @override
  String get workOrdersFilterActive => 'نشطة';

  @override
  String get workOrdersFilterAll => 'الكل';

  @override
  String get workOrdersEmptyTitle => 'لا توجد أوامر عمل';

  @override
  String get workOrdersEmptyMessage =>
      'ستظهر هنا أوامر العمل المسجّلة لهذا الأسطول.';

  @override
  String get workOrdersLoadErrorMessage => 'تعذّر تحميل أوامر العمل الآن.';

  @override
  String get workOrdersStatusOpenFallback => 'مفتوح';

  @override
  String get workOrdersWorkTypeFallback => 'عمل عام';

  @override
  String get workOrderNewTitle => 'أمر عمل جديد';

  @override
  String get workOrderAssetLabel => 'الأصل';

  @override
  String get workOrderAssetHint => 'مثال: TM514';

  @override
  String get workOrderAssetRequiredMessage => 'أدخل الأصل قبل الحفظ.';

  @override
  String get workOrderWorkTypeLabel => 'نوع العمل';

  @override
  String get workOrderPriorityLabel => 'الأولوية';

  @override
  String get workOrderDescriptionLabel => 'التفاصيل';

  @override
  String get workOrderDescriptionHint => 'أي شيء يستحق التسجيل';

  @override
  String get workOrderCreateAction => 'إنشاء أمر عمل';

  @override
  String get workOrderSavedMessage =>
      'تم تسجيل أمر العمل. ستتم مزامنته تلقائيًا.';

  @override
  String get workOrderSaveFailedMessage => 'تعذّر الحفظ. حاول مرة أخرى.';

  @override
  String get workOrderWorkspaceLoadingMessage =>
      'لا يزال يتم تحميل مساحة عملك. حاول مرة أخرى بعد قليل.';

  @override
  String get workOrderWorkTypeTyreChange => 'تغيير الإطار';

  @override
  String get workOrderWorkTypeRepair => 'إصلاح';

  @override
  String get workOrderWorkTypeRotation => 'تدوير';

  @override
  String get workOrderWorkTypeAlignment => 'ضبط الزوايا';

  @override
  String get workOrderWorkTypeInspection => 'فحص';

  @override
  String get workOrderWorkTypeOther => 'أخرى';

  @override
  String get workOrderPriorityLow => 'منخفضة';

  @override
  String get workOrderPriorityMedium => 'متوسطة';

  @override
  String get workOrderPriorityHigh => 'عالية';

  @override
  String get workOrderPriorityCritical => 'حرجة';

  @override
  String get workOrderAdvanceToInProgress => 'قيد التنفيذ';

  @override
  String get workOrderAdvanceToCompleted => 'مكتمل';

  @override
  String get workOrderStatusQueuedMessage =>
      'تم حفظ تحديث الحالة. ستتم مزامنته تلقائيًا.';

  @override
  String get workOrderDetailTitle => 'أمر العمل';

  @override
  String get workOrderNotFoundTitle => 'أمر العمل غير موجود';

  @override
  String get workOrderNotFoundMessage =>
      'تعذّر العثور على أمر العمل هذا، أو لم يعد لديك صلاحية الوصول إليه.';

  @override
  String get workOrderLoadErrorMessage => 'تعذّر تحميل أمر العمل هذا الآن.';

  @override
  String get workOrderFieldWorkOrderNo => 'رقم أمر العمل';

  @override
  String get workOrderFieldWorkType => 'نوع العمل';

  @override
  String get workOrderFieldSite => 'الموقع';

  @override
  String get workOrderFieldCountry => 'الدولة';

  @override
  String get workOrderFieldOpened => 'تاريخ الفتح';

  @override
  String get workOrderFieldStarted => 'تاريخ البدء';

  @override
  String get workOrderFieldCompleted => 'تاريخ الاكتمال';

  @override
  String get workOrderFieldDescription => 'الوصف';

  @override
  String get tyreReplaceNavTitle => 'تبديل الإطار';

  @override
  String get tyreReplaceWorkspaceLoadingMessage =>
      'لا تزال بيانات مساحة العمل قيد التحميل. يرجى المحاولة مرة أخرى بعد لحظات.';

  @override
  String get tyreReplaceAssetLabel => 'الأصل';

  @override
  String get tyreReplaceAssetHint => 'اكتب رقم الأصل أو امسحه ضوئيًا';

  @override
  String tyreReplaceMasterFleetNumber(String fleetNo) {
    return 'الأسطول $fleetNo';
  }

  @override
  String get tyreReplaceSiteLabel => 'الموقع';

  @override
  String get tyreReplaceSiteHint => 'أين تم تبديل الإطار';

  @override
  String get tyreReplaceSiteHelp =>
      'يتم تعبئته تلقائيًا من سجل الأسطول. غيّره إذا تم هذا التبديل في موقع مختلف.';

  @override
  String get tyreReplacePositionLabel => 'الموضع';

  @override
  String get tyreReplacePositionHint =>
      'اضغط على موضع لهذه المركبة، أو اكتب موضعك الخاص أدناه.';

  @override
  String get tyreReplacePositionInputLabel => 'رمز الموضع';

  @override
  String get tyreReplaceBrandLabel => 'العلامة التجارية';

  @override
  String get tyreReplaceBrandHint => 'اختياري';

  @override
  String get tyreReplaceSizeLabel => 'المقاس';

  @override
  String get tyreReplaceSizeHint => 'مثال: 315/80R22.5';

  @override
  String get tyreReplaceSerialLabel => 'الرقم التسلسلي';

  @override
  String get tyreReplaceSerialHint => 'اختياري';

  @override
  String get tyreReplaceCostLabel => 'التكلفة';

  @override
  String get tyreReplaceCostHint => 'اختياري';

  @override
  String get tyreReplaceOdometerLabel => 'عداد المسافات (كم)';

  @override
  String get tyreReplaceOdometerHint => 'اختياري';

  @override
  String get tyreReplaceTreadLabel => 'عمق النقش (مم)';

  @override
  String get tyreReplaceTreadHint => 'اختياري';

  @override
  String get tyreReplaceReasonLabel => 'سبب الإزالة';

  @override
  String get tyreReplaceReasonHint => 'اختياري - سبب إزالة الإطار القديم';

  @override
  String get tyreReplacePhotosLabel => 'الصور';

  @override
  String get tyreReplaceAddPhoto => 'إضافة صورة';

  @override
  String get tyreReplacePhotoCamera => 'الكاميرا';

  @override
  String get tyreReplacePhotoGallery => 'المعرض';

  @override
  String get tyreReplaceSaveAction => 'حفظ تبديل الإطار';

  @override
  String get tyreReplaceAssetRequiredTitle => 'الأصل مطلوب';

  @override
  String get tyreReplaceAssetRequiredMessage => 'أدخل الأصل قبل الحفظ.';

  @override
  String get tyreReplacePositionRequiredTitle => 'الموضع مطلوب';

  @override
  String get tyreReplacePositionRequiredMessage =>
      'اختر أو اكتب موضعًا قبل الحفظ.';

  @override
  String get tyreReplaceSavedTitle => 'تم حفظ تبديل الإطار';

  @override
  String get tyreReplaceSavedMessage => 'ستتم مزامنته تلقائيًا.';

  @override
  String get tyreReplaceAddAnotherAction => 'إضافة آخر';

  @override
  String get tyreReplaceDoneAction => 'تم';

  @override
  String get tyreReplaceSaveFailedTitle => 'تعذّر حفظ تبديل الإطار';

  @override
  String get tyreReplaceTryAgainFallback => 'حدث خطأ ما. حاول مرة أخرى.';

  @override
  String get tyreDiagramModeLayout => 'عرض التخطيط';

  @override
  String get tyreDiagramModeList => 'عرض القائمة';

  @override
  String get tyreDiagramStatTotal => 'إجمالي الإطارات';

  @override
  String get tyreDiagramStatOk => 'جيد';

  @override
  String get tyreDiagramStatMonitor => 'مراقبة';

  @override
  String get tyreDiagramStatCritical => 'حرج';

  @override
  String tyreDiagramStatUnrecordedCaption(int count) {
    return '$count لم يُسجَّل بعد';
  }

  @override
  String tyreDiagramListPressureValue(String value) {
    return '$value رطل/بوصة²';
  }

  @override
  String tyreDiagramListTreadValue(String value) {
    return '$value مم';
  }

  @override
  String get tyreDiagramListNotRecorded => 'لم يُسجَّل';

  @override
  String get tyreDiagramListEmptyTitle => 'لم يتم تسجيل أي شيء بعد';

  @override
  String get tyreDiagramListEmptyMessage =>
      'بدّل إلى عرض التخطيط واضغط على إطار لتسجيل حالته.';

  @override
  String get tyreDetailTitle => 'تفاصيل الإطار';

  @override
  String get tyreDetailStatTread => 'عمق النقش';

  @override
  String get tyreDetailStatPressure => 'الضغط';

  @override
  String get tyreDetailStatTemperature => 'درجة الحرارة';

  @override
  String get tyreDetailFieldNotRecorded => 'لم يُسجَّل';

  @override
  String get tyreDetailNotRecordedCaption => 'لم يُسجَّل في هذا الفحص';

  @override
  String get tyreDetailSectionOverview => 'نظرة عامة';

  @override
  String get tyreDetailSectionAdditionalInfo => 'معلومات إضافية';

  @override
  String get tyreDetailBrandLabel => 'العلامة التجارية / النقش';

  @override
  String get tyreDetailSizeLabel => 'المقاس';

  @override
  String get tyreDetailInstalledKmLabel => 'تم التركيب عند';

  @override
  String get tyreDetailRunningKmLabel => 'المسافة المقطوعة';

  @override
  String get tyreDetailAssetLabel => 'الأصل';

  @override
  String get tyreDetailSiteLabel => 'الموقع';

  @override
  String get tyreDetailTakeActionButton => 'اتخاذ إجراء';

  @override
  String get tyreDetailAddDetailsButton => 'إضافة التفاصيل';

  @override
  String get tyreDetailEditDetailsButton => 'تعديل التفاصيل';

  @override
  String get tyreDetailRemainingKmLabel => 'العمر المتبقي';

  @override
  String get tyreDetailRemainingKmCaption => 'تقدير عمر الأسطول';

  @override
  String get tyreDetailRemainingKmUnavailable => 'لا يتوفر تقدير مقاس للعمر';

  @override
  String get tyreDetailNoEvidenceMessage =>
      'لم يسجل أحد أي شيء لهذا الإطار بعد.';

  @override
  String get takeActionTitle => 'اتخاذ إجراء';

  @override
  String get takeActionReplaceTyre => 'استبدال الإطار';

  @override
  String get takeActionReplaceTyreSubtitle =>
      'سجّل الإطار الجديد المركّب على هذا الإطار';

  @override
  String get takeActionReportDefect => 'إصلاح (ثقب / تلف)';

  @override
  String get takeActionReportDefectSubtitle => 'افتح أمر إصلاح لهذا الإطار';

  @override
  String get takeActionAdjustReading => 'تعديل القراءة';

  @override
  String get takeActionAdjustReadingSubtitle =>
      'تحديث الضغط أو عمق النقش أو الحالة';

  @override
  String get takeActionAdjustReadingUnavailableCaption =>
      'متاح فقط أثناء تعبئة هذا الفحص';

  @override
  String get takeActionRotateTyre => 'تدوير الإطار';

  @override
  String get takeActionRemoveTyre => 'إزالة الإطار';

  @override
  String get takeActionSendToRetread => 'إرسال لإعادة التلبيس';

  @override
  String get takeActionMarkAsSpare => 'وضع علامة كإطار احتياطي';

  @override
  String get takeActionComingSoonCaption => 'غير متاح في هذا الإصدار بعد';

  @override
  String get reportDefectTitle => 'الإبلاغ عن عطل';

  @override
  String get reportDefectTitleFieldLabel => 'العنوان';

  @override
  String get reportDefectTitleFieldHint => 'مثال: ثقب في الإطار الخلفي الخارجي';

  @override
  String get reportDefectDescriptionLabel => 'الوصف';

  @override
  String get reportDefectDescriptionHint => 'ما الخلل في هذا الإطار؟';

  @override
  String get reportDefectDamageReasonLabel => 'سبب التلف';

  @override
  String get reportDefectDamageReasonHint => 'اختياري';

  @override
  String get reportDefectPriorityLabel => 'الأولوية';

  @override
  String get reportDefectSubmitAction => 'إرسال طلب الإصلاح';

  @override
  String get reportDefectTitleRequiredTitle => 'العنوان مطلوب';

  @override
  String get reportDefectTitleRequiredMessage =>
      'أضف عنوانًا قصيرًا قبل الحفظ.';

  @override
  String get reportDefectSavedTitle => 'تم حفظ طلب الإصلاح';

  @override
  String get reportDefectSavedMessage => 'سيتم مزامنته تلقائيًا.';

  @override
  String get reportDefectSaveFailedTitle => 'تعذر حفظ طلب الإصلاح';

  @override
  String get damageReasonPuncture => 'ثقب';

  @override
  String get damageReasonSidewall => 'تلف الجانب';

  @override
  String get damageReasonTreadWear => 'تآكل النقش';

  @override
  String get damageReasonBlowout => 'انفجار';

  @override
  String get damageReasonImpact => 'تلف نتيجة اصطدام';

  @override
  String get damageReasonOther => 'أخرى';

  @override
  String get globalSearchTitle => 'بحث';

  @override
  String get globalSearchSubtitle => 'ابحث عن أصل أو إطار أو أمر عمل أو تفتيش';

  @override
  String get globalSearchPlaceholder =>
      'الأصل، رقم اللوحة، الشاسيه، رقم الأسطول، الرقم التسلسلي، أمر العمل...';

  @override
  String get globalSearchHelp =>
      'يطابق رقم الأصل أو رقم اللوحة أو رقم الشاسيه أو رقم الأسطول أو الرقم التسلسلي للإطار أو رقم أمر العمل أو مرجع التفتيش.';

  @override
  String get globalSearchSearching => 'جارٍ البحث...';

  @override
  String get globalSearchIdleTitle => 'ابحث في جميع أنحاء أسطولك';

  @override
  String get globalSearchIdleMessage =>
      'اكتب رقم الأصل أو رقم اللوحة أو رقم الشاسيه أو رقم الأسطول أو الرقم التسلسلي للإطار أو رقم أمر العمل أو مرجع التفتيش للبحث في كل شيء دفعة واحدة.';

  @override
  String get globalSearchEmptyTitle => 'لم يُعثر على نتائج مطابقة';

  @override
  String get globalSearchEmptyMessage =>
      'لم يتطابق هذا المصطلح مع أي أصل أو إطار أو أمر عمل أو تفتيش. تحقق من الإملاء وحاول مجدداً.';

  @override
  String get globalSearchRecentSectionTitle => 'عمليات البحث الأخيرة';

  @override
  String globalSearchResultsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count نتيجة',
      many: '$count نتيجةً',
      few: '$count نتائج',
      two: 'نتيجتان',
      one: 'نتيجة واحدة',
      zero: 'لا توجد نتائج',
    );
    return '$_temp0';
  }

  @override
  String get globalSearchSectionAssets => 'الأصول';

  @override
  String get globalSearchSectionTyres => 'الإطارات';

  @override
  String get globalSearchSectionWorkOrders => 'أوامر العمل';

  @override
  String get globalSearchSectionInspections => 'عمليات التفتيش';

  @override
  String get globalSearchSourceFailedNotice =>
      'تعذّر التحقق من بعض النتائج الآن. اسحب للتحديث أو حاول مجدداً.';

  @override
  String get loginAppSubtitle => 'تطبيق المفتش';

  @override
  String get loginTagline => 'TyrePulse · بوابة فني الإطارات';

  @override
  String get loginCardTitle => 'تسجيل الدخول';

  @override
  String get loginCardSubtitle =>
      'استخدم بريدك الإلكتروني أو اسم المستخدم أو رقم الموظف';

  @override
  String get loginIdentifierLabel =>
      'البريد الإلكتروني / اسم المستخدم / رقم الموظف';

  @override
  String get loginIdentifierPlaceholder => 'أدخل البريد أو الاسم أو الرقم';

  @override
  String get loginPasswordLabel => 'كلمة المرور';

  @override
  String get loginPasswordPlaceholder => 'أدخل كلمة المرور';

  @override
  String get loginShowPassword => 'إظهار كلمة المرور';

  @override
  String get loginHidePassword => 'إخفاء كلمة المرور';

  @override
  String get loginErrorRequired =>
      'يرجى إدخال بيانات تسجيل الدخول وكلمة المرور.';

  @override
  String loginErrorLocked(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'محاولات فاشلة كثيرة. يرجى المحاولة مرة أخرى بعد $minutes دقيقة.',
      one: 'محاولات فاشلة كثيرة. يرجى المحاولة مرة أخرى بعد دقيقة واحدة.',
    );
    return '$_temp0';
  }

  @override
  String get loginOperationsTitle => 'عمليات PMV المتكاملة';

  @override
  String get loginWelcomeTitle => 'مرحبًا بعودتك';

  @override
  String get loginWelcomeSubtitle => 'سجّل الدخول إلى العمليات المعيّنة لك';

  @override
  String get loginSelectCountryTitle => 'اختر بلدك';

  @override
  String get loginSelectCountrySubtitle =>
      'اختر البلد الخاص بالعمليات المعيّنة لك.';

  @override
  String get loginChangeCountryAction => 'تغيير البلد';

  @override
  String get loginCountrySaudiArabia => 'المملكة العربية السعودية';

  @override
  String get loginCountryUnitedArabEmirates => 'الإمارات العربية المتحدة';

  @override
  String get loginCountryEgypt => 'مصر';

  @override
  String get loginCountrySelectorSemantics => 'محدد البلد';

  @override
  String loginSelectedCountrySemantics(String country) {
    return 'البلد المحدد: $country';
  }

  @override
  String get loginScopeFleetAssets => 'الأسطول والأصول';

  @override
  String get loginScopeInspectionsChecklists => 'عمليات التفتيش وقوائم التحقق';

  @override
  String get loginScopeMaintenanceWorkshop => 'الصيانة والورشة';

  @override
  String get profileNavTitle => 'حسابي';

  @override
  String get profileRoleLabel => 'الدور';

  @override
  String get profileSuperAdminBadge => 'مسؤول المنصة';

  @override
  String get accidentReportCaptureSubtitle => 'التقاط أدلة خاصة';

  @override
  String get accidentSubmitUnavailable =>
      'الإرسال غير متاح حتى يضمن مسار المزامنة المحمي رفع كل صور الأدلة الخاصة قبل سجل الحادث. تبقى الصور الملتقطة على هذا الجهاز.';

  @override
  String get tasksCopyCatalog =>
      'title=عملي~today=اليوم~inProgress=قيد التنفيذ~completed=مكتمل~urgent=عاجل~upcoming=قادم~open=مفتوحة~emptyTitle=لا توجد مهام~emptyMessage=لا توجد أعمال تطابق هذا العرض.~loadError=تعذر تحميل أعمالي الآن.~due=الاستحقاق~assigned=مُسند إلى~unassigned=غير مُسند~normal=عادي~overdue=متأخر~details=تفاصيل المهمة~description=الوصف~site=الموقع~asset=المعدة~priority=الأولوية~status=الحالة~retry=إعادة المحاولة';

  @override
  String get alertsCopyCatalog =>
      'title=تنبيهات الإطارات~all=الكل~critical=حرج~warnings=تحذيرات~info=معلومات~flagged=تنبيهات~criticalCount=حرجة~emptyTitle=لا توجد تنبيهات نشطة~emptyFilter=لا توجد تنبيهات تطابق هذا الفلتر.~loadError=تعذر تحميل التنبيهات. اسحب للأسفل لإعادة المحاولة.~unknownAsset=معدة غير معروفة~pressureLow=ضغط الإطار منخفض~treadLow=عمق النقشة منخفض~position=الموضع~serial=الرقم التسلسلي~tread=عمق النقشة~retry=إعادة المحاولة';

  @override
  String get notificationInboxCopyCatalog =>
      'title=الإشعارات~markAll=تعيين الكل كمقروء~fallbackTitle=إشعار~emptyTitle=اطلعت على كل المستجدات~emptyBody=ستظهر هنا المهام والموافقات والتحديثات التشغيلية.~loadFailed=تعذر تحميل الإشعارات. اسحب للأسفل لإعادة المحاولة.~markFailed=تعذر تعيين هذا الإشعار كمقروء.~markAllFailed=تعذر تعيين جميع الإشعارات كمقروءة.~justNow=الآن~minutesAgo=قبل %count% د~hoursAgo=قبل %count% س~daysAgo=قبل %count% ي';

  @override
  String get reportIssueCopyCatalog =>
      'title=الإبلاغ عن مشكلة~problem=ما المشكلة؟~problemHint=صف المشكلة باختصار~priority=الأولوية~low=منخفضة~medium=متوسطة~high=عالية~critical=حرجة~site=الموقع~siteHint=مكان اكتشاف المشكلة~asset=المعدة~assetHint=رقم المعدة~due=الاستحقاق خلال~noDate=بدون تاريخ~threeDays=3 أيام~oneWeek=أسبوع~twoWeeks=أسبوعان~details=التفاصيل~detailsHint=أضف الأعراض والموقع وأي إجراء فوري تم اتخاذه~photos=الصور~optional=(اختياري)~addPhoto=إضافة صورة~camera=الكاميرا~gallery=المعرض~photoFailed=تعذرت إضافة الصورة.~submit=رفع المشكلة~titleRequired=أدخل عنوان المشكلة قبل الحفظ.~workspaceUnavailable=لا تزال مساحة العمل قيد التحميل. حاول بعد قليل.~savedTitle=تم حفظ المشكلة~savedBody=أضيفت المشكلة إلى عملي وستتم مزامنتها تلقائياً.~stay=البقاء هنا~viewTasks=عرض عملي~saveFailed=تعذر حفظ المشكلة. حاول مرة أخرى.';

  @override
  String get rcaCopyCatalog =>
      'title=تحليل السبب الجذري~records=سجلات~newRecord=تحليل جديد~none=لا توجد سجلات تحليل~noneBody=ستظهر هنا سجلات تحليل السبب الجذري المكتملة.~unknown=معدة غير معروفة~asset=المعدة~serial=الرقم التسلسلي للإطار~brand=العلامة التجارية~site=الموقع~km=الكيلومترات عند العطل~factors=العوامل المساهمة~rootCause=السبب الجذري~photos=صور الأدلة~photo=صورة~addPhoto=إضافة صورة~camera=الكاميرا~gallery=المعرض~photoFailed=تعذرت إضافة الصورة.~save=حفظ التحليل~missingCause=أدخل السبب الجذري قبل الحفظ.~invalidKm=أدخل قراءة كيلومترات صحيحة.~loadFailed=تعذر تحميل سجلات التحليل.~saveFailed=تعذر حفظ التحليل. حاول مرة أخرى.';

  @override
  String get pmCopyCatalog =>
      'title=مركز التحكم بالصيانة~overdue=متأخرة~dueSoon=مستحقة قريباً~active=الخطط النشطة~due=المستحقة الآن~all=كل الخطط~empty=لا توجد خطط صيانة~emptyDue=لا توجد صيانة وقائية مستحقة خلال 14 يوماً القادمة.~emptyAll=لا توجد خطط صيانة وقائية نشطة.~plan=خطة الصيانة~daysOverdue=يوم تأخير~daysLeft=يوم متبقٍ~noDate=لا يوجد تاريخ استحقاق~record=تسجيل الخدمة~meter=قراءة العداد~performedBy=نفذها~workshop=الورشة~partsCost=تكلفة القطع~labourCost=تكلفة العمالة~findings=الملاحظات~completed=مكتملة~partial=مكتملة جزئياً~deferred=مؤجلة~failed=غير مكتملة~save=حفظ الخدمة~invalidNumber=أدخل قيماً رقمية صحيحة.~loadFailed=تعذر تحميل خطط الصيانة.~saveFailed=تعذر حفظ سجل الخدمة. حاول مرة أخرى.';

  @override
  String get stockCountCopyCatalog =>
      'title=جرد المخزون~items=الأصناف~reorder=تحتاج طلباً~notToday=لم تجرد~search=بحث بالوصف أو الموقع~all=الكل~low=مخزون منخفض~stale=لم يجرد اليوم~empty=لا توجد أصناف~emptyBody=لا توجد سجلات مخزون تطابق المرشحات.~count=جرد~stockItem=صنف مخزون~physicalCount=الكمية الفعلية~reason=السبب (اختياري)~cancel=إلغاء~save=حفظ الجرد~invalid=أدخل كمية صفر أو أكثر.~offlineSaved=حفظ الجرد دون اتصال ووضع في قائمة المزامنة.~saveFailed=تعذر حفظ جرد المخزون.~loadFailed=تعذر تحميل سجلات المخزون.~Critical=حرج~Low=منخفض~OK=جيد~onHand=متوفر';

  @override
  String get calendarCopyCatalog =>
      'title=خطة العمل الميدانية اليوم~scheduled=مجدولة~overdue=متأخرة~today=مستحقة اليوم~week=هذا الأسبوع~later=لاحقاً~inspection=فحص~maintenance=صيانة~task=إجراء تصحيحي~empty=لا توجد أعمال مجدولة~emptyBody=ستظهر هنا الفحوصات والصيانة والإجراءات التصحيحية القادمة.~loadFailed=تعذر تحميل الجدول.';

  @override
  String get managementCopyCatalog =>
      'overviewTitle=نظرة عامة على الأسطول~analyticsTitle=تحليلات الأسطول~reportsTitle=التقرير المالي~reportsSubtitle=ملخص مباشر للتكلفة والأداء~teamTitle=الفريق~last=آخر~days=يوم~days30=30 يوماً~days90=90 يوماً~year1=سنة~allSites=كل المواقع~tyres=الإطارات~vehicles=المركبات~critical=حرجة~openActions=إجراءات مفتوحة~highRisk=مخاطر عالية~inspections30=الفحوصات (30 يوم)~tyreSpend=تكلفة الإطارات~risk=توزيع المخاطر~sites=أعلى المواقع~brands=أعلى العلامات~analyticsFailed=تعذر تحميل التحليلات.~reportsFailed=تعذر تحميل بيانات التقرير.~reportUnavailable=التقرير المباشر غير متاح~reportUnavailableBody=لقطة الخادم الموثوقة غير متاحة. لم يتم اختلاق أي أرقام.~retry=إعادة المحاولة~generated=تم الإنشاء~costPerformance=التكلفة والأداء~fleet=الأسطول~tyre_spend=تكلفة الإطارات~accidents=الحوادث~open_accidents=الحوادث المفتوحة~claims_claimed=المطالبات المقدمة~claims_recovered=المطالبات المستردة~inspections=الفحوصات~work_orders_open=أوامر العمل المفتوحة~tyre_cost=تكلفة الإطارات~maintenance_cost=تكلفة الصيانة~total_cost=إجمالي التكلفة~km=الكيلومترات~engine_hours=ساعات التشغيل~m3=الإنتاج م3~cost_per_km=التكلفة لكل كم~cost_per_hour=التكلفة لكل ساعة~cost_per_m3=التكلفة لكل م3~tyre_cpk=تكلفة الإطار لكل كم~severity=شدة الحوادث~accidents_by_site=الحوادث حسب الموقع~tyres_by_site=الإطارات حسب الموقع~claim_status=حالة المطالبة~members=أعضاء~manage=إدارة الفريق~active=نشط~pending=قيد الانتظار~teamSearch=بحث بالاسم أو الدور أو الموقع~noMembers=لا يوجد أعضاء~trySearch=جرّب بحثاً آخر.~teamFailed=تعذر تحميل دليل الفريق.';

  @override
  String get profileSignOutConfirmTitle => 'تسجيل الخروج؟';

  @override
  String get profileSignOutConfirmMessage =>
      'ستحتاج إلى تسجيل الدخول مرة أخرى لمواصلة العمل. أي عمل محفوظ بالفعل على هذا الجهاز يبقى محفوظاً.';

  @override
  String get accidentCopyCatalog =>
      'loadFailed=تعذر تحميل سجل الحادث. حاول مرة أخرى.~notRecorded=غير مسجل~dashboardTitle=مركز قيادة الحوادث~dashboardSubtitle=سجل مباشر حسب الصلاحيات~reportAction=الإبلاغ عن حادث~reportShort=إبلاغ~loadingRegister=جارٍ تحميل سجل الحوادث…~dashboardEyebrow=إدارة حوادث المعدات والمركبات~dashboardHeroTitle=كل حالة بمسار مسؤول واحد~dashboardHeroMessage=الأسطول والتأمين والورشة والفحص والتسليم والاسترداد ظاهرة دون مؤشرات مختلقة.~searchHint=ابحث بالمعدة أو المرجع أو الموقع~allCases=كل الحالات~reportedByMe=بلاغاتي~anyStatus=أي حالة~open=مفتوح~closed=مغلق~noMatches=لا توجد حالات مطابقة~noMatchesMessage=غيّر التصفية أو أنشئ بلاغًا جديدًا.~loadMore=تحميل حالات أخرى~loading=جارٍ التحميل…~detailTitle=تفاصيل الحادث~loadingFacts=جارٍ تحميل بيانات الحالة…~notFound=الحادث غير موجود~notFoundMessage=السجل خارج نطاق صلاحيتك أو لم يعد موجودًا.~openFlow=فتح مسار الحالة المسؤول~incidentFacts=بيانات الحادث~incidentFactsHint=أدلة المبلّغ وهوية المركبة~liability=المسؤولية والدفع~liabilityHint=المتسبب والمسؤول والجهة الدافعة~insurance=التأمين والاسترداد~insuranceHint=المطالبة والاسترداد منفصلان عن الإغلاق~workshopRelease=الورشة والتسليم~workshopReleaseHint=التقييم والإصلاح والفحص وإعادة المركبة~closure=ضوابط الإغلاق~closureHint=اعتماد الإغلاق وحالة القضية منفصلان~vehicleType=نوع المركبة~plate=اللوحة / رقم الأسطول~type=نوع الحادث~severity=الخطورة~reporter=المبلّغ~evidenceFiles=ملفات الأدلة~description=الوصف~damage=الضرر~fault=حالة الخطأ~responsible=الطرف المتسبب~liable=الطرف المسؤول~payer=الجهة الدافعة~insurer=شركة التأمين~policy=الوثيقة~claimNo=رقم المطالبة~claimStatus=حالة المطالبة~claimed=المبلغ المطالب به~approved=المبلغ المعتمد~recoveryStatus=حالة الاسترداد~recovered=المبلغ المسترد~repairType=نوع الإصلاح~workshop=الورشة~repairCost=تكلفة الإصلاح~expectedRelease=التسليم المتوقع~actualRelease=التسليم الفعلي~nextAction=الإجراء التالي~workflowStage=مرحلة سير العمل~caseStatus=حالة القضية~closureRequest=طلب الإغلاق~closureLevel=مستوى الإغلاق~caseTitle=مسؤولية القضية~loadingWorkstreams=جارٍ تحميل مسارات العمل…~caseNotFound=القضية غير موجودة~caseNotFoundMessage=الحادث خارج نطاق صلاحيتك أو لم يعد موجودًا.~endToEnd=مسار القضية من البداية للنهاية~notActivated=مسار القضية غير مفعّل~notActivatedMessage=الحادث موجود لكن نموذج مسارات العمل غير مهيأ. لم يتم افتراض أي تقدم.~noWorkstreams=لا توجد مسارات معيّنة~noWorkstreamsMessage=نموذج القضية متاح لكن لم تُوجّه لها مسارات بعد.~timeline=الخط الزمني للمسؤولية~timelineHint=بيانات للقراءة فقط من سجل مسارات القضية~boundary=حدود التحكم~boundaryHint=لا يتم اختلاق أي إجراءات~boundaryMessage=قرارات التأمين والتقييم والإصلاح والفحص والتسليم والإغلاق والاسترداد تتطلب إجراءات خادم موثقة. لا توجد تعديلات مباشرة غير آمنة.~done=مكتمل~inProgress=قيد التنفيذ~pending=معلق~notRequired=غير مطلوب~reason=السبب~wsIncident=الحادث والأدلة~wsFleet=تحقق الأسطول~wsLiability=المسؤولية والسلامة~wsInsurance=مطالبة التأمين~wsAssessment=تقييم الورشة~wsRepair=تنفيذ الإصلاح~wsQc=فحص الورشة~wsHandover=تسليم المركبة~wsFinance=الاسترداد والمالية~wsCorrective=الإجراءات التصحيحية~selectAsset=اختر معدة من الأسطول~changeAsset=تغيير المعدة~assetSearch=المعدة أو رقم الأسطول أو اللوحة أو الطراز~unrecordedAsset=معدة غير مسجلة~photoFailed=تعذر حفظ صورة الدليل. حاول مرة أخرى.~workspaceLoading=مساحة العمل ما زالت قيد التحميل. حاول مرة أخرى.~required=المعدة والموقع والوصف وصورة دليل واحدة على الأقل مطلوبة.~fieldsDropped=تعذر حفظ جميع الحقول. لم يتم عرض البلاغ كمقدم.~saveFailed=تعذر حفظ البلاغ على هذا الجهاز. حاول مرة أخرى.~saved=تم حفظ البلاغ~savedTitle=تم حفظ بلاغ الحادث بأمان~savedMessage=البلاغ والأدلة في قائمة مزامنة الجهاز وسيتم رفعهما ضمن مساحة العمل النشطة.~backRegister=العودة إلى سجل الحوادث~reportTitle=الإبلاغ عن حادث~reportSubtitle=التقاط أدلة يعمل دون اتصال~firstResponse=الاستجابة الأولى~captureFacts=سجّل الوقائع في الموقع~captureFactsMessage=اختر المعدة أولاً لتعبئة موقعها وهويتها من سجل الأسطول. صورة دليل واحدة على الأقل إلزامية.~assetLocation=1. المعدة والموقع~assetLocationHint=سجل الأسطول هو المرجع عند توفره~fleetUnavailable=البحث في الأسطول غير متاح. الإدخال اليدوي متاح.~assetNo=رقم المعدة~site=الموقع~exactLocation=المكان الدقيق للحادث~classification=2. التصنيف~classificationHint=يمكن مراجعة التصنيف الميداني لاحقًا~minor=بسيط~moderate=متوسط~severe=خطير~fatal=مميت~collision=تصادم~rollover=انقلاب~propertyDamage=ضرر ممتلكات~other=أخرى~whatHappened=ماذا حدث؟~notes=ملاحظات فورية~evidence=3. الأدلة~evidenceAttached=صور أدلة مرفقة • الحد الأدنى 1~camera=الكاميرا~gallery=المعرض~evidencePhoto=صورة دليل~removePhoto=إزالة الصورة~saveReport=حفظ بلاغ الحادث';
}
