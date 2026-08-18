require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const cron = require('node-cron');
const pgSession = require('connect-pg-simple')(session);

const { pool, init } = require('./db');
const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const overviewRoutes = require('./routes/overview');
const leadsRoutes = require('./routes/leads');
const syncRoutes = require('./routes/sync');
const {
  runWhatConvertsSync, hasAnyWhatConvertsCredentials,
  runGoogleAdsSync, hasAnyGoogleAdsCredentials,
  runMetaAdsSync, hasMetaCredentials
} = require('./sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

app.use('/api/auth', authRoutes);
app.use('/api/overview', requireAuth, overviewRoutes);
app.use('/api/leads', requireAuth, leadsRoutes);
app.use('/api/sync', requireAuth, syncRoutes);

app.get(['/', '/index.html', '/leads.html', '/lead-detail.html'], requireAuth, (req, res) => {
  const page = req.path === '/' ? 'index.html' : req.path.slice(1);
  res.sendFile(path.join(__dirname, '..', 'public', page));
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).send('Internal server error');
});

function startWhatConvertsSync() {
  if (!hasAnyWhatConvertsCredentials()) {
    console.log('[sync] No WhatConverts brand credentials set, skipping sync');
    return;
  }
  runWhatConvertsSync().catch((err) => console.error('[sync] whatconverts failed:', err));
  cron.schedule('*/30 * * * *', () => {
    runWhatConvertsSync().catch((err) => console.error('[sync] whatconverts failed:', err));
  });
}

function startGoogleAdsSync() {
  if (!hasAnyGoogleAdsCredentials()) {
    console.log('[sync] Google Ads credentials not set, skipping sync');
    return;
  }
  runGoogleAdsSync().catch((err) => console.error('[sync] google_ads failed:', err));
  cron.schedule('*/30 * * * *', () => {
    runGoogleAdsSync().catch((err) => console.error('[sync] google_ads failed:', err));
  });
}

function startMetaAdsSync() {
  if (!hasMetaCredentials()) {
    console.log('[sync] Meta Ads credentials not set, skipping sync');
    return;
  }
  runMetaAdsSync().catch((err) => console.error('[sync] meta_ads failed:', err));
  cron.schedule('*/30 * * * *', () => {
    runMetaAdsSync().catch((err) => console.error('[sync] meta_ads failed:', err));
  });
}

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Marketing dashboard running at http://localhost:${PORT}`);
    });
    startWhatConvertsSync();
    startGoogleAdsSync();
    startMetaAdsSync();
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
