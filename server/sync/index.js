const { pool } = require('../db');
const whatconverts = require('./whatconverts');

const LOOKBACK_DAYS = 30;

const WHATCONVERTS_BRANDS = [
  { key: 'seamless', label: 'Rainbow Seamless Systems', tokenEnv: 'WHATCONVERTS_SEAMLESS_TOKEN', secretEnv: 'WHATCONVERTS_SEAMLESS_SECRET' },
  { key: 'bathshower', label: 'Rainbow Bath and Shower', tokenEnv: 'WHATCONVERTS_BATHSHOWER_TOKEN', secretEnv: 'WHATCONVERTS_BATHSHOWER_SECRET' }
];

// WhatConverts rejects the milliseconds ISO precision Date#toISOString() produces
// (e.g. 2026-08-14T20:51:11.123Z); it wants no fractional seconds.
function formatWhatConvertsDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function daysAgoFormatted(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatWhatConvertsDate(d);
}

async function upsertMappedLead(mapped) {
  const { rows } = await pool.query(
    `INSERT INTO leads (source_platform, source_campaign, contact_name, contact_info, created_at, status, external_id, brand)
     VALUES ($1, $2, $3, $4, $5, 'new', $6, $7)
     ON CONFLICT (source_platform, brand, external_id) WHERE external_id IS NOT NULL AND brand IS NOT NULL DO NOTHING
     RETURNING id`,
    [mapped.sourcePlatform, mapped.sourceCampaign, mapped.contactName, mapped.contactInfo, mapped.createdAt, mapped.externalId, mapped.brand]
  );

  if (rows.length === 0) {
    return { inserted: false };
  }

  const leadId = rows[0].id;

  await pool.query(
    'INSERT INTO journey_events (lead_id, event_type, timestamp, metadata, brand) VALUES ($1, $2, $3, $4, $5)',
    [leadId, mapped.eventType, mapped.createdAt, JSON.stringify(mapped.eventMetadata), mapped.brand]
  );

  if (mapped.call) {
    await pool.query(
      'INSERT INTO calls (lead_id, call_recording_url, transcript, duration, call_date) VALUES ($1, $2, $3, $4, $5)',
      [leadId, mapped.call.recordingUrl, mapped.call.transcript, mapped.call.duration, mapped.call.callDate]
    );
  }

  if (mapped.text) {
    await pool.query(
      'INSERT INTO texts (lead_id, direction, message, sent_at, ai_generated) VALUES ($1, $2, $3, $4, 0)',
      [leadId, mapped.text.direction, mapped.text.message, mapped.text.sentAt]
    );
  }

  return { inserted: true };
}

async function syncWhatConvertsBrand(brandConfig, startDate, endDate) {
  const token = process.env[brandConfig.tokenEnv];
  const secret = process.env[brandConfig.secretEnv];

  if (!token || !secret) {
    console.log(`[sync] whatconverts (${brandConfig.key}): credentials not set, skipping`);
    return { brand: brandConfig.key, skipped: true, fetched: 0, inserted: 0 };
  }

  const rawLeads = await whatconverts.fetchAllLeads(startDate, endDate, { token, secret });
  let inserted = 0;

  for (const raw of rawLeads) {
    const mapped = whatconverts.mapLead(raw, brandConfig.key);
    const result = await upsertMappedLead(mapped);
    if (result.inserted) inserted += 1;
  }

  console.log(`[sync] whatconverts (${brandConfig.key}): fetched ${rawLeads.length}, inserted ${inserted}, skipped ${rawLeads.length - inserted}`);
  return { brand: brandConfig.key, skipped: false, fetched: rawLeads.length, inserted };
}

async function runWhatConvertsSync() {
  const startDate = daysAgoFormatted(LOOKBACK_DAYS);
  const endDate = formatWhatConvertsDate(new Date());

  const results = [];
  for (const brandConfig of WHATCONVERTS_BRANDS) {
    results.push(await syncWhatConvertsBrand(brandConfig, startDate, endDate));
  }

  const totals = results.reduce((acc, r) => ({
    fetched: acc.fetched + r.fetched,
    inserted: acc.inserted + r.inserted
  }), { fetched: 0, inserted: 0 });

  return {
    platform: 'whatconverts',
    fetched: totals.fetched,
    inserted: totals.inserted,
    skipped: totals.fetched - totals.inserted,
    brands: results
  };
}

function hasAnyWhatConvertsCredentials() {
  return WHATCONVERTS_BRANDS.some((b) => process.env[b.tokenEnv] && process.env[b.secretEnv]);
}

module.exports = { runWhatConvertsSync, hasAnyWhatConvertsCredentials, WHATCONVERTS_BRANDS };
