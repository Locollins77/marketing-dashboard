const { pool } = require('../db');
const whatconverts = require('./whatconverts');
const googleAds = require('./googleAds');
const metaAds = require('./metaAds');

const LOOKBACK_DAYS = 30;

const WHATCONVERTS_BRANDS = [
  { key: 'seamless', label: 'Rainbow Seamless Systems', tokenEnv: 'WHATCONVERTS_SEAMLESS_TOKEN', secretEnv: 'WHATCONVERTS_SEAMLESS_SECRET' },
  { key: 'bathshower', label: 'Rainbow Bath and Shower', tokenEnv: 'WHATCONVERTS_BATHSHOWER_TOKEN', secretEnv: 'WHATCONVERTS_BATHSHOWER_SECRET' }
];

const GOOGLE_ADS_BRANDS = [
  { key: 'seamless', label: 'Rainbow Seamless Systems', customerIdEnv: 'GOOGLE_ADS_SEAMLESS_CUSTOMER_ID' },
  { key: 'bathshower', label: 'Rainbow Bath and Shower', customerIdEnv: 'GOOGLE_ADS_BATHSHOWER_CUSTOMER_ID' }
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
    `INSERT INTO leads (source_platform, source_campaign, contact_name, contact_info, created_at, status, external_id, brand, sync_source)
     VALUES ($1, $2, $3, $4, $5, 'new', $6, $7, $8)
     ON CONFLICT (sync_source, brand, external_id) WHERE external_id IS NOT NULL AND brand IS NOT NULL
     DO UPDATE SET source_platform = EXCLUDED.source_platform, source_campaign = EXCLUDED.source_campaign
     RETURNING id, (xmax = 0) AS inserted`,
    [mapped.sourcePlatform, mapped.sourceCampaign, mapped.contactName, mapped.contactInfo, mapped.createdAt, mapped.externalId, mapped.brand, mapped.syncSource]
  );

  if (!rows[0].inserted) {
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

function normalizeCustomerId(id) {
  return String(id).replace(/-/g, '');
}

function getGoogleAdsSharedCredentials() {
  const { GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID } = process.env;
  if (!GOOGLE_ADS_DEVELOPER_TOKEN || !GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET || !GOOGLE_ADS_REFRESH_TOKEN || !GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    return null;
  }
  return {
    developerToken: GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: GOOGLE_ADS_CLIENT_ID,
    clientSecret: GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: GOOGLE_ADS_REFRESH_TOKEN,
    loginCustomerId: normalizeCustomerId(GOOGLE_ADS_LOGIN_CUSTOMER_ID)
  };
}

async function upsertMappedCampaign(mapped) {
  const { rows } = await pool.query(
    `INSERT INTO campaigns (platform, name, spend, clicks, conversions, date, brand, external_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (platform, brand, external_id, date) WHERE external_id IS NOT NULL AND brand IS NOT NULL
     DO UPDATE SET name = EXCLUDED.name, spend = EXCLUDED.spend, clicks = EXCLUDED.clicks,
       conversions = EXCLUDED.conversions
     RETURNING (xmax = 0) AS inserted`,
    [mapped.platform, mapped.name, mapped.spend, mapped.clicks, mapped.conversions, mapped.date, mapped.brand, mapped.externalId]
  );
  return { inserted: rows[0].inserted };
}

async function syncGoogleAdsBrand(brandConfig, credentials, accessToken) {
  const customerId = process.env[brandConfig.customerIdEnv];
  if (!customerId) {
    console.log(`[sync] google_ads (${brandConfig.key}): customer ID not set, skipping`);
    return { brand: brandConfig.key, skipped: true, fetched: 0, inserted: 0, updated: 0 };
  }

  const rawCampaigns = await googleAds.fetchCampaigns(normalizeCustomerId(customerId), credentials, accessToken);
  let inserted = 0;
  let updated = 0;

  for (const raw of rawCampaigns) {
    const mapped = googleAds.mapCampaign(raw, brandConfig.key);
    const result = await upsertMappedCampaign(mapped);
    if (result.inserted) inserted += 1; else updated += 1;
  }

  console.log(`[sync] google_ads (${brandConfig.key}): fetched ${rawCampaigns.length}, inserted ${inserted}, updated ${updated}`);
  return { brand: brandConfig.key, skipped: false, fetched: rawCampaigns.length, inserted, updated };
}

async function runGoogleAdsSync() {
  const credentials = getGoogleAdsSharedCredentials();
  if (!credentials) {
    console.log('[sync] google_ads: credentials not fully set, skipping');
    return { platform: 'google_ads', fetched: 0, inserted: 0, updated: 0, brands: [] };
  }

  const accessToken = await googleAds.getAccessToken(credentials);

  const results = [];
  for (const brandConfig of GOOGLE_ADS_BRANDS) {
    results.push(await syncGoogleAdsBrand(brandConfig, credentials, accessToken));
  }

  const totals = results.reduce((acc, r) => ({
    fetched: acc.fetched + r.fetched,
    inserted: acc.inserted + r.inserted,
    updated: acc.updated + r.updated
  }), { fetched: 0, inserted: 0, updated: 0 });

  return { platform: 'google_ads', ...totals, brands: results };
}

function hasAnyGoogleAdsCredentials() {
  return Boolean(getGoogleAdsSharedCredentials()) && GOOGLE_ADS_BRANDS.some((b) => process.env[b.customerIdEnv]);
}

function getMetaCredentials() {
  const { META_ACCESS_TOKEN, META_AD_ACCOUNT_ID } = process.env;
  if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) {
    return null;
  }
  return {
    accessToken: META_ACCESS_TOKEN,
    adAccountId: META_AD_ACCOUNT_ID.replace(/^act_/, '')
  };
}

