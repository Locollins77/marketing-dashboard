// Run this once real LEADPERFECTION_* credentials are set in .env, BEFORE wiring up
// AddProspect for real: it prints the valid businessID/promoterID/disposition/product
// codes for this LeadPerfection account, which are needed to configure
// LEADPERFECTION_SEAMLESS_BUSINESS_ID / LEADPERFECTION_BATHSHOWER_BUSINESS_ID /
// LEADPERFECTION_PROMOTER_ID / LEADPERFECTION_PRODUCT_ID correctly.
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
  const types = ['SubSource', 'Promoter', 'Disposition', 'Products'];

  for (const type of types) {
    console.log(`\n=== ${type} ===`);
    try {
      const result = await leadPerfection.getLeadSourceValidParameters(type, credentials);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`Failed to fetch ${type}:`, err.message);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
