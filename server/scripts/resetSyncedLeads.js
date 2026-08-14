require('dotenv').config();
const { pool } = require('../db');

const platform = process.argv[2];

if (!platform) {
  console.error('Usage: node server/scripts/resetSyncedLeads.js <source_platform>');
  console.error('Example: node server/scripts/resetSyncedLeads.js whatconverts');
  process.exit(1);
}

async function reset() {
  await pool.query('DELETE FROM journey_events WHERE lead_id IN (SELECT id FROM leads WHERE source_platform = $1)', [platform]);
  await pool.query('DELETE FROM calls WHERE lead_id IN (SELECT id FROM leads WHERE source_platform = $1)', [platform]);
  await pool.query('DELETE FROM texts WHERE lead_id IN (SELECT id FROM leads WHERE source_platform = $1)', [platform]);
  const { rowCount } = await pool.query('DELETE FROM leads WHERE source_platform = $1', [platform]);
  console.log(`Deleted ${rowCount} lead(s) for source_platform "${platform}" and their journey_events/calls/texts.`);
  console.log('Next sync for this platform will recreate them from scratch.');
  await pool.end();
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
