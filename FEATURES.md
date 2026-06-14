# TyrePulse Features Guide

A simple, plain-language guide to everything TyrePulse can do, why it helps, and how to use it. Written for real people, not engineers.

TyrePulse has two apps that share one secure database:
1. The Web app (for office, managers, and analysts).
2. The Mobile app (for inspectors and tyre staff in the field).

---

## 1. The big picture

TyrePulse turns your tyre and fleet data into clear decisions. You upload or capture data once, and the system cleans it, checks it, scores it, and shows you cost, risk, and what to do next. Everything is role based, so each person only sees what they should.

Main benefits:
- Lower tyre cost per kilometer by spotting waste early.
- Fewer breakdowns by catching worn or wrong-pressure tyres before they fail.
- Faster, cleaner reporting with no manual spreadsheets.
- A full history you can trust, with who did what and when.

---

## 2. Web app features

### Dashboard
What it is: Your morning snapshot of the whole fleet.
How to use: Open the app and it loads first. Use the date and country filters at the top.
Why it helps: You see total cost, risk levels, recent activity, and open issues in one place, so you know where to look first.

### Tyre Records
What it is: The full list of every tyre issue, change, and cost.
How to use: Search by asset or serial, filter by site, brand, or risk, then click a row to view or edit. Bulk edit lets you update many rows at once.
Why it helps: One source of truth for every tyre. No more lost paper records.

### Inspections
What it is: Plan, track, and complete tyre inspections.
How to use: Schedule an inspection, mark it done, attach findings. Overdue ones turn red automatically.
Why it helps: Keeps inspections on time and gives proof of compliance.

### Accidents and Claims (deep module)
What it is: A full incident and insurance claim manager, not just a list.
How to use: Open an accident to see tabs for Overview, Claim and Recovery, Parts and Repairs, Case Log, Activity, and Closure.
- Record who is responsible, who is liable, and who pays.
- Add a parts list with costs. The system adds up the total for you.
- Track the insurance claim and the money recovered, so you see the real net cost after recovery.
- Post remarks to the case log, for example "insurance rejected claim today".
- When a field user requests closure, every admin or manager gets notified to approve it.
- The Activity tab shows who changed what, with the old and new values.
Why it helps: Nothing falls through the cracks. You always know the status, the cost, the responsible party, and the full history of a claim.

### Upload Data (smart importer)
What it is: Bring in Excel or CSV files without fixing them by hand.
How to use:
1. Pick the data type (tyres, fleet, stock) or let it auto detect.
2. Drop your file. Excel, OpenDocument, and CSV or TSV files all work (.xlsx, .xls, .xlsm, .xlsb, .ods, .csv, .tsv, .txt).
3. The system finds your header row and matches your columns automatically, even with different names or Arabic headers.
4. Check the File Preview. If the wrong header row was picked, choose the right one and it remaps at once.
5. Review the Data Quality report (how full each column is, bad dates or numbers, duplicates inside the file).
6. See the Cleaning Preview, then approve and upload.
Why it helps: It saves hours, prevents wrong data, and never silently drops your rows. If a file looks empty, the preview lets you fix the header row in one click.

### Data Cleaning
What it is: A place to review and approve records the system was unsure about.
How to use: Open Data Cleaning after an upload. Approve, fix, or recategorise the flagged rows. An optional AI helper can suggest categories for tricky rows.
Why it helps: Keeps your data clean and trustworthy without slowing down the upload.

### Custom Data
What it is: A safe home for any extra columns in your files that do not match a standard field.
How to use: Browse, search, and export them, or teach the system to recognise them next time.
Why it helps: You never lose information, even from messy files.

### Reports and Executive Report
What it is: Ready made reports for tyres, inspections, costs, and leadership summaries.
How to use: Pick a report type, set filters and date range, then export to Excel or PDF, or email it. The Executive Report respects your active country and the period you choose.
Why it helps: Professional reports in seconds, with the right numbers for the right region.

### Analytics suite
What it is: A set of focused analysis pages.
Includes: Fleet Analytics, Brand Performance, Site Comparison, Country Comparison, Period Comparison, KPI Scorecard, Engineering KPI, Performance Benchmark, Predictive Maintenance, Cost Center, Fuel Efficiency, Vendor Intelligence, and Position Intelligence.
How to use: Open the page you need and use the filters. Charts and tables update together.
Why it helps: Answers real questions, like which brand lasts longer, which site spends more, and which tyres are about to fail.

### Procurement, Budgets, Stock, and Work Orders
What it is: The buying and inventory side.
How to use: Track purchase orders, set and watch budgets, manage stock levels and movements, and raise work orders for repairs.
Why it helps: Controls spending and keeps the right parts on the shelf.

### QR Labels and Tyre Scan
What it is: Make scannable labels and look up tyres by code.
How to use: Generate QR or barcode labels for tyres and assets, then scan to find a record fast.
Why it helps: Faster field work and fewer typing errors.

