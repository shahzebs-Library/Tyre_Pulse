# Release notes - TyrePulse Inspector 1.5.0

Web app moves to 2.2.0 in the same release.

**What is on Play today: 1.3.2.** So this release carries everything from 1.3.2
through 1.5.0, not just the last batch. `system_config.mobile_latest_version` is
still 1.3.2 - see "After the build is live" at the bottom.

---

## 1. Paste this into Play Console -> Release -> "What's new"

Google caps this field at **500 characters per language**. Both versions below
are inside that limit. Use the English one for en-US and the Arabic one for
ar (the app ships Arabic, so it is worth filling in).

### English (en-US)

```
Workshop Daily Checklist rebuilt: two-stage sign-off (supervisor, then area
manager), automatic document numbers, and details that fill themselves from the
asset. Nothing closes while a fault is still open.

Fixed: screens that bounced you back to the home page instead of opening. Stock,
Meter Log and Vehicles now open for everyone who can see them.

You stay signed in. Photos, checklists and inspections queued offline can no
longer be lost.
```
(445 characters, Play allows 500)

### Arabic (ar)

```
تم إعادة بناء قائمة الفحص اليومية للورشة: اعتماد على مرحلتين (المشرف ثم مدير
المنطقة)، وأرقام مستندات تلقائية، وبيانات تُملأ تلقائياً من الأصل. لا يمكن
الإغلاق وهناك عطل لم يُصلح بعد.

تم الإصلاح: شاشات كانت تعيدك إلى الصفحة الرئيسية بدل أن تفتح. المخزون وسجل
العداد والمركبات تفتح الآن لكل من يراها.

تبقى مسجلاً للدخول. لا يمكن فقدان الصور وقوائم الفحص المحفوظة دون اتصال.
```

---

## 2. Full changelog - what actually changed and why

Written for a person, not a developer. This is the version to keep for your own
records and to hand to anyone who asks what changed.

### Workshop Daily Checklist and Fleet Transit Mixer - rebuilt

* **Two people sign, in order.** A supervisor signs first, then the area
  manager closes it. Before this, one person could close a sheet and the system
  had no way to record that two had checked it.
* **Nothing closes while a fault is open.** If any line is marked Not OK, the
  final approval is refused until the item is re-marked as repaired. This is
  enforced by the database, not just by the screen, so it cannot be bypassed.
  A supervisor can still sign off with a fault present - a fault found on the
  last item of the day must still be recordable - but it cannot be closed.
* **Automatic document number**, for example `WDC-TM514-2026-0001`. It is
  assigned when the sheet is created, counted per asset per year. An abandoned
  sheet never burns a number, and a sheet uploaded days later from a phone that
  was offline still gets one.
* **Enter the asset once.** The asset code is asked in one place only. The
  registration / fleet number and the site fill themselves from the register and
  show as read-only - but only when the register actually has that value, so a
  vehicle we do not hold a fleet number for can still be filled in by hand.
* **Km and hour meter.** Either one is enough. Zero is accepted as a real
  reading rather than treated as blank.
* **Eight marking icons, each with a plain meaning** - OK, Not OK, Repaired,
  Adjusted, Lubricated, Not applicable and so on, instead of a bare word.
* **Ten-day reminder.** If the same vehicle comes back inside ten days the sheet
  says so. It warns; it never refuses.
* **Removed** the "Inspection stage" field and the "Job card No" field, and the
  duplicate places that asked for the asset and the site a second time.
* **Language selector** on the sheet itself, offering only the languages that
  sheet actually carries. Answers are always recorded in English whichever
  language it was filled in.
* Photos can be added from the gallery, not only the camera. A signature can be
  opened and viewed, with the signer's name.

### Approvals

* The queue keeps your place. It no longer scrolls back to the top each time.
* After signing you stay on the record instead of being thrown back to Home.
* The queue now shows sheets waiting on either rung and says which one is
  holding it, rather than the single word "pending".
* Inspections and checklists are both signed through the server, so two people
  cannot approve the same record and silently overwrite each other, and the
  approver's name comes from the account that signed rather than from the form.

