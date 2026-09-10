import fs from 'node:fs';
const p='src/data/releases.json';const releases=JSON.parse(fs.readFileSync(p,'utf8'));
releases.unshift({id:'2026.09.10.5',date:'2026-09-10',changes:[
{modules:['tyre_passport','serial_tracker','fleet_master'],text:{en:'Tyre and vehicle histories load more completely, respect the selected country, and report unavailable history.',ar:'تحميل سجل الإطارات والمركبات بشكل أكمل حسب الدولة المحددة، مع توضيح السجلات غير المتاحة.'}},
{modules:['qr_labels','workshop_live','cpk_intelligence','predictive_maintenance'],text:{en:'Country changes discard outdated results, and operational pages follow module access settings.',ar:'تستبعد تغييرات الدولة النتائج القديمة، وتلتزم الصفحات التشغيلية بإعدادات الوصول للوحدات.'}},
{modules:['pm_programs','shifts'],text:{en:'Maintenance and shift lists include later records and report loading failures more clearly.',ar:'تشمل قوائم الصيانة والورديات السجلات اللاحقة وتوضح أخطاء التحميل.'}},
{modules:['tyre_records'],text:{en:'Filtered record downloads show errors for incomplete exports and prevent repeated download clicks.',ar:'تعرض تنزيلات السجلات المفلترة أخطاء عند عدم اكتمال التصدير وتمنع تكرار النقر أثناء التنزيل.'}}
]});fs.writeFileSync(p,JSON.stringify(releases,null,2)+'\n');
