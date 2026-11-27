/**
 * How Tyre Pulse is priced, stated once for the English and Arabic pricing pages.
 *
 * The owner prices per vehicle, per user or per module bundle ("it depends, we can do all 3")
 * and has not published figures. Nothing on the site may show a price until the owner
 * supplies one.
 *
 * TODO(owner): published figures. Set PRICE_FIGURES to real numbers, for example
 *   { perVehicle: "SAR 00 per vehicle per month", perUser: "...", bundle: "..." },
 * and the pricing pages will show them under each model. While it is null, each model
 * says "Quoted on your fleet" instead of a number.
 */
export const PRICE_FIGURES: null | { perVehicle: string; perUser: string; bundle: string } = null;

/** The promise next to the quote form. Change here if the reply time changes. */
export const QUOTE_TURNAROUND = { en: "1 working day", ar: "يوم عمل واحد" } as const;

export const PRICING_MODELS = [
  {
    id: "perVehicle",
    en: { title: "Per vehicle", text: "One rate for each machine, vehicle or plant item on the platform. Suits fleets with many assets and a small office team.", fit: "Best when assets outnumber users" },
    ar: { title: "لكل مركبة", text: "سعر واحد لكل معدة أو مركبة أو آلية على المنصة. يناسب الأساطيل الكبيرة ذات فريق مكتبي صغير.", fit: "الأنسب عندما يفوق عدد الأصول عدد المستخدمين" },
  },
  {
    id: "perUser",
    en: { title: "Per user", text: "One rate for each person who signs in, on the web or the Android app. Suits operations where a few people manage many assets.", fit: "Best when users are few and assets many" },
    ar: { title: "لكل مستخدم", text: "سعر واحد لكل شخص يسجّل الدخول، على الويب أو تطبيق أندرويد. يناسب العمليات التي يدير فيها عدد قليل من الأشخاص أصولاً كثيرة.", fit: "الأنسب عندما يقل عدد المستخدمين وتكثر الأصول" },
  },
  {
    id: "bundle",
    en: { title: "Per module bundle", text: "A fixed rate for the areas you switch on, such as tyres and inspections first, then workshop and stores. Suits a phased start.", fit: "Best when you start with one area of work" },
    ar: { title: "لكل باقة وحدات", text: "سعر ثابت للمجالات التي تفعّلها، مثل الإطارات والفحوصات أولاً ثم الورشة والمستودعات. يناسب البدء على مراحل.", fit: "الأنسب عند البدء بمجال عمل واحد" },
  },
] as const;

export const PRICE_FACTORS = {
  en: [
    ["Number of assets", "Machines, vehicles and plant items on the platform."],
    ["Number of users", "People who sign in on the web or the Android app."],
    ["Modules switched on", "Tyres, inspections, workshop, stores, accidents, reports."],
    ["Countries and sites", "Each country keeps its own records and currency."],
    ["Integrations", "ERP connections, telematics or single sign-on, scoped with you."],
    ["Data migration", "How much history you want loaded from ERP exports and Excel."],
    ["Support terms", "Response times and service levels agreed in your contract."],
  ],
  ar: [
    ["عدد الأصول", "المعدات والمركبات والآليات على المنصة."],
    ["عدد المستخدمين", "الأشخاص الذين يسجّلون الدخول على الويب أو تطبيق أندرويد."],
    ["الوحدات المفعّلة", "الإطارات والفحوصات والورشة والمستودعات والحوادث والتقارير."],
    ["الدول والمواقع", "لكل دولة سجلاتها وعملتها الخاصة."],
    ["التكاملات", "ربط نظام تخطيط الموارد أو أجهزة التتبع أو الدخول الموحد، بنطاق يُتفق عليه معك."],
    ["ترحيل البيانات", "حجم السجل التاريخي الذي تريد تحميله من ملفات نظام تخطيط الموارد وExcel."],
    ["شروط الدعم", "أوقات الاستجابة ومستويات الخدمة المتفق عليها في عقدك."],
  ],
} as const;
