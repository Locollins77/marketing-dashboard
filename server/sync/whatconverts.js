const BASE_URL = 'https://app.whatconverts.com/api/v1';
const LEADS_PER_PAGE = 500;

const EVENT_TYPE_MAP = {
  web_form: 'form_submit',
  phone_call: 'call',
  text_message: 'text',
  transaction: 'conversion'
};

function authHeader(credentials) {
  const { token, secret } = credentials;
  return `Basic ${Buffer.from(`${token}:${secret}`).toString('base64')}`;
}

async function fetchLeadsPage(startDate, endDate, pageNumber, credentials) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    order: 'asc',
    leads_per_page: String(LEADS_PER_PAGE),
    page_number: String(pageNumber)
  });

  const res = await fetch(`${BASE_URL}/leads?${params.toString()}`, {
    headers: { Authorization: authHeader(credentials) }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WhatConverts API error ${res.status}: ${body.slice(0, 300)}`);
  }

  return res.json();
}

async function fetchAllLeads(startDate, endDate, credentials) {
  const allLeads = [];
  let pageNumber = 1;

  while (true) {
    const data = await fetchLeadsPage(startDate, endDate, pageNumber, credentials);
    const leads = data.leads || [];
    allLeads.push(...leads);
    if (leads.length < LEADS_PER_PAGE) break;
    pageNumber += 1;
  }

  return allLeads;
}

function pickContactInfo(lead) {
  return lead.contact_phone_number || lead.phone_number
    || lead.contact_email_address || lead.email_address
    || 'unknown';
}

function pickPhone(lead) {
  return lead.contact_phone_number || lead.phone_number || null;
}

function pickEmail(lead) {
  return lead.contact_email_address || lead.email_address || null;
}

// WhatConverts' actual API returns lead_type as "Phone Call" / "Web Form" title-case
// strings, not the snake_case values ("phone_call") their docs describe - normalize
// before matching so the mapping below isn't silently skipped.
function normalizeLeadType(rawType) {
  return String(rawType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

// WhatConverts is a call-tracking/attribution tool, not a lead source itself - every
// lead needs to be tagged with the TRUE channel it came from (google/meta/organic/
// direct/etc), derived from WhatConverts' own lead_source + lead_medium fields,
// rather than labeled "whatconverts". lead_source is typically the network/domain
// (google, bing, facebook, direct) and lead_medium the channel type (cpc, organic,
// referral) - e.g. source=google+medium=organic is an organic Google lead, not paid.
// This mapping is a first pass; unmatched values fall through to 'other' and get
// logged so it can be calibrated against real data.
function normalizeSourcePlatform(rawSource, rawMedium) {
  const source = String(rawSource || '').toLowerCase().trim();
  const medium = String(rawMedium || '').toLowerCase().trim();

  if (!source || source === 'direct' || source === '(direct)') return 'direct';

  const isOrganic = medium.includes('organic') || medium.includes('social');
  const isReferral = medium.includes('referral');

  if (source.includes('google')) return isOrganic ? 'organic' : 'google';
  if (source.includes('facebook') || source.includes('instagram') || source.includes('meta') || source.includes('fb')) {
    return isOrganic ? 'organic' : 'meta';
  }
  if (isOrganic) return 'organic';
  if (isReferral) return 'referral';

  return source || 'other';
}

const KNOWN_SOURCE_PLATFORMS = new Set(['direct', 'organic', 'referral', 'google', 'meta']);

function mapLead(lead, brand) {
  const leadType = normalizeLeadType(lead.lead_type);
  const sourcePlatform = normalizeSourcePlatform(lead.lead_source, lead.lead_medium);

  if (!KNOWN_SOURCE_PLATFORMS.has(sourcePlatform)) {
    console.log(`[sync] whatconverts: unmapped source/medium "${lead.lead_source}" / "${lead.lead_medium}" -> "${sourcePlatform}" (lead ${lead.lead_id})`);
  }

  return {
    externalId: String(lead.lead_id),
    syncSource: 'whatconverts',
    sourcePlatform,
    brand,
    sourceCampaign: lead.lead_campaign || null,
    contactName: lead.contact_name || 'Unknown',
    contactInfo: pickContactInfo(lead),
    phone: pickPhone(lead),
    email: pickEmail(lead),
    createdAt: lead.date_created,
    eventType: EVENT_TYPE_MAP[leadType] || leadType || 'other',
    eventMetadata: {
      platform: 'whatconverts',
      lead_type: lead.lead_type,
      source: lead.lead_source,
      medium: lead.lead_medium,
      campaign: lead.lead_campaign,
      keyword: lead.lead_keyword
    },
    call: leadType === 'phone_call' ? {
      recordingUrl: lead.recording || lead.play_recording || null,
      transcript: lead.call_transcription || null,
      duration: lead.call_duration_seconds != null ? Number(lead.call_duration_seconds) : null,
      callDate: lead.date_created
    } : null,
    text: leadType === 'text_message' ? {
      direction: 'in',
      message: lead.message || '',
      sentAt: lead.date_created
    } : null
  };
}

module.exports = { fetchAllLeads, mapLead };
