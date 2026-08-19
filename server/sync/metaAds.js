// Meta Graph API version - bump if requests start failing with an unsupported-version
// error. Check https://developers.facebook.com/docs/graph-api/changelog for current.
const API_VERSION = 'v26.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

async function fetchAllPages(initialUrl) {
  const results = [];
  let url = initialUrl;

  while (url) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Meta Ads API error ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = await res.json();
    results.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return results;
}

async function fetchCampaignInsights(adAccountId, accessToken) {
  const url = new URL(`${BASE_URL}/act_${adAccountId}/insights`);
  url.searchParams.set('level', 'campaign');
  url.searchParams.set('date_preset', 'last_30d');
  // time_increment=1 makes Meta return one row per campaign per day instead of one
  // aggregated row for the whole date range - needed so the dashboard's date-range
  // picker can filter campaign spend accurately instead of only showing a fixed blob.
  url.searchParams.set('time_increment', '1');
  url.searchParams.set('fields', 'campaign_id,campaign_name,date_start,spend,clicks,actions');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);

  return fetchAllPages(url.toString());
}

// Campaigns themselves don't carry a brand - only the ads inside them (via which
// Page/Instagram account the ad creative promotes) do. Builds a campaign_id -> brand
// map by checking each ad's creative against the known page/IG IDs for each brand.
async function fetchCampaignBrandMap(adAccountId, accessToken, pageToBrand, igToBrand) {
  const url = new URL(`${BASE_URL}/act_${adAccountId}/ads`);
  url.searchParams.set('fields', 'campaign_id,creative{object_story_spec,actor_id,instagram_user_id}');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);

  const ads = await fetchAllPages(url.toString());
  const campaignBrand = new Map();

  for (const ad of ads) {
    if (campaignBrand.has(ad.campaign_id)) continue;

    const creative = ad.creative || {};
    const pageId = creative.object_story_spec?.page_id || creative.actor_id;
    const igId = creative.object_story_spec?.instagram_user_id || creative.instagram_user_id;
    const brand = (pageId && pageToBrand[pageId]) || (igId && igToBrand[igId]) || null;

    if (brand) campaignBrand.set(ad.campaign_id, brand);
  }

  return campaignBrand;
}

// Meta has no single "conversions" metric - it reports an `actions` array broken out
// by action type (lead, purchase, link_click, etc). Summing lead-related action types
// is a first-pass definition; adjust once real data shows what action types this
// account actually reports (this business is lead-gen focused, not e-commerce).
function mapCampaign(insight, brand) {
  const conversions = (insight.actions || [])
    .filter((a) => a.action_type && a.action_type.toLowerCase().includes('lead'))
    .reduce((sum, a) => sum + Number(a.value || 0), 0);

  return {
    externalId: insight.campaign_id,
    platform: 'meta',
    brand,
    name: insight.campaign_name,
    spend: Number(insight.spend || 0),
    clicks: Number(insight.clicks || 0),
    conversions: Math.round(conversions),
    date: insight.date_start
  };
}

module.exports = { fetchCampaignInsights, fetchCampaignBrandMap, mapCampaign };
