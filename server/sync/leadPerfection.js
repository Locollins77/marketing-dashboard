// LeadPerfection REST API client (Swagger/OpenAPI at training.leadperfection.com/swagger).
//
// IMPORTANT: the Swagger UI requires a logged-in LeadPerfection account and couldn't be
// fetched programmatically while writing this client, so most request field names below
// come from the project brief's summary of the docs rather than the raw OpenAPI schema.
// The `lastname`/`firstname`/`address1`/`city`/`state`/`zip`/`businessID`/`promoterID`/
// `productsold`/`csrid`/`appdate`/`apptime` names are quoted directly from that summary
// and are likely correct as-is. Phone field names (`phone1`/`phone2`/`phone3`) and the
// GetLead/GetProspectData query param names (`ProspectID`/`LeadID`/`IssuedLeadID`/
// `StartDate`/`EndDate`/`PageSize`/`StartIndex`/`Options`) are best-effort guesses -
// confirm against the live Swagger UI (log into training.leadperfection.com/swagger)
// before relying on this in production, and adjust the field names here if they differ.

let cachedToken = null; // { accessToken, expiresAt }

function baseUrl(credentials) {
  return credentials.baseUrl.replace(/\/$/, '');
}

async function fetchAccessToken(credentials) {
  const body = new URLSearchParams({
    Username: credentials.username,
    Password: credentials.password,
    ClientID: credentials.clientId,
    AppKey: credentials.appKey
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

// type: 'SubSource' | 'Promoter' | 'Disposition' | 'Products'
// Run this first (see server/scripts/leadPerfectionValidParams.js) to discover the
// valid businessID/promoterID/productsold values before calling addProspect for real.
async function getLeadSourceValidParameters(type, credentials) {
  return post('/api/Leads/GetLeadSourceValidParameters', { type }, credentials);
}

async function addProspect(fields, credentials) {
  return post('/api/Leads/AddProspect', fields, credentials);
}

// options bitwise flags are undocumented here - default omits it so LeadPerfection
// falls back to whatever its own default date-range criterion is (likely lead entry
// date). Pass startDate/endDate (YYYY-MM-DD) or prospectId to scope the query.
async function getLead(params, credentials) {
  return post('/api/Customers/GetLead', {
    ProspectID: params.prospectId,
    LeadID: params.leadId,
    IssuedLeadID: params.issuedLeadId,
    StartDate: params.startDate,
    EndDate: params.endDate,
    PageSize: params.pageSize,
    StartIndex: params.startIndex
  }, credentials);
}

// Our dashboard's lead.status vocabulary is a fixed small set (new/contacted/
// appointment/converted/lost - see public/css/style.css .badge.* rules and the
// "converted" filter in server/routes/overview.js), but LeadPerfection's Disposition
// values are account-specific free text we don't know yet (that's exactly what
// server/scripts/leadPerfectionValidParams.js's Disposition type-code is for). This is
// a first-pass best-guess substring mapping, same approach as
// normalizeSourcePlatform() in server/sync/whatconverts.js - unmapped values return
// null so the caller can log them and leave status unchanged rather than writing raw
// CRM text into a column other parts of the app assume is one of five known values.
function normalizeStatus(rawDisposition) {
  const d = String(rawDisposition || '').toLowerCase();
  if (!d) return null;
  if (d.includes('sold') || d.includes('sale') || d.includes('won') || d.includes('convert')) return 'converted';
  if (d.includes('lost') || d.includes('cancel') || d.includes('no sale') || d.includes('not interested') || d.includes('dead')) return 'lost';
  if (d.includes('appt') || d.includes('appointment') || d.includes('schedul') || d.includes('set')) return 'appointment';
  if (d.includes('contact') || d.includes('call')) return 'contacted';
  return null;
}

module.exports = { getAccessToken, getLeadSourceValidParameters, addProspect, getLead, normalizeStatus };
