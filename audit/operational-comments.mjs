import fs from 'node:fs';
for (const p of ['src/lib/api/pmPrograms.js','src/lib/api/shifts.js']) {
 let s=fs.readFileSync(p,'utf8');
 s=s.replace(/ \* When the table has not been migrated yet,[\s\S]*? \* throwing\.\n/, ' * Read failures propagate so unavailable data is not presented as an empty list.\n');
 s=s.replace(/Returns \[\] when the table is missing so\n \* the UI can prompt for the migration rather than error\./g,'Read failures propagate to the page.');
 s=s.replace(/Optional country \/ status filters\. Returns \[\] when the table is missing so\n \* the UI can prompt for the migration rather than error\./g,'Optional country / status filters. Read failures propagate to the page.');
 s=s.replace('limit?:number','');
 s=s.replace(/country-scoped \(null-safe\)\. Returns \[\] when the table is not\n \* provisioned so the page degrades to an "apply the migration" state\./,'country-scoped (null-safe). Read failures propagate to the page.');
 s=s.replace(/Each meter source degrades independently to\n \* an empty map on a missing relation, so one absent table never sinks the other\./,'Meter failures propagate; unavailable readings must not imply compliance.');
 fs.writeFileSync(p,s);
}
const p='src/lib/api/vehicleHistory.js';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace("import { sanitizeSearchTerm } from '../searchFilter'\n",''));
