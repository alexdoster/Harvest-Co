# Harvest & Co Scheduling App

## Project Overview

A portfolio demo scheduling app built with Google Apps Script and vanilla JS. It manages the workflow of sending field chefs to grocery stores to run live produce demos across multiple regional distribution centers.

This is a standalone portfolio piece, separate from any production Row 7 Seeds files. It lives in its own Google Sheet and its own bound Apps Script project, confirmed separate as of 2026-06-20 (see Apps Script Project below).

## Files

| File | Purpose |
|---|---|
| `Code.gs` | Server-side Apps Script. Reads/writes Google Sheets, handles auth, returns data to the frontend. |
| `Index.html` | Single-file frontend. All HTML, CSS, and JS in one file as required by Apps Script. |
| `appsscript.json` | Project manifest (timezone, web app access, V8 runtime). Mirrors the live manifest as of 2026-06-20. |
| `.clasp.json` | Points clasp at the live Apps Script project. Not pushed to Apps Script itself. |

## Google Sheet

**Sheet name:** Harvest & Co Data
**Sheet ID:** `1W9vwgk2Dji6CpZezud4XjyIRSH1r0rTaTHQLlbIYDJs`

**Tabs:**

| Tab | Purpose |
|---|---|
| `FACT_Schedule` | All demo bookings. Schedule_ID starts at 306, runs through ~2572. |
| `DIM_Chef` | Chef roster. IDs C001 through C030. No Lani Kingston records. |
| `DIM_Product` | Product catalog with active date ranges. |
| `DIM_Store` | Store locations across all DCs. ~529 active stores. |
| `DIM_Admin` | Operator access list. Only Alex Doster (alex80ad@gmail.com). |

## Apps Script Project

- **Display name in script.google.com/home:** "Scheduling Demo"
- **Script ID:** `19d-snr0pu2Um6gy8v46-xopgbMOPg4-wArdQ0DMhAp2cgnrIWFBZvOdP`
- **Owning account:** alex80ad@gmail.com
- Confirmed clean of Row 7 references in both `Code.gs` and `Index.html` (verified 2026-06-20).
- A separate script also exists in this account named "Portfolio Schedulin..." (Script ID `18Dl-2DEvaarD45S0xmmNucGJYbl5NmsbVrMbTvJ9J8-PwR_WtIApGFdi`) that still contains live Row 7 production code. **Never push, pull, or deploy against this ID.** It is unrelated to Harvest & Co despite the similar name.

## Local Tooling (clasp)

This project syncs to Apps Script via [clasp](https://github.com/google/clasp) instead of manual copy-paste into the online editor.

**One-time setup (already done as of 2026-06-20):**
- `npm install -g @google/clasp`
- `clasp login` (authenticated as alex80ad@gmail.com)
- Apps Script API enabled at script.google.com/home/usersettings (required for `clasp push`/`deploy` — without it you get an "API not enabled" error)
- `.clasp.json` in this folder points to the Script ID above

**Day-to-day workflow:**
- `clasp push` — sends local `Code.gs`, `Index.html`, `appsscript.json` to the project's HEAD. Does **not** change what the live `/exec` URL shows.
- `clasp deploy -i <deploymentId> -d "description"` — creates a new version from HEAD and points an *existing* deployment at it. This is what actually updates the live URL, and it keeps the URL unchanged.
- `clasp deployments` — lists all deployments with their IDs and current version.

**No git repo in this folder yet.** Version history currently only exists as Apps Script's own version snapshots (visible via `clasp deployments`) plus whatever Google Drive's file versioning captures. Consider adding git here if change tracking becomes important — see the Portfolio project for an example already in use.

## Architecture

- **Auth:** Bound to Google account via `Session.getActiveUser()`. In this portfolio version, auth is bypassed entirely by a demo intro modal that sets `STATE.user` directly in the browser.
- **Data flow:** All reads/writes go through `google.script.run` calls from the frontend to `Code.gs`. No external APIs.
- **Date handling:** Sheets stores dates as midnight UTC Date objects. All date normalization uses UTC components to avoid timezone shift. Time values are stored as day fractions (e.g. 0.4167 = 10:00 AM).
- **Soft deletes:** `deleteScheduleEntry()` sets `Status = 'Deleted'` rather than removing rows. Deleted rows are filtered from all views.

## Demo Mode

The app runs in demo mode for portfolio visitors. Key behaviors:

- Intro modal appears on every page load (no localStorage persistence, intentional for demos)
- "View as Operator" sets `STATE.user.role = 'operator'`
- "View as Chef" sets `STATE.user` to Jordan Patel (C001, Austin)
- `STATE.demoMode = true` blocks all write operations with a toast message
- Write guards are in place on: `submitEntry`, `saveDetailChanges`, `setGroupStatus`, `confirmDelete`, `saveChefProfile`, `submitDim`
- Topbar shows "🔵 Demo Mode" instead of the user email
- A "Switch View" button in the topbar (`exitDemoView()`, added 2026-06-20) resets `STATE` and re-shows the intro modal, so visitors can move between Operator and Chef view without reloading the page. Only visible when `STATE.demoMode` is true.

## Company / Branding

- **Company name:** Harvest & Co
- **Fictional context:** Specialty produce company, chef demo program at grocery stores
- **Chef emails:** `@harvestandco.com`
- **Admin contact:** alex80ad@gmail.com
- **No Row 7 Seeds references anywhere** in this codebase

## DC Structure

Ten regional distribution centers: Austin, Cheshire, Chicago, Denver, Florida, Lacey, Landover, Richmond, South, Vernon.

Chefs are assigned to a home DC. The original data (C001 through C006) covers Austin and Cheshire but was also used for Chicago, Landover, and Lacey in the schedule data.

## Known Constraints

- Apps Script response size limit: `getDimData()` returns slim store objects (11 fields) to avoid silently dropping the callback on large payloads.
- `sheet.getLastRow()` is unreliable when ArrayFormulas exist in the sheet. `createScheduleEntries()` walks column A manually to find the last data row.
- All new schedule entries use `T12:00:00` noon time when constructing Date objects to prevent date shifting across US timezones.

## Deployment

Deployed as a Google Apps Script Web App from the bound script of the Harvest & Co sheet.

**Live portfolio deployment ID:** `AKfycbzv01l43AWSv-6Bem6kCRzfolOp7W4i-NZrgeUUoTlgdUzATZLs7TPBi-wr0KomWSO2nQ`
URL: `https://script.google.com/macros/s/AKfycbzv01l43AWSv-6Bem6kCRzfolOp7W4i-NZrgeUUoTlgdUzATZLs7TPBi-wr0KomWSO2nQ/exec`

To ship a change to the live URL: `clasp push` then `clasp deploy -i AKfycbzv01l43AWSv-6Bem6kCRzfolOp7W4i-NZrgeUUoTlgdUzATZLs7TPBi-wr0KomWSO2nQ -d "description"`. This updates the existing deployment to a new version and **keeps the URL stable** — it does not create a new URL.

Two other deployments exist on this same script and are not the live portfolio URL: an `@HEAD` test deployment, and one labeled "Portfolio Build" (`AKfycbwxfjs5wWpAgtENwsX4pg535WWRrQI_PCw4RFrdtLouRLH99wIHVJ91i3Oe9RbT9eVk4g`). Leave both alone unless intentionally working with them.

**Do not push, pull, or deploy against the separate Row 7 production script** (`18Dl-2DEvaarD45S0xmmNucGJYbl5NmsbVrMbTvJ9J8-PwR_WtIApGFdi`, see Apps Script Project above).
