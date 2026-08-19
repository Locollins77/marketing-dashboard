# Marketing Dashboard

Unified marketing dashboard + AI texting system. Pulls WhatConverts, Hatch, Google Ads,
Meta Ads, and LeadPerfection into one view of the customer journey (ad click → form →
CRM → call → text → conversion), then (Phase 2+) closes the loop with AI-drafted texts
logged back into LeadPerfection.

See `marketing-dashboard-project-brief.txt` (not committed — kept locally) for the full
architecture and phased build plan this repo follows.

## Status: Phase 1 — WhatConverts + Google Ads + Meta Ads connected, multi-brand

`server/seed.js` still seeds mock leads (LeadPerfection isn't wired up yet, so those
mock leads stand in for CRM-driven data). Everything else is real:

- `server/sync/whatconverts.js` pulls leads from the WhatConverts API and upserts into
  `leads`/`journey_events`, and into `calls`/`texts` too when a lead is a phone call or
  text message (WhatConverts returns real recordings/transcripts/message bodies).
- `server/sync/googleAds.js` pulls campaign-level spend/clicks/conversions (last 30
  days, via GAQL) and upserts into `campaigns`.
- `server/sync/metaAds.js` pulls campaign-level spend/clicks/conversions (last 30 days)
  and upserts into `campaigns` too. Unlike the other two platforms, both brands share
  **one** Meta ad account — there's no per-brand credential split, so brand is instead
  inferred per-campaign by checking which Facebook Page/Instagram account that
  campaign's ads actually promote (`fetchCampaignBrandMap` in `metaAds.js`), matched
  against `META_PAGE_*_ID`/`META_IG_*_ID`. Campaigns whose ads don't match either
  brand's Page/IG (e.g. new/draft campaigns) are skipped and counted as `unattributed`
  in the sync summary rather than guessed at. Meta also has no single "conversions"
  metric like Google Ads — it reports an `actions` array broken out by type, and we
  currently sum anything with "lead" in the action type as a first-pass definition;
  this may need recalibrating once real data shows what action types this account uses.

Mock and real data coexist in the same tables — re-run `npm run seed` if you want to
clear mock leads out first (campaigns don't need this since real ones are inserted
directly with no mock campaign seed data left to clear).

**WhatConverts is call-tracking/attribution, not a lead source.** Early on this repo
treated `whatconverts` as if it were a platform bucket alongside `google`/`meta` — that
was wrong. WhatConverts' job is telling us which *real* channel each lead came from
(including phone calls Google/Meta's own reporting can't see), via its `lead_source`/
`lead_medium` fields. So `leads.source_platform` now holds the true attributed channel
(`google`, `meta`, `organic`, `direct`, `referral`, or whatever else WhatConverts
reports) computed by `normalizeSourcePlatform()` in `server/sync/whatconverts.js` —
"whatconverts" itself never appears there, only as the sync-tool label in page
subtitles/button text. Because that channel is a *derived* value that can be
recalibrated as we see more real data, it can't also be the stable key used to prevent
duplicate leads on re-sync — so leads have a separate `sync_source` column (always
`'whatconverts'` for now) that dedup is keyed on instead, while `source_platform` gets
refreshed to the latest mapping logic on every sync. The "unrecognized source/medium"
log line in `runWhatConvertsSync` output flags any `lead_source`/`lead_medium`
combination the mapping doesn't yet handle, for calibration.

**Multi-brand:** the business runs two brands (Rainbow Seamless Systems, Rainbow Bath
and Shower). WhatConverts and Google Ads each have separate per-brand accounts (Google
Ads' two accounts both sit under one Manager/MCC); Meta Ads has one shared account
attributed by Page/Instagram as described above. Every `leads`/`campaigns`/
`journey_events` row carries a `brand` column (`seamless` or `bathshower`). Leads are
de-duplicated by `(sync_source, brand, external_id)`; campaigns by `(platform, brand,
external_id, date)` — see below for why campaigns also key on date. Campaigns
(Google/Meta) are *updated* on each sync (current totals for that day), not
re-inserted; WhatConverts leads are immutable once created, so those are inserted once
and only their `source_platform`/`source_campaign` get refreshed on repeat syncs. The
Overview and Leads pages have a brand filter (defaults to "All brands", persisted in
the browser via `localStorage`).

**Date range picker:** Overview and Leads both have a date-range filter (Today, Last 7
Days, Last 30 Days [default], This Month, Last Month, Custom Range — `renderDateRangeFilter`
in `nav.js`, persisted via `localStorage` alongside the brand filter) that combines with
the brand filter on every request. This is why campaigns are stored **one row per
campaign per day** rather than one rolling 30-day total per campaign — Google Ads'
`googleAds.js` now includes `segments.date` in its GAQL query and Meta's `metaAds.js`
uses `time_increment=1`, so every sync pulls a full daily breakdown instead of one
aggregate blob, and the Overview API can filter/sum campaigns by whatever date range is
selected. The Overview's "Spend & conversions by platform" table is a blended view (see
`server/routes/overview.js`) — a `FULL OUTER JOIN` of ad spend (from `campaigns`,
grouped by `platform`) with lead counts (from `leads`, grouped by the true
`source_platform`), so every real channel shows up with spend where ad data exists and
"—" where it doesn't (organic/direct/referral).

