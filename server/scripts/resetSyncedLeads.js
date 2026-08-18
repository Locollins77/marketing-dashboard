require('dotenv').config();
const { pool } = require('../db');

const platform = process.argv[2];
const brand = process.argv[3];

if (!platform) {
  console.error('Usage: node server/scripts/resetSyncedLeads.js <source_platform> [brand]');
  console.error('Example: node server/scripts/resetSyncedLeads.js whatconverts bathshower');
  process.exit(1);
}

async function reset() {
  const where = brand ? 'source_platform = $1 AND brand = $2' : 'source_platform = $1';
  const params = brand ? [platform, brand] : [platform];

  await pool.query(`DELETE FROM journey_events WHERE lead_id IN (SELECT id FROM leads WHERE ${where})`, params);
  await pool.query(`DELETE FROM calls WHERE lead_id IN (SELECT id FROM leads WHERE ${where})`, params);
  await pool.query(`DELETE FROM texts WHERE lead_id IN (SELECT id FROM leads WHERE ${where})`, params);
  const { rowCount } = await pool.query(`DELETE FROM leads WHERE ${where}`, params);

  const scope = brand ? `source_platform "${platform}", brand "${brand}"` : `source_platform "${platform}"`;
  console.log(`Deleted ${rowCount} lead(s) for ${scope} and their journey_events/calls/texts.`);
  console.log('Next sync for this platform/brand will recreate them from scratch.');
  await pool.end();
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
