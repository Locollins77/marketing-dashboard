# Marketing Dashboard

Unified marketing dashboard + AI texting system. Pulls WhatConverts, Hatch, Google Ads,
Meta Ads, and LeadPerfection into one view of the customer journey (ad click → form →
CRM → call → text → conversion), then (Phase 2+) closes the loop with AI-drafted texts
logged back into LeadPerfection.

See `marketing-dashboard-project-brief.txt` (not committed — kept locally) for the full
architecture and phased build plan this repo follows.

## Status: Phase 1 in progress — WhatConverts connected, multi-brand

`server/seed.js` still seeds mock campaigns and leads (Google/Meta ad spend and their
leads are still mock, since those platforms aren't wired up yet). WhatConverts leads are
now real: `server/sync/whatconverts.js` pulls from the WhatConverts API and upserts into
the same `leads`/`journey_events` tables, and into `calls`/`texts` too when a lead is a
phone call or text message (WhatConverts returns real recordings/transcripts/message
bodies for those). Mock and real leads coexist in the same tables until Google Ads and
Meta Ads are wired up — re-run `npm run seed` if you want to clear mock leads out first.

**Multi-brand:** the business runs two brands (Rainbow Seamless Systems, Rainbow Bath
and Shower) with separate WhatConverts accounts, so every `leads`/`campaigns`/
`journey_events` row carries a `brand` column (`seamless` or `bathshower`). The sync
runs once per brand with that brand's own token/secret pair, and leads are de-duplicated
by `(source_platform, brand, external_id)` — not just `(source_platform, external_id)` —
since each brand's WhatConverts account issues its own `lead_id` numbering and the two
could otherwise collide. The Overview and Leads pages have a brand filter (defaults to
"All brands", persisted in the browser via `localStorage`). Before wiring up Google
Ads/Meta Ads, confirm whether each brand also has separate ad accounts — if so, those
sync jobs need to be per-brand from the start too, following this same pattern.

Sync runs automatically every 30 minutes (for any brand whose credentials are set), and
once on server startup. There's also a "Sync WhatConverts now" button on the Overview
page for on-demand testing, showing a per-brand fetched/added breakdown. Each sync pulls
the last 30 days of WhatConverts leads for every configured brand; re-running it is safe
since leads are de-duplicated as described above. `server/scripts/resetSyncedLeads.js
<platform> [brand]` clears synced data for one platform (optionally scoped to one brand)
so the next sync recreates it from scratch — useful after fixing a mapping bug.

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
- `campaigns` — id, platform, name, spend, clicks, conversions, date, brand
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
`WHATCONVERTS_BATHSHOWER_TOKEN`/`_SECRET` too if you want the real WhatConverts sync to
run locally — any brand whose pair is left blank is skipped (the server logs a message
and continues without syncing that brand).

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
   `WHATCONVERTS_SEAMLESS_TOKEN`/`_SECRET` + `WHATCONVERTS_BATHSHOWER_TOKEN`/`_SECRET`
   (one brand's pair can be added later — its sync just stays skipped until then).
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
    sync.js             manual sync trigger (POST /api/sync/whatconverts)
  sync/
    whatconverts.js     WhatConverts API client + lead mapping (credentials passed in per call)
    index.js             orchestrator: loops configured brands, fetch, upsert, de-dupe
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

1. Confirm whether Google Ads and Meta Ads also have separate per-brand accounts (likely,
   given the WhatConverts split) before wiring them up — determines whether those sync
   jobs need per-brand credentials from the start too.
2. Connect Google Ads and Meta Ads via scheduled sync jobs (campaigns table + their
   leads, tagged with `brand`), following the same pattern as `server/sync/whatconverts.js`.
3. Call LeadPerfection's `GetLeadSourceValidParameters` to get valid `businessID` /
   `promoterID` / `productsold` codes per brand (LeadPerfection's `businessID` is exactly
   the field for multi-brand Business Units), then wire the write path: new leads →
   `POST /api/Leads/AddProspect`.
4. Sync LeadPerfection's `GetProspectData` / `GetLead` back into the DB to reflect
   CRM status changes in the journey view.
5. Connect Hatch for call recordings/transcripts.
6. Phase 4: AI transcript analysis + AI-drafted texts, gated on LeadPerfection's DNC
   (`T` = Do Not Text) flag via `UpdateDNCStatus`, with STOP/opt-out handling before
   anything sends live (TCPA compliance).
