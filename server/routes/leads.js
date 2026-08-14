const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const leads = db.prepare(`
    SELECT id, source_platform, source_campaign, contact_name, contact_info,
           created_at, lead_perfection_id, status
    FROM leads
    ORDER BY created_at DESC
  `).all();
  res.json(leads);
});

router.get('/:id', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const events = db.prepare(`
    SELECT id, event_type, timestamp, metadata
    FROM journey_events
    WHERE lead_id = ?
    ORDER BY timestamp ASC
  `).all(lead.id).map((e) => ({ ...e, metadata: e.metadata ? JSON.parse(e.metadata) : null }));

  const calls = db.prepare(`
    SELECT id, call_recording_url, transcript, duration, call_date
    FROM calls WHERE lead_id = ? ORDER BY call_date ASC
  `).all(lead.id);

  const texts = db.prepare(`
    SELECT id, direction, message, sent_at, ai_generated
    FROM texts WHERE lead_id = ? ORDER BY sent_at ASC
  `).all(lead.id);

  res.json({ lead, events, calls, texts });
});

module.exports = router;
