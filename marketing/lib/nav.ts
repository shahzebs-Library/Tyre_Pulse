/** One definition of the site's page map, read by the header, footer and sitemap. */
export const PLATFORM_PAGES = [
  { href: "/platform", label: "Platform overview", text: "Every module in one connected system", labelAr: "نظرة عامة على المنصة", textAr: "كل الوحدات في نظام واحد مترابط" },
  { href: "/platform/fleet-assets", label: "Fleet and assets", text: "Asset records, meters, lifecycle", labelAr: "الأسطول والأصول", textAr: "سجلات الأصول والعدادات ودورة الحياة" },
  { href: "/platform/maintenance", label: "Maintenance and workshop", text: "Work orders, technicians, parts", labelAr: "الصيانة والورشة", textAr: "أوامر العمل والفنيون وقطع الغيار" },
  { href: "/platform/inspections", label: "Inspections and safety", text: "Checklists, defects, sign-off", labelAr: "الفحوصات والسلامة", textAr: "قوائم الفحص والأعطال والاعتماد" },
  { href: "/platform/inventory", label: "Inventory and reporting", text: "Stores, purchasing, costs", labelAr: "المخزون والتقارير", textAr: "المستودعات والمشتريات والتكاليف" },
] as const;

export const SOLUTION_PAGES = [
  { href: "/solutions/tyre-management", label: "Tyre management", text: "Cost per km, removal forecasts, TPMS alerts", labelAr: "إدارة الإطارات", textAr: "التكلفة لكل كيلومتر وتوقع الاستبدال وتنبيهات ضغط الإطارات" },
  { href: "/solutions/ready-mix-fleet", label: "Ready-mix fleet", text: "Mixers, pumps, downtime, cost per m3", labelAr: "أسطول الخرسانة الجاهزة", textAr: "الخلاطات والمضخات والتوقف والتكلفة لكل متر مكعب" },
  { href: "/solutions/spreadsheets-to-platform", label: "Spreadsheets to platform", text: "Compare approaches and move your files", labelAr: "من الجداول إلى المنصة", textAr: "قارن الطرق وانقل ملفاتك" },
  { href: "/industries", label: "Industries", text: "Construction, ready-mix, transport, rental", labelAr: "القطاعات", textAr: "الإنشاءات والخرسانة الجاهزة والنقل والتأجير" },
  { href: "/pricing", label: "Pricing", text: "Plans by fleet size and modules", labelAr: "الأسعار", textAr: "خطط حسب حجم الأسطول والوحدات" },
] as const;

export const RESOURCE_PAGES = [
  { href: "/platform#tours", label: "Product tours", text: "Six workflows, phone and web side by side", labelAr: "جولات المنتج", textAr: "ست مسارات عمل على الهاتف والويب" },
  { href: "/security", label: "Security", text: "Tenant isolation, roles, audit", labelAr: "الأمان", textAr: "عزل الشركات والأدوار وسجل التدقيق" },
  { href: "/contact", label: "Contact", text: "Book a demo or talk to sales", labelAr: "تواصل معنا", textAr: "احجز عرضاً أو تحدث إلى المبيعات" },
] as const;
