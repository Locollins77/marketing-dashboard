const BASE_URL = 'https://app.whatconverts.com/api/v1';
const LEADS_PER_PAGE = 500;

const EVENT_TYPE_MAP = {
  web_form: 'form_submit',
  phone_call: 'call',
  text_message: 'text',
  transaction: 'conversion'
};

function authHeader() {
  const token = process.env.WHATCONVERTS_API_TOKEN;
  const secret = process.env.WHATCONVERTS_API_SECRET;
  if (!token || !secret) {
    throw new Error('WHATCONVERTS_API_TOKEN and WHATCONVERTS_API_SECRET must be set');
  }
  return `Basic ${Buffer.from(`${token}:${secret}`).toString('base64')}`;
}

async function fetchLeadsPage(startDate, endDate, pageNumber) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    order: 'asc',
    leads_per_page: String(LEADS_PER_PAGE),
    page_number: String(pageNumber)
  });

  const res = await fetch(`${BASE_URL}/leads?${params.toString()}`, {
    headers: { Authorization: authHeader() }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WhatConverts API error ${res.status}: ${body.slice(0, 300)}`);
  }

  return res.json();
}

async function fetchAllLeads(startDate, endDate) {
  const allLeads = [];
  let pageNumber = 1;

  while (true) {
    const data = await fetchLeadsPage(startDate, endDate, pageNumber);
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

// WhatConverts' actual API returns lead_type as "Phone Call" / "Web Form" title-case
// strings, not the snake_case values ("phone_call") their docs describe - normalize
// before matching so the mapping below isn't silently skipped.
function normalizeLeadType(rawType) {
  return String(rawType || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function mapLead(lead) {
  const leadType = normalizeLeadType(lead.lead_type);

  return {
    externalId: String(lead.lead_id),
    sourcePlatform: 'whatconverts',
    sourceCampaign: lead.lead_campaign || lead.lead_source || lead.profile || null,
    contactName: lead.contact_name || 'Unknown',
    contactInfo: pickContactInfo(lead),
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
