# ArkaTasks — Client Access Guide

**DClean · Cleaning schedule app**

**PRIVATE** — Keep this document safe. It contains login details.

---

## 1. Open the app

ArkaTasks is your online cleaning schedule. Use it on a phone or computer — no install needed.

| What | Details |
|------|---------|
| **Website address** | https://dclean-arkatasks.pages.dev |
| **App name** | ArkaTasks |
| **Company** | DClean |
| **Best browsers** | Chrome, Safari, or Edge |

- Open the website address above on your phone or laptop.
- On a phone: open the browser menu → **Add to Home Screen** for a quick icon.

---

## 2. Sign in (once per device)

| Item | Value |
|------|--------|
| **Username** | `admin` (or whatever was set — see Supabase below) |
| **Password** | `admin` (or whatever was set — see Supabase below) |

- You only need to sign in once on each phone or computer. The app remembers you.
- On a shared computer, tap **Sign out** in the menu when you finish.
- When you open **Settings**, the app asks for the password again every time.
- On the login screen you can tap **Change username** / **Change password** (needs the current password). Changes are saved to Supabase.

**If the client forgets the login (developer):**

1. Open [supabase.com](https://supabase.com) → your project.
2. **Table Editor** → table **`app_login`**.
3. Open the row `id = main` — columns **`username`** and **`password`** are stored in plain text so you can unlock the app.

---

## 3. First-day checklist (do this once)

1. **Step 1** — Open the website and sign in with **admin** / **admin**.
2. **Step 2** — Go to **Settings → Cloud sync** and confirm it says connected (your developer may already have set this up).
3. **Step 3** — Activate email backup once (see section 5 below).
4. **Step 4** — Use **Calendar** for daily work. Use **Apply default** only when you want to load your saved default schedule.

---

## 4. Keep phone and laptop in sync (Cloud)

Cloud sync means your places, employees, and jobs stay the same on every device. This uses a free online account called **Supabase** (you do not need to use it every day).

| Item | Write here / notes |
|------|--------------------|
| **Website** | https://supabase.com |
| **Project name** | ________________________________ |
| **Project URL** | ________________________________ |
| **Public API key** | ________________________________ |
| **Login** | Email & password of the Supabase account owner |

**If Cloud sync is not connected yet (one-time setup):**

1. Open supabase.com and sign in to your project.
2. Go to **Project Settings → API**.
3. Copy **Project URL** and the **anon public** key into the table above.
4. In ArkaTasks: **Settings → Cloud sync** → paste both → **Save & connect**.
5. Repeat on every phone/laptop that should share the same data.

> You can ask your developer to fill this section and connect the first device for you.

---

## 5. Daily full backup (reliable)

The **full** dataset is saved once per day into Supabase (not limited by email size).

| Item | Details |
|------|---------|
| **Full backup table** | Supabase → Table Editor → **`app_full_backups`** |
| **Live working data** | Supabase → **`app_state`** (row `main` → `payload`) |
| **How often** | About once per day when the app is opened |
| **Save / restore now** | Settings → Backup & recover → **Full cloud backups** |

**Worst case (data recovery):**

1. Settings → **Full cloud backups** → **Restore** (puts data back on the device and into live `app_state`), or **Download** the JSON file.
2. Or in Supabase: open a row in **`app_full_backups`**, copy **`payload`**, paste into **`app_state`** → **`payload`** for `id = main`, then open the app and sync.

**Optional email notice** to dcleanmilanoitalia@gmail.com may be summary-only if data is large — do not rely on email alone for full recovery.

**Advanced restore** (On this device / Cloud history) is password-locked in Settings — use only if needed. Prefer **Full cloud backups** for normal recovery.

### Device folder / phone storage (`DCleanArkaTasks`)

Browsers cannot create a Desktop folder by themselves. One-time setup on a laptop:

1. Create a folder on the **Desktop** named **`DCleanArkaTasks`**.
2. Open the app in **Chrome or Edge** → Settings → **Device folder backup** → **Link Desktop folder** → select that folder.
3. After that, each day the app is opened, a full JSON file (`dclean-full-backup-YYYY-MM-DD.json`) is written into that folder.

On **phones**, there is no Desktop folder API — the daily full copy downloads into the phone’s **Downloads / Files** storage instead. You can also tap **Save backup now** in Settings.

---

## 6. Where your data is kept (all free)

You do not need to manage these storage places day to day. This is only so you know nothing is “lost” in one place.

| Copy | Where it lives |
|------|----------------|
| **Working copy** | On each phone/computer (in the browser) |
| **Device snapshots** | Saved on that same device for quick restore |
| **Laptop Desktop folder** | **`DCleanArkaTasks`** (after one-time link in Settings) |
| **Phone file storage** | Downloads / Files (daily JSON download) |
| **Shared live copy** | Cloud (Supabase) **`app_state`** — shared across devices |
| **Full daily copies** | Cloud **`app_full_backups`** — disaster recovery |
| **Cloud history** | Older sync uploads you can restore from |
| **Email notice** | Gmail (optional; may be summary only) |

**To restore:** Settings → **Backup & recover** → choose a device snapshot, cloud history, or **Import JSON**.

---

## 7. Website hosting (for updates — usually developer)

The app website is hosted on **Cloudflare Pages** (free). You only need this if you publish a new version of the site.

| Item | Details |
|------|---------|
| **Dashboard** | https://dash.cloudflare.com |
| **Where to look** | Workers & Pages → **Pages** |
| **Project name** | dclean-arkatasks *(or as named in your account)* |
| **Login** | Cloudflare account email & password that owns the site |

> Updates are published by uploading the app’s `out` folder to that Pages project. Ask your developer for help with this.

---

## 8. Important reminders

- This app is for the owner / office. Free plans cover normal daily use.
- If you clear browser data on a phone or PC, that device’s local copy is removed. You can restore from Cloud, email, or **Backup & recover**.
- Do not post this sheet online or share it widely — it contains access details.

---

*Document date: 17 July 2026 · Prepared for DClean (client handoff)*

*Word file: `ArkaTask-Client-Access-Guide.docx` (print as 2 pages, A4).*
