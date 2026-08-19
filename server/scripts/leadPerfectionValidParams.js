// Run this once real LEADPERFECTION_* credentials are set in .env, BEFORE wiring up
// LeadAdd for real: it prints the valid Branch (business unit) / Promoter / Product
// codes for this LeadPerfection account, needed to configure
// LEADPERFECTION_SEAMLESS_BUSINESS_ID / LEADPERFECTION_BATHSHOWER_BUSINESS_ID /
// LEADPERFECTION_PROMOTER_ID / LEADPERFECTION_PRODUCT_ID correctly. There is no
// 'Disposition' type on this endpoint - LeadPerfection's real API (confirmed against
// https://api.swaggerhub.com/apis/LeadPerfection/Examples/1.0/swagger.json) only
// exposes S/P/B/R here; disposition/status codes aren't discoverable this way and have
// to be calibrated from real GetLead responses instead (see the "unmapped disposition"
// log line in server/sync/index.js's runLeadPerfectionStatusSync).
//
// Usage: node server/scripts/leadPerfectionValidParams.js
require('dotenv').config();
const leadPerfection = require('../sync/leadPerfection');

function getCredentials() {
  const { LEADPERFECTION_BASE_URL, LEADPERFECTION_USERNAME, LEADPERFECTION_PASSWORD, LEADPERFECTION_CLIENT_ID, LEADPERFECTION_APP_KEY } = process.env;
  if (!LEADPERFECTION_USERNAME || !LEADPERFECTION_PASSWORD || !LEADPERFECTION_CLIENT_ID || !LEADPERFECTION_APP_KEY) {
    console.error('Missing one or more LEADPERFECTION_USERNAME / LEADPERFECTION_PASSWORD / LEADPERFECTION_CLIENT_ID / LEADPERFECTION_APP_KEY env vars.');
    process.exit(1);
  }
  return {
    baseUrl: LEADPERFECTION_BASE_URL || 'https://api.leadperfection.com',
    username: LEADPERFECTION_USERNAME,
    password: LEADPERFECTION_PASSWORD,
    clientId: LEADPERFECTION_CLIENT_ID,
    appKey: LEADPERFECTION_APP_KEY
  };
}

async function run() {
  const credentials = getCredentials();
  const types = [
    { code: 'S', label: 'SourceSub' },
    { code: 'P', label: 'Promoter' },
    { code: 'B', label: 'Branches (business units)' },
    { code: 'R', label: 'Products' }
  ];

  for (const type of types) {
    console.log(`\n=== ${type.label} (type=${type.code}) ===`);
    try {
      const result = await leadPerfection.getLeadsSourceSubPromoter(type.code, credentials);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`Failed to fetch ${type.label}:`, err.message);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
