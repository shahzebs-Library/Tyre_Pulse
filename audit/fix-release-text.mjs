import fs from 'node:fs';
const path='src/data/releases.json';const releases=JSON.parse(fs.readFileSync(path,'utf8'));
const ar=[
['اطّلع على التغييرات قبل التحديث، واعرض الإصدارات السابقة في الإعدادات > سجل التحديثات.'],
['تعرض تقارير الغسيل عملية غسيل واحدة وثلاث صور أكبر في صفحة واحدة، مع تفاصيل أوضح للمركبة.','تلتزم تنزيلات الغسيل بالفلاتر المحددة. يمكن إغلاق رسائل التنزيل وتختفي تلقائياً.'],
['تعرض صفحتك الرئيسية الوحدات المسموح بها وتتجنب تحميل بيانات لوحة المعلومات غير المتعلقة بعملك.','تلتزم قوائم مراقب البيانات والبحث والوصول إلى الصفحات بالصلاحيات المحفوظة في الإعدادات.'],
['حدّث الكيلومترات وساعات المحرك في صف المركبة نفسه. تظهر تحذيرات القراءات عند الحفظ.','يمكن لمشرفي الأسطول جدولة غسيل المركبات وتسجيله وتصدير تقارير PDF تتضمن الصور المرفوعة.']];
releases.forEach((r,i)=>r.changes.forEach((c,j)=>c.text.ar=ar[i][j]));fs.writeFileSync(path,JSON.stringify(releases,null,2)+'\n');
const p='src/locales/ar/pwa.json';const data=JSON.parse(fs.readFileSync(p,'utf8'));
Object.assign(data,{whatsNew:'ما الجديد',viewChanges:'عرض التغييرات',updateHistory:'سجل التحديثات',installedVersion:'الإصدار المثبت:',noRelevantChanges:'لا توجد تغييرات مدرجة للوحدات المسموح لك بها في هذا الإصدار.',notesUnavailable:'تفاصيل الإصدار غير متاحة. لا يزال بإمكانك التحديث.',notesLoading:'جارٍ تحميل تفاصيل التحديث…',saveBeforeUpdate:'احفظ عملك قبل التحديث.',updateFailed:'تعذر بدء التحديث. يرجى المحاولة مرة أخرى.'});fs.writeFileSync(p,JSON.stringify(data,null,2)+'\n');
const en='src/locales/en/pwa.json';const e=JSON.parse(fs.readFileSync(en,'utf8'));e.notesLoading='Loading update details...';fs.writeFileSync(en,JSON.stringify(e,null,2)+'\n');
const component='src/components/PwaUpdatePrompt.jsx';fs.writeFileSync(component,fs.readFileSync(component,'utf8').replace('{release && <> ? <bdi>','{release && <> &middot; <bdi>'));
