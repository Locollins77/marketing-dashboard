const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(spend), 0) AS total_spend,
      COALESCE(SUM(clicks), 0) AS total_clicks,
      COALESCE(SUM(conversions), 0) AS total_conversions
    FROM campaigns
  `).get();

  const totalLeads = db.prepare('SELECT COUNT(*) AS count FROM leads').get().count;
  const convertedLeads = db.prepare("SELECT COUNT(*) AS count FROM leads WHERE status = 'converted'").get().count;

  const byPlatform = db.prepare(`
    SELECT platform,
      SUM(spend) AS spend,
      SUM(clicks) AS clicks,
      SUM(conversions) AS conversions
    FROM campaigns
    GROUP BY platform
  `).all();

  const leadsBySource = db.prepare(`
    SELECT source_platform, COUNT(*) AS count
    FROM leads
    GROUP BY source_platform
  `).all();

  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY spend DESC').all();

  res.json({
    totals: {
      spend: totals.total_spend,
      clicks: totals.total_clicks,
      conversions: totals.total_conversions,
      leads: totalLeads,
      converted_leads: convertedLeads
    },
    by_platform: byPlatform,
    leads_by_source: leadsBySource,
    campaigns
  });
});

module.exports = router;
