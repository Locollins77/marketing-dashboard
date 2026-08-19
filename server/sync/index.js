const { pool } = require('../db');
const whatconverts = require('./whatconverts');
const googleAds = require('./googleAds');
const metaAds = require('./metaAds');
const leadPerfection = require('./leadPerfection');

const LOOKBACK_DAYS = 30;

const WHATCONVERTS_BRANDS = [
  { key: 'seamless', label: 'Rainbow Seamless Systems', tokenEnv: 'WHATCONVERTS_SEAMLESS_TOKEN', secretEnv: 'WHATCONVERTS_SEAMLESS_SECRET' },
  { key: 'bathshower', label: 'Rainbow Bath and Shower', tokenEnv: 'WHATCONVERTS_BATHSHOWER_TOKEN', secretEnv: 'WHATCONVERTS_BATHSHOWER_SECRET' }
];

const GOOGLE_ADS_BRANDS = [
  { key: 'seamless', label: 'Rainbow Seamless Systems', customerIdEnv: 'GOOGLE_ADS_SEAMLESS_CUSTOMER_ID' },
  { key: 'bathshower', label: 'Rainbow Bath and Shower', customerIdEnv: 'GOOGLE_ADS_BATHSHOWER_CUSTOMER_ID' }
];

const LEADPERFECTION_BRANDS = [
  { key: 'seamless', label: 'Rainbow Seamless Systems', businessIdEnv: 'LEADPERFECTION_SEAMLESS_BUSINESS_ID' },
  { key: 'bathshower', label: 'Rainbow Bath and Shower', businessIdEnv: 'LEADPERFECTION_BATHSHOWER_BUSINESS_ID' }
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

function getLeadPerfectionCredentials() {
  const { LEADPERFECTION_BASE_URL, LEADPERFECTION_USERNAME, LEADPERFECTION_PASSWORD, LEADPERFECTION_CLIENT_ID, LEADPERFECTION_APP_KEY } = process.env;
  if (!LEADPERFECTION_USERNAME || !LEADPERFECTION_PASSWORD || !LEADPERFECTION_CLIENT_ID || !LEADPERFECTION_APP_KEY) {
    return null;
  }
  return {
    baseUrl: LEADPERFECTION_BASE_URL || 'https://api.leadperfection.com',
    username: LEADPERFECTION_USERNAME,
    password: LEADPERFECTION_PASSWORD,
    clientId: LEADPERFECTION_CLIENT_ID,
    appKey: LEADPERFECTION_APP_KEY
  };
}

function hasLeadPerfectionCredentials() {
  return Boolean(getLeadPerfectionCredentials());
}

function splitContactName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Unknown', lastName: 'Unknown' };
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Unknown' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Pushes a newly-inserted lead into LeadPerfection via LeadAdd, so LeadPerfection
// becomes the system of record for every lead regardless of source. Requires
// LEADPERFECTION_* auth vars, a brn_id (Branch/Business Unit) for the lead's brand, and
// a default promoter/product code to all be configured - any missing piece just skips
// the push (logged) rather than failing the whole sync, same as other platforms'
// missing-credentials handling. Field names (brn_id/pro_id/productID) are confirmed
// against the real LeadAdd spec - see server/sync/leadPerfection.js's header comment.
async function pushLeadToLeadPerfection(mapped, leadId) {
  const credentials = getLeadPerfectionCredentials();
  if (!credentials) return;

  const brandConfig = LEADPERFECTION_BRANDS.find((b) => b.key === mapped.brand);
  const branchId = brandConfig && process.env[brandConfig.businessIdEnv];
  const promoterId = process.env.LEADPERFECTION_PROMOTER_ID;
  const productId = process.env.LEADPERFECTION_PRODUCT_ID;

  if (!branchId || !promoterId || !productId) {
    console.log(`[sync] leadperfection: brn_id/pro_id/productID not fully configured for brand "${mapped.brand}", skipping push for lead ${leadId}`);
    return false;
  }

  if (!mapped.phone) {
    console.log(`[sync] leadperfection: lead ${leadId} has no phone number, skipping push (LeadAdd requires one)`);
    return false;
  }

  const { firstName, lastName } = splitContactName(mapped.contactName);

  try {
    const result = await leadPerfection.leadAdd({
      firstname: firstName,
      lastname: lastName,
      phone: mapped.phone,
      email: mapped.email || undefined,
      brn_id: branchId,
      pro_id: promoterId,
      productID: productId,
      source: mapped.sourcePlatform,
      datereceived: mapped.createdAt ? mapped.createdAt.slice(0, 19).replace('T', ' ') : undefined
    }, credentials);

    // Response schema isn't documented (see leadPerfection.js header) - cst_id is the
    // system's own naming for this concept elsewhere in the API, so it's the most
    // likely field name, but casing/naming is unconfirmed until tested against real data.
    const prospectId = result && (result.cst_id || result.Cst_id || result.CustID || result.ProspectID || result.prospectId || result.prospect_id || result.ID || result.id);
    if (!prospectId) {
      console.log(`[sync] leadperfection: pushed lead ${leadId} but response had no recognizable prospect id - check the real response shape: ${JSON.stringify(result).slice(0, 300)}`);
      return false;
    }

    await pool.query('UPDATE leads SET lead_perfection_id = $1 WHERE id = $2', [String(prospectId), leadId]);
    console.log(`[sync] leadperfection: pushed lead ${leadId} -> prospect ${prospectId}`);
    return true;
  } catch (err) {
    console.error(`[sync] leadperfection: failed to push lead ${leadId}:`, err.message);
    return false;
  }
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
    return { inserted: false, lpPushed: false };
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

  const lpPushed = await pushLeadToLeadPerfection(mapped, leadId);

  return { inserted: true, lpPushed };
}

// Read path: for leads already pushed into LeadPerfection, poll GetLead to reflect CRM
// status changes back into our DB. Field names for the response are a best guess (see
// server/sync/leadPerfection.js) since the Swagger schema couldn't be fetched directly -
// this logs the raw response whenever it can't find a recognizable status field, so that
// can be calibrated against real data the same way WhatConverts' source mapping was.
async function runLeadPerfectionStatusSync() {
  const credentials = getLeadPerfectionCredentials();
  if (!credentials) {
    console.log('[sync] leadperfection: credentials not set, skipping status sync');
    return { platform: 'leadperfection', skipped: true, checked: 0, updated: 0 };
  }

  const { rows: leads } = await pool.query(
    `SELECT id, lead_perfection_id, status, brand FROM leads WHERE lead_perfection_id IS NOT NULL`
  );

  let updated = 0;

  for (const lead of leads) {
    try {
      const result = await leadPerfection.getLead({ prospectId: lead.lead_perfection_id }, credentials);
      const record = Array.isArray(result) ? result[0] : (result && (result.Leads || result.leads))?.[0] || result;
      const rawDisposition = record && (record.Disposition || record.disposition || record.Status || record.status);

      if (!rawDisposition) {
        console.log(`[sync] leadperfection: no recognizable disposition/status field for prospect ${lead.lead_perfection_id} - check field names against Swagger: ${JSON.stringify(result).slice(0, 300)}`);
        continue;
      }

      const mappedStatus = leadPerfection.normalizeStatus(rawDisposition);
      if (!mappedStatus) {
        console.log(`[sync] leadperfection: unmapped disposition "${rawDisposition}" for lead ${lead.id} (prospect ${lead.lead_perfection_id}) - leaving status as "${lead.status}"`);
        continue;
      }

      if (mappedStatus !== lead.status) {
        await pool.query('UPDATE leads SET status = $1 WHERE id = $2', [mappedStatus, lead.id]);
        await pool.query(
          'INSERT INTO journey_events (lead_id, event_type, timestamp, metadata, brand) VALUES ($1, $2, $3, $4, $5)',
          [lead.id, 'crm_status_change', new Date().toISOString(), JSON.stringify({ lead_perfection_id: lead.lead_perfection_id, new_status: mappedStatus, lp_disposition: rawDisposition, from: lead.status }), lead.brand]
        );
        updated += 1;
        console.log(`[sync] leadperfection: lead ${lead.id} status "${lead.status}" -> "${mappedStatus}" (disposition "${rawDisposition}")`);
      }
    } catch (err) {
      console.error(`[sync] leadperfection: failed to fetch status for lead ${lead.id} (prospect ${lead.lead_perfection_id}):`, err.message);
    }
  }

  console.log(`[sync] leadperfection: checked ${leads.length} leads, updated ${updated} statuses`);
  return { platform: 'leadperfection', skipped: false, checked: leads.length, updated };
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
  let lpPushed = 0;

  for (const raw of rawLeads) {
    const mapped = whatconverts.mapLead(raw, brandConfig.key);
    const result = await upsertMappedLead(mapped);
    if (result.inserted) inserted += 1;
    if (result.lpPushed) lpPushed += 1;
  }

  console.log(`[sync] whatconverts (${brandConfig.key}): fetched ${rawLeads.length}, inserted ${inserted}, skipped ${rawLeads.length - inserted}, pushed to leadperfection ${lpPushed}`);
  return { brand: brandConfig.key, skipped: false, fetched: rawLeads.length, inserted, lpPushed };
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
  hasMetaCredentials,
  runLeadPerfectionStatusSync,
  hasLeadPerfectionCredentials,
  LEADPERFECTION_BRANDS
};
