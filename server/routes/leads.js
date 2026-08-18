const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const brand = req.query.brand && req.query.brand !== 'all' ? req.query.brand : null;
  const where = brand ? 'WHERE brand = $1' : '';
  const params = brand ? [brand] : [];

  const { rows } = await pool.query(`
    SELECT id, source_platform, source_campaign, contact_name, contact_info,
           created_at, lead_perfection_id, status, brand
    FROM leads
    ${where}
    ORDER BY created_at DESC
  `, params);
  res.json(rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const leadResult = await pool.query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
  const lead = leadResult.rows[0];
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const eventsResult = await pool.query(
    `SELECT id, event_type, timestamp, metadata FROM journey_events WHERE lead_id = $1 ORDER BY timestamp ASC`,
    [lead.id]
  );
  const events = eventsResult.rows.map((e) => ({ ...e, metadata: e.metadata ? JSON.parse(e.metadata) : null }));

  const callsResult = await pool.query(
    `SELECT id, call_recording_url, transcript, duration, call_date FROM calls WHERE lead_id = $1 ORDER BY call_date ASC`,
    [lead.id]
  );

  const textsResult = await pool.query(
    `SELECT id, direction, message, sent_at, ai_generated FROM texts WHERE lead_id = $1 ORDER BY sent_at ASC`,
    [lead.id]
  );

  res.json({ lead, events, calls: callsResult.rows, texts: textsResult.rows });
}));

module.exports = router;
