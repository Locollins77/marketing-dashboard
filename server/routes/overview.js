const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const brand = req.query.brand && req.query.brand !== 'all' ? req.query.brand : null;
  const start = req.query.start || '1970-01-01';
  const end = req.query.end || '2999-12-31';

  const params = brand ? [start, end, brand] : [start, end];
  const brandClause = brand ? 'AND brand = $3' : '';
  const campaignWhere = `WHERE date BETWEEN $1 AND $2 ${brandClause}`;
  const leadWhere = `WHERE LEFT(created_at, 10) BETWEEN $1 AND $2 ${brandClause}`;

  const totalsResult = await pool.query(`
    SELECT
      COALESCE(SUM(spend), 0) AS total_spend,
      COALESCE(SUM(clicks), 0) AS total_clicks,
      COALESCE(SUM(conversions), 0) AS total_conversions
    FROM campaigns
    ${campaignWhere}
  `, params);
  const totals = totalsResult.rows[0];

  const totalLeadsResult = await pool.query(`SELECT COUNT(*) AS count FROM leads ${leadWhere}`, params);
  const convertedLeadsResult = await pool.query(
    `SELECT COUNT(*) AS count FROM leads ${leadWhere} AND status = 'converted'`, params
  );

  // Blended true-channel view: WhatConverts leads carry the real attributed channel
  // (google/meta/organic/direct/etc) in source_platform, while ad spend only exists
  // for google/meta. A FULL OUTER JOIN lets every channel show up - spend/clicks stay
  // NULL (shown as "—") for channels with no ad spend, rather than a misleading $0.
  const byPlatformResult = await pool.query(`
    WITH channel_leads AS (
      SELECT source_platform AS channel, COUNT(*) AS lead_count
      FROM leads
      ${leadWhere}
      GROUP BY source_platform
    ),
    channel_spend AS (
      SELECT platform AS channel, SUM(spend) AS spend, SUM(clicks) AS clicks
      FROM campaigns
      ${campaignWhere}
      GROUP BY platform
    )
    SELECT COALESCE(cl.channel, cs.channel) AS platform,
           cs.spend, cs.clicks, COALESCE(cl.lead_count, 0) AS conversions
    FROM channel_leads cl
    FULL OUTER JOIN channel_spend cs ON cl.channel = cs.channel
    ORDER BY cs.spend DESC NULLS LAST
  `, params);

  const leadsBySourceResult = await pool.query(`
    SELECT source_platform, COUNT(*) AS count
    FROM leads
    ${leadWhere}
    GROUP BY source_platform
  `, params);

  // Campaigns are stored one row per day now (for date-range accuracy), so aggregate
  // back to one row per campaign for display.
  const campaignsResult = await pool.query(`
    SELECT platform, brand, external_id, name,
           SUM(spend) AS spend, SUM(clicks) AS clicks, SUM(conversions) AS conversions
    FROM campaigns
    ${campaignWhere}
    GROUP BY platform, brand, external_id, name
    ORDER BY SUM(spend) DESC
  `, params);

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
      spend: r.spend != null ? Number(r.spend) : null,
      clicks: r.clicks != null ? Number(r.clicks) : null,
      conversions: Number(r.conversions)
    })),
    leads_by_source: leadsBySourceResult.rows.map((r) => ({
      source_platform: r.source_platform,
      count: Number(r.count)
    })),
    campaigns: campaignsResult.rows.map((r) => ({
      platform: r.platform,
      name: r.name,
      spend: Number(r.spend),
      clicks: Number(r.clicks),
      conversions: Number(r.conversions)
    }))
  });
}));

module.exports = router;
