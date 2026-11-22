# REPS hours tracker (`/reps/`)

A private, phone-first PWA for logging real estate professional (IRC §469(c)(7)) hours for tax year 2027.
It lives at **https://hreinvestor.com/reps/**. Nothing links to it, and it is marked `noindex, nofollow`.

## What's in it
- **Log:** a one-handed entry form with date, start/end or duration, activity, property (3506 Gay St NW preset plus free text), a required description, and optional photo/receipt. It has a "who" toggle (her by default, or Joshua for material participation only) and a start/stop timer.
- **Progress:** year-to-date qualifying hours against the 750 goal and 900 target, the required weekly pace, this week and this month, a breakdown by activity, combined material-participation hours by property, and the more-than-half test. It warns when she is behind pace or logged an entry more than 48 h after the work date.
- **Entries:** a list by month. Tap an entry to see its photos, edit history, Edit, or Delete. Delete is a soft delete, so the entry stays in the history.
- **Export:** a one-tap .zip for this month, last month, any quarter, the full year, or a custom range, plus a **Tax package 2027** preset for the CPA. The zip contains `entries.csv` (server timestamps, version, deleted status), `edit_history.csv`, `summary.pdf` (totals by category/month/property, the 750-hour test, and signature lines), `evidence/`, and a `README.txt` with SHA-256 checksums.
- **Settings:** name, tax year, goals, other (non-real-estate) work hours, reminder toggles and times, notifications on/off/test, and sign out.
- **Offline:** entries saved without a connection are queued on the phone in IndexedDB, photos included. They sync automatically when the phone is back online.

## Back end (Supabase project `lmivqwscebdupfxxwfcc`)
These are all new objects. Migration: `supabase/migrations/20261122_reps_tracker.sql`.

| Object | Purpose |
|---|---|
| `reps_allowed_emails` | Allowlist. Only these emails can sign in or see any REPS data (RLS + `reps_me_allowed()`). |
| `reps_entries` | Entries. `created_at` is set by the server and can't be changed. `qualifying` is generated (education = false). There is no DELETE policy. |
| `reps_entry_versions` | Trigger-written snapshot of the prior row on every edit, delete, or restore. |
| `reps_settings` | One row per user: goals and reminder schedule. |
| `reps_push_subscriptions` | Web Push subscriptions for each device. |
| `reps_notification_log` | What the scheduler sent. |
| Storage bucket `reps-evidence` | Private, 15 MB limit, images and PDF. Path `<user_id>/<entry>/<file>`. Write-once: no update or delete policy. |
| Edge Function `reps-notify` | Web Push sender. Actions: `vapid`, `test`, `tick`. |
| pg_cron job `reps-notify-tick` | Runs every 15 minutes. The function converts to America/Chicago (DST-aware) and sends the daily 7:30 PM reminder (only if nothing is logged today), the Sunday 6 PM weekly summary and pace check, and the reminder on the 1st to export the package. Times are editable in the app. |

Secrets: the VAPID key pair and the cron shared secret live in **Supabase Vault** (`reps_vapid_public`, `reps_vapid_private`, `reps_cron_secret`). The function generated the VAPID keys itself on first run, so the private key has never left Supabase. Only the service role can read them, through `reps_get_secrets()`. Nothing secret is in this repo.

## Add her email (required before first use)
Supabase Dashboard → SQL Editor:
```sql
insert into public.reps_allowed_emails (email, note) values (lower('her@email.com'), 'REPS tracker');
-- remove someone:  delete from public.reps_allowed_emails where email = lower('her@email.com');
```
Joshua can add his own email too if he wants to log on his phone. His entries will be separate; use the "Joshua (MP only)" toggle on her phone to keep the combined material-participation totals in one place.

Her first sign-in creates a normal Supabase Auth user. The existing signup trigger also creates a `member_profiles` row with role `investor` / `pending`, which gives her **no** CRM access.

## Install on her iPhone (iOS 16.4+)
1. In **Safari**, open `https://hreinvestor.com/reps/`.
2. Tap **Share → Add to Home Screen → Add**.
3. Open **REPS Log** from the home screen. The home-screen app has its own sign-in, separate from Safari.
4. Enter her email and tap **Email me a code**. Type the 6-digit code from the email.
   If the email only has a link, long-press it, tap **Copy Link**, and paste it under "The email only has a link?"
5. Go to **Settings → Turn on notifications → Allow**, then tap **Send a test notification**.

Android (Chrome): open the URL, tap **Install app** or **Add to Home screen**, then follow steps 3–5.

## Notes
- **Email code vs link:** Supabase's default "Magic Link" email template only contains a link. To also show a 6-digit code (better for the iPhone home-screen app), edit Dashboard → Auth → Email Templates → Magic Link and add `{{ .Token }}`. The paste-link fallback works either way.
- Logs should be made the same day. Entries saved more than 48 h after the work date are flagged in the app, the CSV, and the PDF.
- Export a package every month and keep it outside the phone (Files/iCloud/Drive).
- This is a record-keeping tool, not tax advice. Confirm REPS treatment with the CPA.
