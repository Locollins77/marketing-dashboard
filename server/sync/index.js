const { pool } = require('../db');
const whatconverts = require('./whatconverts');

const LOOKBACK_DAYS = 30;

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
    `INSERT INTO leads (source_platform, source_campaign, contact_name, contact_info, created_at, status, external_id)
     VALUES ($1, $2, $3, $4, $5, 'new', $6)
     ON CONFLICT (source_platform, external_id) DO NOTHING
     RETURNING id`,
    [mapped.sourcePlatform, mapped.sourceCampaign, mapped.contactName, mapped.contactInfo, mapped.createdAt, mapped.externalId]
  );

  if (rows.length === 0) {
    return { inserted: false };
  }

  const leadId = rows[0].id;

  await pool.query(
    'INSERT INTO journey_events (lead_id, event_type, timestamp, metadata) VALUES ($1, $2, $3, $4)',
    [leadId, mapped.eventType, mapped.createdAt, JSON.stringify(mapped.eventMetadata)]
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

async function runWhatConvertsSync() {
  const startDate = daysAgoFormatted(LOOKBACK_DAYS);
  const endDate = formatWhatConvertsDate(new Date());

  const rawLeads = await whatconverts.fetchAllLeads(startDate, endDate);
  let inserted = 0;

  for (const raw of rawLeads) {
    const mapped = whatconverts.mapLead(raw);
    const result = await upsertMappedLead(mapped);
    if (result.inserted) inserted += 1;
  }

  const summary = { platform: 'whatconverts', fetched: rawLeads.length, inserted, skipped: rawLeads.length - inserted };
  console.log(`[sync] whatconverts: fetched ${summary.fetched}, inserted ${summary.inserted}, skipped ${summary.skipped}`);
  return summary;
}

module.exports = { runWhatConvertsSync };
