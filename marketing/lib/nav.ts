/** One definition of the site's page map, read by the header, footer and sitemap. */
export const PLATFORM_PAGES = [
  { href: "/platform", label: "Platform overview", text: "Every module in one connected system", labelAr: "نظرة عامة على المنصة", textAr: "كل الوحدات في نظام واحد مترابط" },
  { href: "/platform/fleet-assets", label: "Fleet and assets", text: "Asset records, meters, lifecycle", labelAr: "الأسطول والأصول", textAr: "سجلات الأصول والعدادات ودورة الحياة" },
  { href: "/platform/maintenance", label: "Maintenance and workshop", text: "Work orders, technicians, parts", labelAr: "الصيانة والورشة", textAr: "أوامر العمل والفنيون وقطع الغيار" },
  { href: "/platform/inspections", label: "Inspections and safety", text: "Checklists, defects, sign-off", labelAr: "الفحوصات والسلامة", textAr: "قوائم الفحص والأعطال والاعتماد" },
  { href: "/platform/tyre-lifecycle", label: "Tyre lifecycle", text: "Serials, fitment to removal, cost per km", labelAr: "دورة حياة الإطارات", textAr: "الأرقام التسلسلية من التركيب إلى الإزالة والتكلفة لكل كيلومتر" },
  { href: "/platform/inventory", label: "Inventory and procurement", text: "Stores, purchasing, suppliers", labelAr: "المخزون والمشتريات", textAr: "المستودعات والمشتريات والموردون" },
  { href: "/platform/reports", label: "Reports and dashboards", text: "Dashboards, scheduled reports, shared boards", labelAr: "التقارير ولوحات المتابعة", textAr: "لوحات المتابعة والتقارير المجدولة واللوحات المشتركة" },
] as const;

export const SOLUTION_PAGES = [
  { href: "/solutions/tyre-management", label: "Tyre management", text: "Cost per km, life forecasts, TPMS via telematics", labelAr: "إدارة الإطارات", textAr: "التكلفة لكل كيلومتر وتوقع العمر وضغط الإطارات عبر أنظمة التتبع" },
  { href: "/solutions/ready-mix-fleet", label: "Ready-mix fleet", text: "Mixers, pumps, downtime, cost per m3", labelAr: "أسطول الخرسانة الجاهزة", textAr: "الخلاطات والمضخات والتوقف والتكلفة لكل متر مكعب" },
  { href: "/solutions/spreadsheets-to-platform", label: "Spreadsheets to platform", text: "Compare approaches and move your files", labelAr: "من الجداول إلى المنصة", textAr: "قارن الطرق وانقل ملفاتك" },
  { href: "/industries", label: "Industries", text: "Construction, ready-mix, transport, buses", labelAr: "القطاعات", textAr: "الإنشاءات والخرسانة الجاهزة والنقل والحافلات" },
  { href: "/pricing", label: "Pricing", text: "Plans by fleet size and modules", labelAr: "الأسعار", textAr: "خطط حسب حجم الأسطول والوحدات" },
] as const;

export const RESOURCE_PAGES = [
  { href: "/security", label: "Security and data protection", text: "Data isolation, roles, audit trail", labelAr: "الأمان وحماية البيانات", textAr: "عزل البيانات والأدوار وسجل التدقيق" },
  { href: "/faq", label: "FAQ", text: "Deployment, data import, roles, reporting", labelAr: "الأسئلة الشائعة", textAr: "التشغيل واستيراد البيانات والأدوار والتقارير" },
  { href: "/about", label: "About", text: "What Tyre Pulse is and who it is for", labelAr: "عن تاير بالس", textAr: "ما هو تاير بالس ولمن صُمم" },
  { href: "/contact", label: "Contact", text: "Book a demo or talk to sales", labelAr: "تواصل معنا", textAr: "احجز عرضاً أو تحدث إلى المبيعات" },
] as const;

/** Product tours sit at the end of the /platform page, so they close the Platform menu too. */
export const TOURS_LINK = { href: "/platform#tours", label: "Product tours", text: "Six workflows, phone and web side by side", labelAr: "جولات المنتج", textAr: "ست مسارات عمل على الهاتف والويب" } as const;

/**
 * The ONE menu order, read by the header and the footer. Each group lists its pages in the
 * order the content appears on the site (Platform: overview, the four module pages in the
 * order /platform shows them, then the tours at the bottom). Keep header and footer on this.
 */
export const MENU_GROUPS = [
  { id: "platform", label: "Platform", labelAr: "المنصة", items: [...PLATFORM_PAGES, TOURS_LINK] },
  { id: "solutions", label: "Solutions", labelAr: "الحلول", items: SOLUTION_PAGES },
  { id: "resources", label: "Resources", labelAr: "الموارد", items: RESOURCE_PAGES },
] as const;

/**
 * Where a menu link lands. Every page in the menus opens with the same PageTop banner, and the
 * owner wants a menu click to arrive where the module details start, so page links jump to the
 * `#details` anchor PageTop places right under the banner. Links that already carry a section
 * (Product tours -> #tours) keep it.
 */
export const DETAILS_ANCHOR = "details";
export const menuHref = (href: string) => (href.includes("#") ? href : `${href}#${DETAILS_ANCHOR}`);

/**
 * Every page route the site serves, in one list. The sitemap is checked against
 * this in test/site-map.test.mjs, so a page cannot be added to a menu without
 * also being listed for crawlers (or the other way round).
 */
export const ALL_ROUTES: readonly string[] = [
  "/",
  ...PLATFORM_PAGES.map((p) => p.href),
  "/solutions",
  ...SOLUTION_PAGES.map((p) => p.href),
  ...RESOURCE_PAGES.map((p) => p.href),
  "/ar",
];
