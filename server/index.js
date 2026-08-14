require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const overviewRoutes = require('./routes/overview');
const leadsRoutes = require('./routes/leads');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

app.use('/api/auth', authRoutes);
app.use('/api/overview', requireAuth, overviewRoutes);
app.use('/api/leads', requireAuth, leadsRoutes);

app.get(['/', '/index.html', '/leads.html', '/lead-detail.html'], requireAuth, (req, res) => {
  const page = req.path === '/' ? 'index.html' : req.path.slice(1);
  res.sendFile(path.join(__dirname, '..', 'public', page));
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Marketing dashboard running at http://localhost:${PORT}`);
});