function getMetaBrandMaps() {
  const pageToBrand = {};
  const igToBrand = {};
  if (process.env.META_PAGE_SEAMLESS_ID) pageToBrand[process.env.META_PAGE_SEAMLESS_ID] = 'seamless';
  if (process.env.META_PAGE_BATHSHOWER_ID) pageToBrand[process.env.META_PAGE_BATHSHOWER_ID] = 'bathshower';
  if (process.env.META_IG_SEAMLESS_ID) igToBrand[process.env.META_IG_SEAMLESS_ID] = 'seamless';
  if (process.env.META_IG_BATHSHOWER_ID) igToBrand[process.env.META_IG_BATHSHOWER_ID] = 'bathshower';
  return { pageToBrand, igToBrand };
}

async function runMetaAdsSync() {
  const credentials = getMetaCredentials();
  if (!credentials) {
    console.log('[sync] meta_ads: credentials not set, skipping');
    return { platform: 'meta_ads', fetched: 0, inserted: 0, updated: 0, unattributed: 0, brands: [] };
  }

  const { pageToBrand, igToBrand } = getMetaBrandMaps();

  const [insights, campaignBrandMap] = await Promise.all([
    metaAds.fetchCampaignInsights(credentials.adAccountId, credentials.accessToken),
    metaAds.fetchCampaignBrandMap(credentials.adAccountId, credentials.accessToken, pageToBrand, igToBrand)
  ]);

  const perBrand = { seamless: { fetched: 0, inserted: 0, updated: 0 }, bathshower: { fetched: 0, inserted: 0, updated: 0 } };
  let unattributed = 0;

  for (const insight of insights) {
    const brand = campaignBrandMap.get(insight.campaign_id);
    if (!brand) {
      unattributed += 1;
      continue;
    }

    const mapped = metaAds.mapCampaign(insight, brand);
    const result = await upsertMappedCampaign(mapped);
    perBrand[brand].fetched += 1;
    if (result.inserted) perBrand[brand].inserted += 1; else perBrand[brand].updated += 1;
  }

  const brandsResult = Object.entries(perBrand).map(([key, v]) => ({ brand: key, skipped: false, ...v }));
  const totals = brandsResult.reduce((acc, r) => ({
    fetched: acc.fetched + r.fetched,
    inserted: acc.inserted + r.inserted,
    updated: acc.updated + r.updated
  }), { fetched: 0, inserted: 0, updated: 0 });

  console.log(`[sync] meta_ads: fetched ${insights.length} campaigns, attributed ${totals.fetched}, unattributed ${unattributed}`);
  return { platform: 'meta_ads', ...totals, unattributed, brands: brandsResult };
}

function hasMetaCredentials() {
  return Boolean(getMetaCredentials());
}

module.exports = {
  runWhatConvertsSync,
  hasAnyWhatConvertsCredentials,
  WHATCONVERTS_BRANDS,
  runGoogleAdsSync,
  hasAnyGoogleAdsCredentials,
  GOOGLE_ADS_BRANDS,
  runMetaAdsSync,
  hasMetaCredentials
};
