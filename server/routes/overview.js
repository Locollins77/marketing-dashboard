const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const totalsResult = await pool.query(`
    SELECT
      COALESCE(SUM(spend), 0) AS total_spend,
      COALESCE(SUM(clicks), 0) AS total_clicks,
      COALESCE(SUM(conversions), 0) AS total_conversions
    FROM campaigns
  `);
  const totals = totalsResult.rows[0];

  const totalLeadsResult = await pool.query('SELECT COUNT(*) AS count FROM leads');
  const convertedLeadsResult = await pool.query("SELECT COUNT(*) AS count FROM leads WHERE status = 'converted'");

  const byPlatformResult = await pool.query(`
    SELECT platform, SUM(spend) AS spend, SUM(clicks) AS clicks, SUM(conversions) AS conversions
    FROM campaigns
    GROUP BY platform
  `);

  const leadsBySourceResult = await pool.query(`
    SELECT source_platform, COUNT(*) AS count
    FROM leads
    GROUP BY source_platform
  `);

  const campaignsResult = await pool.query('SELECT * FROM campaigns ORDER BY spend DESC');

  res.json({
    totals: {
      spend: Number(totals.total_spend),
      clicks: Number(totals.total_clicks),
      conversions: Number(totals.total_conversions),
      leads: Number(totalLeadsResult.rows[0].count),
      converted_leads: Number(convertedLeadsResult.rows[0].count)
    },
    by_platform: byPlatformResult.rows.map((r) => ({
      platform: r.platform,
      spend: Number(r.spend),
      clicks: Number(r.clicks),
      conversions: Number(r.conversions)
    })),
    leads_by_source: leadsBySourceResult.rows.map((r) => ({
      source_platform: r.source_platform,
      count: Number(r.count)
    })),
    campaigns: campaignsResult.rows
  });
}));

module.exports = router;