### Screens that would not open (the one most people will notice)

Several screens checked permissions differently from the menu that offered
them. You saw the tile, tapped it, and were sent straight back to Home - which
reads as the screen spinning or never loading.

* **Stock** did this for inspectors.
* **Meter Log** did this for drivers - their own main tab.
* **Vehicles** and **Calendar** did it for other roles.

All screens now read one shared list of who may open what, so the menu and the
screen can never disagree again. A per-person access grant given from the web
Access Manager now works on the phone as well; before this it was ignored.

### Staying signed in

* You are no longer signed out for no reason. Two separate causes were fixed: a
  single refused read from the phone's secure storage was being treated as "no
  account", and the app was not refreshing its session while in the background,
  so a phone left overnight woke up signed out.
* The offline profile is kept for 90 days instead of 14, so time off does not
  lock you out of your own queued work.

### Work that can no longer be lost

* If the phone's secure storage refuses a read, the app no longer treats it as
  "nothing is queued" and overwrites your unsynced inspections and accident
  reports with an empty list. It now refuses to save rather than destroy what is
  there. The trade is deliberate: risk failing to save one new item rather than
  silently losing all of them.
* Photos attached to a checklist are stored durably as soon as they are queued.

### Inspections

* An inspection can no longer be signed off with wheels nobody attended to. Any
  wheel still needing details is named by position and outlined on the diagram.
  Equipment with no tyres correctly reports "not applicable" rather than "0 of 0",
  and a spare is never counted as missing.
* The summary cards now answer the same question as the filters above them.
  Selecting a region or a site used to leave the cards showing the whole fleet.

### Assets and lists

* Lists stopped silently showing only the first 1,000 rows. This affected asset
  pickers, QR labels, site lists and around twenty other places - an asset past
  the first thousand simply could not be found, which read as "the asset was
  never created".
* Concrete pump diagrams: stationary pumps, placing booms and spider pumps were
  being drawn as a 14-wheel truck. Machines with no wheels now say so.

### Performance and stability

* Release builds are now shrunk and optimised (R8), so the app is smaller and
  starts faster.
* Fixed a crash on the sync banner and several lifecycle crashes found in the
  crash reports.

---

## 3. Play Console checklist for this release

- [ ] Build and upload the AAB. **This has not been built yet** - no EAS build
      was created in this session, by request.
- [ ] Paste the "What's new" text above (en-US, and ar if you fill Arabic).
- [ ] Screenshots: still outstanding. Play needs 2 to 8 phone screenshots taken
      from the real running app.
- [ ] App access: Play reviewers need a working test login, because the app
      requires sign-in. Give them an approved account.
- [x] Privacy policy URL - https://tyrepulse.app/privacy
- [x] Data deletion URL - https://tyrepulse.app/data-deletion
- [x] Data safety answers - unchanged, see PLAY_STORE_LISTING.md

---

## 4. After the build is live - two settings, in this order

Both are in the web app under **Console -> Mobile App**.

1. **Record the release**: set `mobile_latest_version` to `1.5.0`. It is still
   `1.3.2`, so until you change it the app does not know a newer build exists.
2. **Only then** consider raising `mobile_min_version`. Leave it at `1.3.2` until
   testers confirm 1.5.0 works on a real phone. Setting a minimum higher than
   what is actually on Play locks every phone out with nothing to update to.
   The screen refuses to save that, but the rule is worth knowing.

---

## 5. Two things that are configuration, not code

These do not stop the release, but the two new checklists reach almost nobody
until they are done. Both are in the web app.

1. **Assign the trades.** Right now **no account holds Mechanic, Electrician,
   Driver or Maintenance Supervisor**, so on the phone only the five oversight
   users see the two sheets. All four roles exist and are ready to assign -
   this was verified against the live database. Set them in **Console -> Users**
   and the sheets appear immediately, no new build needed.
2. **Create a schedule.** There are no checklist schedules yet, so the "Due"
   list stays empty. The ten-day interval only powers the warning; it does not
   create the work. Set one up in Checklist Schedules.
