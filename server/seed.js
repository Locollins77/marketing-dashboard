require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./db');

function daysAgo(n, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

db.exec(`
  DELETE FROM journey_events;
  DELETE FROM texts;
  DELETE FROM calls;
  DELETE FROM leads;
  DELETE FROM campaigns;
  DELETE FROM users;
`);

const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
const passwordHash = bcrypt.hashSync(adminPassword, 10);
db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(adminUsername, passwordHash);

const campaigns = [
  { platform: 'google', name: 'Search - Roofing Emergency', spend: 3120.45, clicks: 842, conversions: 38, date: daysAgo(20) },
  { platform: 'google', name: 'Search - Gutter Install', spend: 1875.10, clicks: 511, conversions: 22, date: daysAgo(20) },
  { platform: 'google', name: 'PMax - Storm Damage', spend: 2410.00, clicks: 690, conversions: 19, date: daysAgo(20) },
  { platform: 'meta', name: 'Lead Form - Roof Inspection', spend: 1640.75, clicks: 1203, conversions: 41, date: daysAgo(20) },
  { platform: 'meta', name: 'Retargeting - Free Estimate', spend: 980.30, clicks: 654, conversions: 17, date: daysAgo(20) },
  { platform: 'meta', name: 'Lookalike - Homeowners 35+', spend: 1325.60, clicks: 890, conversions: 24, date: daysAgo(20) }
];
const insertCampaign = db.prepare(
  'INSERT INTO campaigns (platform, name, spend, clicks, conversions, date) VALUES (@platform, @name, @spend, @clicks, @conversions, @date)'
);
for (const c of campaigns) insertCampaign.run(c);

const insertLead = db.prepare(`
  INSERT INTO leads (source_platform, source_campaign, contact_name, contact_info, created_at, lead_perfection_id, status)
  VALUES (@source_platform, @source_campaign, @contact_name, @contact_info, @created_at, @lead_perfection_id, @status)
`);
const insertEvent = db.prepare(`
  INSERT INTO journey_events (lead_id, event_type, timestamp, metadata)
  VALUES (@lead_id, @event_type, @timestamp, @metadata)
`);
const insertCall = db.prepare(`
  INSERT INTO calls (lead_id, call_recording_url, transcript, duration, call_date)
  VALUES (@lead_id, @call_recording_url, @transcript, @duration, @call_date)
`);
const insertText = db.prepare(`
  INSERT INTO texts (lead_id, direction, message, sent_at, ai_generated)
  VALUES (@lead_id, @direction, @message, @sent_at, @ai_generated)
`);

const leadSeeds = [
  {
    name: 'Karen Whitfield', phone: '(614) 555-0142', platform: 'google_ads',
    campaign: 'Search - Roofing Emergency', daysBack: 14, status: 'converted', lpid: 'LP-10234'
  },
  {
    name: 'Marcus Boyd', phone: '(614) 555-0187', platform: 'meta_ads',
    campaign: 'Lead Form - Roof Inspection', daysBack: 12, status: 'appointment', lpid: 'LP-10241'
  },
  {
    name: 'Priya Nair', phone: '(614) 555-0163', platform: 'whatconverts',
    campaign: 'Organic - Google Business Profile', daysBack: 11, status: 'contacted', lpid: 'LP-10255'
  },
  {
    name: 'Devon Ellis', phone: '(614) 555-0129', platform: 'google_ads',
    campaign: 'Search - Gutter Install', daysBack: 10, status: 'new', lpid: null
  },
  {
    name: 'Sam Okafor', phone: '(614) 555-0198', platform: 'meta_ads',
    campaign: 'Retargeting - Free Estimate', daysBack: 9, status: 'lost', lpid: 'LP-10260'
  },
  {
    name: 'Lindsey Marsh', phone: '(614) 555-0177', platform: 'google_ads',
    campaign: 'PMax - Storm Damage', daysBack: 8, status: 'converted', lpid: 'LP-10266'
  },
  {
    name: 'Tyrell Banks', phone: '(614) 555-0115', platform: 'whatconverts',
    campaign: 'Call Tracking - Main Line', daysBack: 7, status: 'appointment', lpid: 'LP-10271'
  },
  {
    name: 'Olivia Chen', phone: '(614) 555-0104', platform: 'meta_ads',
    campaign: 'Lookalike - Homeowners 35+', daysBack: 6, status: 'contacted', lpid: null
  },
  {
    name: 'Reggie Osei', phone: '(614) 555-0192', platform: 'google_ads',
    campaign: 'Search - Roofing Emergency', daysBack: 4, status: 'new', lpid: null
  },
  {
    name: 'Hannah Brooks', phone: '(614) 555-0158', platform: 'meta_ads',
    campaign: 'Lead Form - Roof Inspection', daysBack: 3, status: 'appointment', lpid: 'LP-10289'
  },
  {
    name: 'Julian Vega', phone: '(614) 555-0146', platform: 'whatconverts',
    campaign: 'Call Tracking - Main Line', daysBack: 2, status: 'new', lpid: null
  },
  {
    name: 'Faith Adeyemi', phone: '(614) 555-0133', platform: 'google_ads',
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

leadSeeds.forEach((seed, i) => {
  const createdAt = daysAgo(seed.daysBack, 9);
  const info = insertLead.run({
    source_platform: seed.platform,
    source_campaign: seed.campaign,
    contact_name: seed.name,
    contact_info: seed.phone,
    created_at: createdAt,
    lead_perfection_id: seed.lpid,
    status: seed.status
  });
  const leadId = info.lastInsertRowid;
  const steps = funnelByStatus[seed.status];
  const stepHourOffsets = [0, 1, 26, 27, 50, 100];

  steps.forEach((eventType, idx) => {
    const ts = daysAgo(seed.daysBack, 9);
    const eventDate = new Date(ts);
    eventDate.setHours(eventDate.getHours() + stepHourOffsets[idx]);
    const metadata = eventType === 'ad_click'
      ? { platform: seed.platform, campaign: seed.campaign }
      : eventType === 'crm_status_change'
        ? { lead_perfection_id: seed.lpid, new_status: 'active_lead' }
        : {};
    insertEvent.run({
      lead_id: leadId,
      event_type: eventType,
      timestamp: eventDate.toISOString(),
      metadata: JSON.stringify(metadata)
    });
  });

  if (steps.includes('call')) {
    const callDate = new Date(createdAt);
    callDate.setHours(callDate.getHours() + 26);
    insertCall.run({
      lead_id: leadId,
      call_recording_url: `https://calls.example.com/recordings/${1000 + i}.mp3`,
      transcript: transcripts[i % transcripts.length],
      duration: 180 + (i % 5) * 45,
      call_date: callDate.toISOString()
    });
  }

  if (steps.includes('text')) {
    const [outMsg, inMsg] = textPairs[i % textPairs.length];
    const textDate = new Date(createdAt);
    textDate.setHours(textDate.getHours() + 50);
    insertText.run({
      lead_id: leadId,
      direction: 'out',
      message: outMsg.replace('{name}', seed.name.split(' ')[0]),
      sent_at: textDate.toISOString(),
      ai_generated: 0
    });
    const replyDate = new Date(textDate);
    replyDate.setHours(replyDate.getHours() + 2);
    insertText.run({
      lead_id: leadId,
      direction: 'in',
      message: inMsg,
      sent_at: replyDate.toISOString(),
      ai_generated: 0
    });
  }
});

console.log(`Seeded ${campaigns.length} campaigns and ${leadSeeds.length} leads.`);
console.log(`Login with username "${adminUsername}" and the password set in .env (ADMIN_PASSWORD).`);
