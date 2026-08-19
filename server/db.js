const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const isLocal = !connectionString || /localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      platform TEXT NOT NULL,
      name TEXT NOT NULL,
      spend REAL NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      brand TEXT,
      external_id TEXT
    );

    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      source_platform TEXT NOT NULL,
      source_campaign TEXT,
      contact_name TEXT NOT NULL,
      contact_info TEXT NOT NULL,
      created_at TEXT NOT NULL,
      lead_perfection_id TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      external_id TEXT,
      brand TEXT,
      sync_source TEXT
    );

    CREATE TABLE IF NOT EXISTS calls (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      call_recording_url TEXT,
      transcript TEXT,
      duration INTEGER,
      call_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS texts (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      direction TEXT NOT NULL,
      message TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      ai_generated INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS journey_events (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      metadata TEXT,
      brand TEXT
    );

    -- Migrations for databases created before these columns/indexes existed.
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_id TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS brand TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS sync_source TEXT;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS brand TEXT;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS external_id TEXT;
    ALTER TABLE journey_events ADD COLUMN IF NOT EXISTS brand TEXT;

    -- One-time backfill: leads synced before multi-brand support was added all came
    -- from the Rainbow Bath and Shower WhatConverts account. Only targets real
    -- synced leads (external_id set), not mock/seed rows.
    UPDATE leads SET brand = 'bathshower'
      WHERE source_platform = 'whatconverts' AND external_id IS NOT NULL AND brand IS NULL;

    UPDATE journey_events je SET brand = 'bathshower'
      FROM leads l
      WHERE je.lead_id = l.id AND l.source_platform = 'whatconverts'
        AND l.external_id IS NOT NULL AND je.brand IS NULL;

    -- One-time backfill: source_platform used to double as both the sync dedup key
    -- and the displayed lead channel. Splitting those apart - sync_source stays a
    -- stable 'whatconverts' identity for dedup, while source_platform becomes the
    -- true attributed channel (google/meta/organic/direct/etc), recomputed and kept
    -- fresh on every future sync. All real leads synced so far came via WhatConverts.
    UPDATE leads SET sync_source = 'whatconverts'
      WHERE external_id IS NOT NULL AND sync_source IS NULL;

    DROP INDEX IF EXISTS leads_source_external_idx;
    DROP INDEX IF EXISTS leads_source_brand_external_idx;

    CREATE UNIQUE INDEX IF NOT EXISTS leads_syncsource_brand_external_idx
      ON leads (sync_source, brand, external_id)
      WHERE external_id IS NOT NULL AND brand IS NOT NULL;

    -- Campaigns move from one rolling-30-day snapshot row per campaign to one row
    -- per campaign per day, so date-range filtering can be accurate. Old snapshot
    -- rows are the wrong shape for this (their 'date' was a full sync timestamp like
    -- '2026-08-18T14:23:11.123Z', not a plain day) and would double-count spend
    -- alongside fresh daily rows ('2026-08-18'), so clear them here. The date LIKE
    -- '%T%' check makes this self-limiting to a one-time cleanup: fresh daily rows
    -- never match it, so this becomes a no-op on every later boot rather than wiping
    -- freshly-synced data on every restart. Mock seed campaigns (external_id IS NULL)
    -- are left untouched either way.
    DELETE FROM campaigns WHERE external_id IS NOT NULL AND date LIKE '%T%';

    DROP INDEX IF EXISTS campaigns_platform_brand_external_idx;

    CREATE UNIQUE INDEX IF NOT EXISTS campaigns_platform_brand_external_date_idx
      ON campaigns (platform, brand, external_id, date)
      WHERE external_id IS NOT NULL AND brand IS NOT NULL;
  `);
}

module.exports = { pool, init };
