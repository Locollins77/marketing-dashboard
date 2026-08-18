require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool, init } = require('./db');

function daysAgo(n, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const campaigns = [
  { platform: 'google', name: 'Search - Roofing Emergency', spend: 3120.45, clicks: 842, conversions: 38, date: daysAgo(20), brand: 'seamless' },
  { platform: 'google', name: 'Search - Gutter Install', spend: 1875.10, clicks: 511, conversions: 22, date: daysAgo(20), brand: 'seamless' },
  { platform: 'google', name: 'PMax - Storm Damage', spend: 2410.00, clicks: 690, conversions: 19, date: daysAgo(20), brand: 'bathshower' },
  { platform: 'meta', name: 'Lead Form - Roof Inspection', spend: 1640.75, clicks: 1203, conversions: 41, date: daysAgo(20), brand: 'seamless' },
  { platform: 'meta', name: 'Retargeting - Free Estimate', spend: 980.30, clicks: 654, conversions: 17, date: daysAgo(20), brand: 'bathshower' },
  { platform: 'meta', name: 'Lookalike - Homeowners 35+', spend: 1325.60, clicks: 890, conversions: 24, date: daysAgo(20), brand: 'bathshower' }
];

const leadSeeds = [
  {
    name: 'Karen Whitfield', phone: '(614) 555-0142', platform: 'google_ads', brand: 'seamless',
    campaign: 'Search - Roofing Emergency', daysBack: 14, status: 'converted', lpid: 'LP-10234'
  },
  {
    name: 'Marcus Boyd', phone: '(614) 555-0187', platform: 'meta_ads', brand: 'seamless',
    campaign: 'Lead Form - Roof Inspection', daysBack: 12, status: 'appointment', lpid: 'LP-10241'
  },
  {
    name: 'Priya Nair', phone: '(614) 555-0163', platform: 'whatconverts', brand: 'bathshower',
    campaign: 'Organic - Google Business Profile', daysBack: 11, status: 'contacted', lpid: 'LP-10255'
  },
  {
    name: 'Devon Ellis', phone: '(614) 555-0129', platform: 'google_ads', brand: 'bathshower',
    campaign: 'Search - Gutter Install', daysBack: 10, status: 'new', lpid: null
  },
  {
    name: 'Sam Okafor', phone: '(614) 555-0198', platform: 'meta_ads', brand: 'bathshower',
    campaign: 'Retargeting - Free Estimate', daysBack: 9, status: 'lost', lpid: 'LP-10260'
  },
  {
    name: 'Lindsey Marsh', phone: '(614) 555-0177', platform: 'google_ads', brand: 'bathshower',
    campaign: 'PMax - Storm Damage', daysBack: 8, status: 'converted', lpid: 'LP-10266'
  },
  {
    name: 'Tyrell Banks', phone: '(614) 555-0115', platform: 'whatconverts', brand: 'seamless',
    campaign: 'Call Tracking - Main Line', daysBack: 7, status: 'appointment', lpid: 'LP-10271'
  },
  {
    name: 'Olivia Chen', phone: '(614) 555-0104', platform: 'meta_ads', brand: 'bathshower',
    campaign: 'Lookalike - Homeowners 35+', daysBack: 6, status: 'contacted', lpid: null
  },
  {
    name: 'Reggie Osei', phone: '(614) 555-0192', platform: 'google_ads', brand: 'seamless',
    campaign: 'Search - Roofing Emergency', daysBack: 4, status: 'new', lpid: null
  },
  {
    name: 'Hannah Brooks', phone: '(614) 555-0158', platform: 'meta_ads', brand: 'seamless',
    campaign: 'Lead Form - Roof Inspection', daysBack: 3, status: 'appointment', lpid: 'LP-10289'
  },
  {
    name: 'Julian Vega', phone: '(614) 555-0146', platform: 'whatconverts', brand: 'seamless',
    campaign: 'Call Tracking - Main Line', daysBack: 2, status: 'new', lpid: null
  },
  {
    name: 'Faith Adeyemi', phone: '(614) 555-0133', platform: 'google_ads', brand: 'bathshower',
    campaign: 'Search - Gutter Install', daysBack: 1, status: 'contacted', lpid: null
  }
];

const funnelByStatus = {
  new: ['ad_click', 'form_submit'],
  contacted: ['ad_click', 'form_submit', 'crm_status_change', 'call'],
  appointment: ['ad_click', 'form_submit', 'crm_status_change', 'call', 'text'],
  converted: ['ad_click', 'form_submit', 'crm_status_change', 'call', 'text', 'conversion'],
  lost: ['ad_click', 'form_submit', 'crm_status_change', 'call']
};

const transcripts = [
  "Hi, thanks for calling in about the storm damage estimate. We can get someone out Thursday morning, does that work?",
  "I'm following up on your roof inspection request submitted online yesterday - do you have a few minutes to go over what you're seeing?",
  "Just confirming your appointment for gutter replacement pricing on Friday at 2pm. Anything specific you want the estimator to look at?"
];

const textPairs = [
  ["Hi {name}, this is Ridgeline Roofing following up on your free estimate request. When's a good time this week?", "Thursday afternoon works for me"],
  ["Reminder: your inspection is scheduled for tomorrow at 10am. Reply STOP to opt out of texts.", "Sounds good, see you then"],
  ["Thanks for chatting today! Here's the estimate summary we discussed, let me know if you have questions.", "Looks good, how do we move forward?"]
];

async function seed() {
  await init();

  await pool.query('DELETE FROM journey_events');
  await pool.query('DELETE FROM texts');
  await pool.query('DELETE FROM calls');
  await pool.query('DELETE FROM leads');
  await pool.query('DELETE FROM campaigns');
  await pool.query('DELETE FROM users');

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
  const passwordHash = bcrypt.hashSync(adminPassword, 10);
  await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [adminUsername, passwordHash]);

  for (const c of campaigns) {
    await pool.query(
      'INSERT INTO campaigns (platform, name, spend, clicks, conversions, date, brand) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [c.platform, c.name, c.spend, c.clicks, c.conversions, c.date, c.brand]
    );
  }

  const stepHourOffsets = [0, 1, 26, 27, 50, 100];

  for (let i = 0; i < leadSeeds.length; i++) {
    const seed = leadSeeds[i];
    const createdAt = daysAgo(seed.daysBack, 9);

    const { rows } = await pool.query(
      `INSERT INTO leads (source_platform, source_campaign, contact_name, contact_info, created_at, lead_perfection_id, status, brand)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [seed.platform, seed.campaign, seed.name, seed.phone, createdAt, seed.lpid, seed.status, seed.brand]
    );
    const leadId = rows[0].id;
    const steps = funnelByStatus[seed.status];

    for (let idx = 0; idx < steps.length; idx++) {
      const eventType = steps[idx];
      const eventDate = new Date(createdAt);
      eventDate.setHours(eventDate.getHours() + stepHourOffsets[idx]);
      const metadata = eventType === 'ad_click'
        ? { platform: seed.platform, campaign: seed.campaign }
        : eventType === 'crm_status_change'
          ? { lead_perfection_id: seed.lpid, new_status: 'active_lead' }
          : {};
      await pool.query(
        'INSERT INTO journey_events (lead_id, event_type, timestamp, metadata, brand) VALUES ($1, $2, $3, $4, $5)',
        [leadId, eventType, eventDate.toISOString(), JSON.stringify(metadata), seed.brand]
      );
    }

    if (steps.includes('call')) {
      const callDate = new Date(createdAt);
      callDate.setHours(callDate.getHours() + 26);
      await pool.query(
        'INSERT INTO calls (lead_id, call_recording_url, transcript, duration, call_date) VALUES ($1, $2, $3, $4, $5)',
        [leadId, `https://calls.example.com/recordings/${1000 + i}.mp3`, transcripts[i % transcripts.length], 180 + (i % 5) * 45, callDate.toISOString()]
      );
    }

    if (steps.includes('text')) {
      const [outMsg, inMsg] = textPairs[i % textPairs.length];
      const textDate = new Date(createdAt);
      textDate.setHours(textDate.getHours() + 50);
      await pool.query(
        'INSERT INTO texts (lead_id, direction, message, sent_at, ai_generated) VALUES ($1, $2, $3, $4, $5)',
        [leadId, 'out', outMsg.replace('{name}', seed.name.split(' ')[0]), textDate.toISOString(), 0]
      );
      const replyDate = new Date(textDate);
      replyDate.setHours(replyDate.getHours() + 2);
      await pool.query(
        'INSERT INTO texts (lead_id, direction, message, sent_at, ai_generated) VALUES ($1, $2, $3, $4, $5)',
        [leadId, 'in', inMsg, replyDate.toISOString(), 0]
      );
    }
  }

  console.log(`Seeded ${campaigns.length} campaigns and ${leadSeeds.length} leads.`);
  console.log(`Login with username "${adminUsername}" and the password set in .env (ADMIN_PASSWORD).`);
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
