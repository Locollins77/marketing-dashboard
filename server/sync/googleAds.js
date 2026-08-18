// Google Ads API version - Google sunsets old versions roughly yearly. If requests
// start failing with something like "API version no longer available", check
// https://developers.google.com/google-ads/api/docs/release-notes for the current
// version and bump this constant.
const API_VERSION = 'v25';
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

async function getAccessToken(credentials) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google OAuth token refresh error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.access_token;
}

const CAMPAIGN_QUERY = `
  SELECT campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.conversions
  FROM campaign
  WHERE segments.date DURING LAST_30_DAYS
    AND campaign.status != 'REMOVED'
`;

async function fetchCampaigns(customerId, credentials, accessToken) {
  const results = [];
  let pageToken = null;

  do {
    const res = await fetch(`${BASE_URL}/customers/${customerId}/googleAds:search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'developer-token': credentials.developerToken,
        'login-customer-id': credentials.loginCustomerId
      },
      body: JSON.stringify({
        query: CAMPAIGN_QUERY,
        pageToken: pageToken || undefined
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Google Ads API error ${res.status} (customer ${customerId}): ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    results.push(...(data.results || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return results;
}

function mapCampaign(result, brand, syncDate) {
  const costMicros = Number(result.metrics?.costMicros || 0);
  return {
    externalId: String(result.campaign.id),
    platform: 'google',
    brand,
    name: result.campaign.name,
    spend: costMicros / 1_000_000,
    clicks: Number(result.metrics?.clicks || 0),
    conversions: Math.round(Number(result.metrics?.conversions || 0)),
    date: syncDate
  };
}

module.exports = { getAccessToken, fetchCampaigns, mapCampaign };
