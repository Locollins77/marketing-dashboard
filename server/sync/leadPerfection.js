// LeadPerfection REST API client.
//
// Request parameter names below are confirmed against the real OpenAPI spec at
// https://api.swaggerhub.com/apis/LeadPerfection/Examples/1.0/swagger.json (the
// project brief's summary turned out to describe a different/older API surface -
// e.g. it referenced an AddProspect endpoint and GetLeadSourceValidParameters that
// don't exist in this spec at all; the real ones are LeadAdd and
// GetLeadsSourceSubPromoter). Response body schemas are NOT documented in that spec
// though, so response field names below (prospect id on lead-add, disposition/status
// on GetLead) are still best-effort guesses - both call sites log the raw response
// whenever they can't find a recognizable field, to calibrate against real data.

let cachedToken = null; // { accessToken, expiresAt }

function baseUrl(credentials) {
  return credentials.baseUrl.replace(/\/$/, '');
}

async function fetchAccessToken(credentials) {
  const body = new URLSearchParams({
    grant_type: 'password',
    username: credentials.username,
    password: credentials.password,
    clientid: credentials.clientId,
    appkey: credentials.appKey
  });

  const res = await fetch(`${baseUrl(credentials)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LeadPerfection auth error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const accessToken = data.access_token || data.accessToken;
  const expiresIn = Number(data.expires_in || data.expiresIn || 3600);

  if (!accessToken) {
    throw new Error(`LeadPerfection auth response had no access_token: ${JSON.stringify(data).slice(0, 300)}`);
  }

  return { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
}

async function getAccessToken(credentials, { forceRefresh = false } = {}) {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.accessToken;
  }
  cachedToken = await fetchAccessToken(credentials);
  return cachedToken.accessToken;
}

async function post(path, params, credentials, { retry = true } = {}) {
  const token = await getAccessToken(credentials);
  const body = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null))
  );

  const res = await fetch(`${baseUrl(credentials)}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${token}`
    },
    body
  });

  if (res.status === 401 && retry) {
    await getAccessToken(credentials, { forceRefresh: true });
    return post(path, params, credentials, { retry: false });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LeadPerfection API error ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

// type: 'S' (SourceSub) | 'P' (Promoter) | 'B' (Branches, i.e. Business Units) | 'R' (Products)
// Run this first (see server/scripts/leadPerfectionValidParams.js) to discover the
// valid brn_id/pro_id/productID values before calling leadAdd for real. Note there is
// no 'Disposition' type here - disposition/status codes aren't discoverable through
// this endpoint (they show up in appointment/job data instead), so normalizeStatus()
// below has to be calibrated from real GetLead responses rather than a lookup table.
async function getLeadsSourceSubPromoter(type, credentials) {
  return post('/api/Leads/GetLeadsSourceSubPromoter', { type }, credentials);
}

async function leadAdd(fields, credentials) {
  return post('/api/Leads/LeadAdd', fields, credentials);
}

// PageSize/StartIndex are marked required in the spec (defaults 10/1) even though
// they don't make much sense for "look up one specific prospect" - always sending them.
async function getLead(params, credentials) {
  return post('/api/Customers/GetLead', {
    cst_id: params.prospectId,
    lds_id: params.leadId,
    ils_id: params.issuedLeadId,
    startdate: params.startDate,
    enddate: params.endDate,
    PageSize: params.pageSize || 10,
    StartIndex: params.startIndex || 1
  }, credentials);
}

// Our dashboard's lead.status vocabulary is a fixed small set (new/contacted/
// appointment/converted/lost - see public/css/style.css .badge.* rules and the
// "converted" filter in server/routes/overview.js), but LeadPerfection's Disposition
// values are account-specific free text we don't know yet (there's no discovery
// endpoint for them - see getLeadsSourceSubPromoter above). This is a first-pass
// best-guess substring mapping, same approach as normalizeSourcePlatform() in
// server/sync/whatconverts.js - unmapped values return null so the caller can log
// them and leave status unchanged rather than writing raw CRM text into a column
// other parts of the app assume is one of five known values.
function normalizeStatus(rawDisposition) {
  const d = String(rawDisposition || '').toLowerCase();
  if (!d) return null;
  if (d.includes('sold') || d.includes('sale') || d.includes('won') || d.includes('convert')) return 'converted';
  if (d.includes('lost') || d.includes('cancel') || d.includes('no sale') || d.includes('not interested') || d.includes('dead')) return 'lost';
  if (d.includes('appt') || d.includes('appointment') || d.includes('schedul') || d.includes('set')) return 'appointment';
  if (d.includes('contact') || d.includes('call')) return 'contacted';
  return null;
}

module.exports = { getAccessToken, getLeadsSourceSubPromoter, leadAdd, getLead, normalizeStatus };
