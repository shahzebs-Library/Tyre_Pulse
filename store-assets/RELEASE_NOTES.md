# Release notes - TyrePulse Inspector 1.6.0

Build 43, submitted to the Play **Closed testing** track on 2026-08-19.

**What is on Play Production today: 1.3.2.** This release therefore carries
everything from 1.3.2 through 1.6.0, not just the last batch.
`system_config.mobile_latest_version` is still 1.3.2 - see "After the build is
live" at the bottom.

---

## 1. Paste this into Play Console -> Release -> "What's new"

Google caps this field at **500 characters per language**. Both versions below
are inside that limit. Use the English one for en-US and the Arabic one for ar.

### English (en-US)

```
Back now returns to where you were, not the home screen.

The home screen is cleaner: less text on every button, and colour now only
marks what needs attention.

Checklist condition icons show correctly again.

Approvals stay on the record after you sign, and a screen you cannot open now
says so instead of sending you home.

Plus everything from the Workshop Daily Checklist release: two-stage sign-off,
automatic document numbers, and resumable sheets.
```
(437 characters, Play allows 500)

### Arabic (ar)

```
زر الرجوع يعيدك الآن إلى المكان الذي كنت فيه، وليس إلى الشاشة الرئيسية.

الشاشة الرئيسية أصبحت أوضح: نص أقل على كل زر، واللون يشير الآن إلى ما يحتاج
انتباهك فقط.

أيقونات حالة قائمة الفحص تظهر بشكل صحيح مرة أخرى.

تبقى الموافقات على السجل بعد التوقيع، والشاشة التي لا يمكنك فتحها توضح ذلك
بدلاً من إعادتك إلى الرئيسية.
```

---

## 2. What actually changed in 1.6.0

**Back navigation went to the home screen from every screen.** The cause was
the navigator, not the individual screens: every screen sits in one tab
navigator whose back behaviour defaulted to "first route", so its history was
always [Home, current] and Back always popped to Home. Three earlier attempts
adjusted per-screen fallbacks that were never reached. One navigator setting
fixed it.

**Home screen decluttered.** The second line of explanatory text under every
tile is gone. The seven decorative tile colours are replaced by one neutral
treatment plus colour reserved for real signal - red for Accidents, File
Accident and Alerts; green for Approvals. The grid is squared to a consistent
three-across. No tile was removed and no role lost access to anything.

**Checklist condition icons rendered as "?".** The icon lookup was being
skipped and a type cast hid it.

**Approvals bounced to the home screen.** A screen you lack access to now says
so and stays put, instead of vanishing and dumping you on Home - which read as
the app malfunctioning rather than as a refusal.

**Language fixes.** Removed a key present only in Arabic, which could print a
raw key path on screen instead of text. English and Arabic are now identical at
1564 keys each.

---

## 3. Shipping this release

**The app is already live in Production and the store listing is complete and
approved** - screenshots, data safety, content rating, App access, privacy
policy. None of that needs redoing.

1. The AAB is built and already submitted to **Closed testing** (run 32184166231,
   commit 4b7f4df9, versionName 1.5.0).
2. Play Console -> Testing -> Closed testing -> open the release ->
   **Promote release -> Production** -> roll out. Same AAB, no rebuild, no new
   listing review.
3. Paste the "What's new" text from section 1.

**Worth one day in Closed testing first, and this is the only reason:** this is
the first release with R8 shrinking enabled. R8 fails in ways that are invisible
until a real device runs the app. Have one person open an inspection with photos,
the scanner, and a checklist. If something that used to work is broken, R8 is the
first suspect and it is a minutes-long change to disable.

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
