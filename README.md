# Marketing Dashboard

Unified marketing dashboard + AI texting system. Pulls WhatConverts, Hatch, Google Ads,
Meta Ads, and LeadPerfection into one view of the customer journey (ad click → form →
CRM → call → text → conversion), then (Phase 2+) closes the loop with AI-drafted texts
logged back into LeadPerfection.

See `marketing-dashboard-project-brief.txt` (not committed — kept locally) for the full
architecture and phased build plan this repo follows.

## Status: Phase 1 in progress — WhatConverts + Google Ads connected, multi-brand

`server/seed.js` still seeds mock leads and Meta campaigns (Meta Ads isn't wired up
yet — the business runs both brands through one shared Meta Ads account but separate
Facebook/Instagram pages, which needs its own attribution approach when it's built).
WhatConverts leads and Google Ads campaign spend are both real now:

- `server/sync/whatconverts.js` pulls leads from the WhatConverts API and upserts into
  `leads`/`journey_events`, and into `calls`/`texts` too when a lead is a phone call or
  text message (WhatConverts returns real recordings/transcripts/message bodies).
- `server/sync/googleAds.js` pulls campaign-level spend/clicks/conversions (last 30
  days, via GAQL) and upserts into `campaigns`.

Mock and real data coexist in the same tables until Meta Ads is wired up too — re-run
`npm run seed` if you want to clear mock leads/campaigns out first.

**Multi-brand:** the business runs two brands (Rainbow Seamless Systems, Rainbow Bath
and Shower) with separate WhatConverts accounts *and* separate Google Ads accounts
(both under one Google Ads Manager/MCC account), so every `leads`/`campaigns`/
`journey_events` row carries a `brand` column (`seamless` or `bathshower`). Both leads
and campaigns are de-duplicated by `(platform, brand, external_id)` rather than just
`(platform, external_id)`, since each brand's account issues its own ID numbering and
the two could otherwise collide. Google Ads campaigns are *updated* on each sync
(current totals), not re-inserted — WhatConverts leads are immutable once created, so
those are inserted once and skipped on repeat syncs. The Overview and Leads pages have
a brand filter (defaults to "All brands", persisted in the browser via `localStorage`).

Sync runs automatically every 30 minutes (for any brand whose credentials are set), and
once on server startup. There are also "Sync WhatConverts now" / "Sync Google Ads now"
buttons on the Overview page for on-demand testing, each showing a per-brand breakdown.
`server/scripts/resetSyncedLeads.js <platform> [brand]` clears synced leads for one
platform (optionally scoped to one brand) so the next sync recreates them from scratch
— useful after fixing a mapping bug (campaigns don't need this since they're updated
in place rather than accumulating duplicates).

## Stack

- **Backend:** Node.js + Express
- **DB:** PostgreSQL (`pg`) — Render's filesystem is ephemeral and resets on every
  deploy, so SQLite can't be used there; Postgres is the DB in both local dev and prod
- **Sessions:** stored in Postgres too (`connect-pg-simple`), so logins survive restarts/redeploys
- **Frontend:** Plain HTML/CSS/JS served as static files by Express
- **Auth:** Single internal user, session cookie (`express-session`), password hashed with bcrypt
- **Hosting:** Render, auto-deploying on push to this repo, with a Render managed Postgres instance

## Data model

- `leads` — id, source_platform, source_campaign, contact_info, created_at, lead_perfection_id, status, external_id, brand (unique per source_platform + brand, used to de-dupe synced leads)
- `campaigns` — id, platform, name, spend, clicks, conversions, date, brand, external_id (unique per platform + brand, used to update in place on re-sync)
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
`ADMIN_PASSWORD` to your own values. Set `WHATCONVERTS_SEAMLESS_TOKEN`/`_SECRET` and/or
`WHATCONVERTS_BATHSHOWER_TOKEN`/`_SECRET`, and the `GOOGLE_ADS_*` vars, too if you want
those real syncs to run locally — any brand whose credentials are left blank is skipped
(the server logs a message and continues without syncing that brand/platform).

```bash
npm run seed
npm run dev
```

Visit `http://localhost:3000` and sign in with the admin credentials from `.env`.

## Deploying on Render

1. In the Render dashboard, add a **Postgres** instance (free tier is fine for this
   volume). Copy its **Internal Database URL**.
2. On the web service for this repo, set environment variables: `DATABASE_URL` (the
   internal URL from step 1), `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
   `WHATCONVERTS_SEAMLESS_TOKEN`/`_SECRET` + `WHATCONVERTS_BATHSHOWER_TOKEN`/`_SECRET`,
   and the `GOOGLE_ADS_*` vars from `.env.example` (one brand's credentials can be added
   later — that sync just stays skipped until then).
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
    sync.js             manual sync triggers (POST /api/sync/whatconverts, /google-ads)
  sync/
    whatconverts.js     WhatConverts API client + lead mapping (credentials passed in per call)
    googleAds.js         Google Ads REST/GAQL client (token refresh + campaign query)
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

1. Connect Meta Ads. Confirmed structure: both brands share **one** Meta Ads account
   (unlike Google Ads' two separate accounts), but post through separate Facebook and
   Instagram pages per brand — so brand attribution has to come from which page/account
   an ad or lead-form submission belongs to, not from account-level credentials like
   WhatConverts/Google Ads. Work out that mapping before wiring up the sync.
2. Call LeadPerfection's `GetLeadSourceValidParameters` to get valid `businessID` /
   `promoterID` / `productsold` codes per brand (LeadPerfection's `businessID` is exactly
   the field for multi-brand Business Units), then wire the write path: new leads →
   `POST /api/Leads/AddProspect`.
3. Sync LeadPerfection's `GetProspectData` / `GetLead` back into the DB to reflect
   CRM status changes in the journey view.
4. Connect Hatch for call recordings/transcripts.
5. Phase 4: AI transcript analysis + AI-drafted texts, gated on LeadPerfection's DNC
   (`T` = Do Not Text) flag via `UpdateDNCStatus`, with STOP/opt-out handling before
   anything sends live (TCPA compliance).