### Asset Management and Fleet Master
What it is: Your vehicle and asset registry with a health view.
How to use: Keep vehicle details, see a health matrix, and track active or inactive assets.
Why it helps: Connects tyres to the vehicles they run on.

### Alerts and Notifications
What it is: Live warnings for risky tyres and important events.
How to use: The bell in the top bar shows new alerts and approvals in real time. Click one to act on it.
Why it helps: You react to problems quickly instead of finding out later.

### AI Command Center
What it is: An assistant that answers questions about your fleet data.
How to use: Ask in plain language. It pulls from your data and replies.
Why it helps: Quick answers without building a report.

### Audit Trail
What it is: A record of important changes across the system.
How to use: Open Audit Trail to see actions, who did them, and when.
Why it helps: Accountability and easy investigation.

### Settings, Users, and Console
What it is: Control of the whole platform.
How to use: Set country and currency, manage users and approvals, set roles and module permissions, and use the admin console for system settings.
Why it helps: You run the system your way and keep access tight.

---

## 3. Mobile app features (Inspector)

The mobile app is built for fast, offline-friendly field work. It works in English, Arabic, and Urdu, including right to left layout.

### Sign in your way
What it is: Login with email, username, or employee ID.
Why it helps: Field staff do not need to remember an email.

### Smart navigation by role
What it is: The bottom tabs change based on who you are.
Why it helps: Each person sees only the tools they need.

### Tyre inspection with a vehicle diagram
What it is: A clear top down picture of the vehicle. Tap a tyre to open a focused popup and record its details.
How to use: Pick the site and vehicle, tap each tyre, set the condition with clear icons (good, worn, damaged, puncture, flat, missing), add pressure, serial, photo, and notes. A progress bar shows how many tyres are done.
Why it helps: Fast, accurate, and hard to get wrong.

### Scan to start
What it is: Scan a QR or barcode on a tyre or vehicle.
How to use: Point the camera. If it finds a vehicle, you can start an inspection. If it finds a tyre, you can inspect that tyre with its details prefilled.
Why it helps: No manual searching, fewer mistakes.

### Serial lookup
What it is: Type or scan a serial and the app finds the matching tyre record.
Why it helps: You get the correct brand, size, and last reading right away.

### Accident reporting with photos
What it is: File an incident from the field with photos.
How to use: Fill the form, capture photos, submit. Photos upload to secure storage so they show up on the web too.
Why it helps: Incidents are reported on the spot with proof.

### Accident claims and recovery on mobile
What it is: The same deep claims tools as the web, in your pocket.
How to use: View and edit claim and recovery details, add parts, post case log remarks, request closure, and (for managers) approve or reject.
Why it helps: Managers can act without going back to a desk.

### Accident PDF export
What it is: Make a full accident report as a PDF on the phone.
How to use: Open an accident and tap share. It builds a PDF with incident, claim, recovery, parts, log, and photos, then opens the share sheet.
Why it helps: Send a complete report to anyone in seconds.

### Activity and audit
What it is: See who changed what on an accident, with the before and after values.
Why it helps: Trust and accountability in the field.

### Works offline
What it is: Inspections save on the device when there is no signal.
How to use: Just keep working. When the connection returns, the app syncs automatically.
Why it helps: No lost work in remote sites.

### Admin snapshot
What it is: A quick management view with key counts, pending approvals, and closures awaiting action.
Why it helps: Managers get the headlines on mobile.

---

## 4. Security and data protection

Your data is protected at every layer.
- Every table uses row level security, so people only read and write what their role allows.
- Anonymous visitors can read nothing sensitive. We verified this directly.
- Login passwords are protected, and accounts can use two factor authentication.
- Sensitive keys live on the server only, never in the browser or the app bundle.
- Database functions are locked down so they cannot be misused.
- Photos are stored in secure cloud storage with public links only where intended.
- The web app sends strong security headers (for example HSTS) and ships a security.txt contact file.

Why it helps: You can start using the system with confidence that customer and fleet data is safe.

---

## 5. Roles, in plain terms

- Admin: full control, user management, and final approvals.
- Manager and Director: management views, approvals, and analytics.
- Inspector and Tyre Man: field work, inspections, accident reports, and their own records.
- Reporter: can report incidents.

Each role sees a tailored set of screens and actions, on both web and mobile.

---

## 6. How a normal day looks

1. An inspector scans a vehicle and records tyre conditions on the phone, even offline.
2. The data syncs and appears on the web dashboard and in tyre records.
3. The system cleans and scores the data, and flags any risk.
4. A manager sees alerts, checks analytics, and approves any pending closures.
5. Reports go out to leadership with the right numbers for each country.

That is TyrePulse: capture once, trust the data, and act with confidence.