Sync runs automatically every 30 minutes (for any platform/brand whose credentials are
set), and once on server startup. There are also "Sync WhatConverts now" / "Sync Google
Ads now" / "Sync Meta Ads now" buttons on the Overview page for on-demand testing, each
showing a per-brand breakdown. `server/scripts/resetSyncedLeads.js <platform> [brand]`
clears synced leads for one platform (optionally scoped to one brand) so the next sync
recreates them from scratch — useful after fixing a mapping bug (campaigns don't need
this since they're updated in place rather than accumulating duplicates).

**Operational note:** Meta's `META_ACCESS_TOKEN` is a long-lived user token (~60 days)
generated manually via OAuth Playground/Graph API Explorer — unlike Google's refresh
token, it does not auto-renew. It'll need to be regenerated roughly every two months
(same process as the initial setup) or the Meta sync will start failing with an
auth error.

## Stack

- **Backend:** Node.js + Express
- **DB:** PostgreSQL (`pg`) — Render's filesystem is ephemeral and resets on every
  deploy, so SQLite can't be used there; Postgres is the DB in both local dev and prod
- **Sessions:** stored in Postgres too (`connect-pg-simple`), so logins survive restarts/redeploys
- **Frontend:** Plain HTML/CSS/JS served as static files by Express
- **Auth:** Single internal user, session cookie (`express-session`), password hashed with bcrypt
- **Hosting:** Render, auto-deploying on push to this repo, with a Render managed Postgres instance

## Data model

- `leads` — id, source_platform (true channel: google/meta/organic/direct/etc, NOT "whatconverts"), source_campaign, contact_info, created_at, lead_perfection_id, status, external_id, brand, sync_source (stable dedup identity, e.g. 'whatconverts' — unique together with brand + external_id)
- `campaigns` — id, platform, name, spend, clicks, conversions, date (one row per campaign per day), brand, external_id (unique per platform + brand + external_id + date, used to update in place on re-sync)
- `calls` — id, lead_id, call_recording_url, transcript, duration, call_date
- `texts` — id, lead_id, direction, message, sent_at, ai_generated
- `journey_events` — id, lead_id, event_type, timestamp, metadata (JSON), brand

`calls`/`texts` don't carry their own `brand` — it's derived through `lead_id`.

## Setup

Requires Node.js (LTS), npm, and a Postgres database to connect to (a local Postgres
install, or the "External Database URL" from a Render Postgres instance both work fine
for development).

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_USERNAME`, and
`ADMIN_PASSWORD` to your own values. Set the `WHATCONVERTS_*`, `GOOGLE_ADS_*`, and
`META_*` vars too if you want those real syncs to run locally — any platform/brand
whose credentials are left blank is skipped (the server logs a message and continues
without syncing that one).

```bash
npm run seed
npm run dev
```

Visit `http://localhost:3000` and sign in with the admin credentials from `.env`.

## Deploying on Render

1. In the Render dashboard, add a **Postgres** instance (free tier is fine for this
   volume). Copy its **Internal Database URL**.
2. On the web service for this repo, set environment variables: `DATABASE_URL` (the
   internal URL from step 1), `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and
   the `WHATCONVERTS_*`, `GOOGLE_ADS_*`, and `META_*` vars from `.env.example` (any
   platform/brand's credentials can be added later — that sync just stays skipped
   until then).
3. Build command: `npm install`. Start command: `npm start`.
4. After the first deploy succeeds, run `npm run seed` once (Render's Shell tab, or a
   one-off job) to create the admin user and mock data against the new database.

## Project structure

```
server/
  index.js            Express app entrypoint, session + static + route wiring
  db.js               Postgres pool + schema (server/db.js)
  seed.js             Mock data generator (npm run seed)
  asyncHandler.js     wraps async route handlers so rejected promises reach the error handler
  routes/
    auth.js           login / logout / session
    overview.js        spend, leads, conversions by source
    leads.js           lead list + full journey detail
    sync.js             manual sync triggers (POST /api/sync/{whatconverts,google-ads,meta-ads})
  sync/
    whatconverts.js     WhatConverts API client + lead mapping, incl. true-channel attribution (credentials passed in per call)
    googleAds.js         Google Ads REST/GAQL client (token refresh + campaign query)
    metaAds.js            Meta Graph API client (campaign insights + Page/IG brand attribution)
    index.js             orchestrator: loops configured brands per platform, fetch, upsert
  scripts/
    resetSyncedLeads.js  clears synced leads for a platform/brand to force a clean re-sync
  middleware/
    requireAuth.js     gates /api/* and page routes behind session login
public/
  login.html, index.html (Overview), leads.html, lead-detail.html
  css/style.css
  js/                 one file per page, plus shared nav.js
```

## Next steps (Phase 1+)

1. Call LeadPerfection's `GetLeadSourceValidParameters` to get valid `businessID` /
   `promoterID` / `productsold` codes per brand (LeadPerfection's `businessID` is exactly
   the field for multi-brand Business Units), then wire the write path: new leads →
   `POST /api/Leads/AddProspect`.
2. Sync LeadPerfection's `GetProspectData` / `GetLead` back into the DB to reflect
   CRM status changes in the journey view.
3. Connect Hatch for call recordings/transcripts.
4. Phase 4: AI transcript analysis + AI-drafted texts, gated on LeadPerfection's DNC
   (`T` = Do Not Text) flag via `UpdateDNCStatus`, with STOP/opt-out handling before
   anything sends live (TCPA compliance).
