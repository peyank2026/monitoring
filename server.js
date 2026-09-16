// Allow JSON.stringify to handle BigInt values natively
BigInt.prototype.toJSON = function() {
  return Number(this);
};

require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// ===========================================
// View engine setup
// ===========================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===========================================
// Middleware
// ===========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'switch-monitor-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Make session data available in all views
app.use((req, res, next) => {
  res.locals.username = req.session.username || null;
  res.locals.fullName = req.session.fullName || null;
  next();
});

// ===========================================
// Routes
// ===========================================
const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const hostRoutes = require('./routes/hosts');
const monitoringRoutes = require('./routes/monitoring');

app.use('/', authRoutes);
app.use('/', deviceRoutes);
app.use('/', hostRoutes);
app.use('/', monitoringRoutes);

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// ===========================================
// SNMP Polling Cron Job
// ===========================================
const { pollAllDevices } = require('./services/snmp-poller');

const pollInterval = process.env.SNMP_POLL_INTERVAL || '*/5 * * * *';

cron.schedule(pollInterval, async () => {
  console.log(`\n⏰ [${new Date().toISOString()}] Starting scheduled SNMP poll...`);
  try {
    await pollAllDevices();
    console.log(`✅ [${new Date().toISOString()}] Scheduled SNMP poll completed`);
  } catch (err) {
    console.error(`❌ [${new Date().toISOString()}] Scheduled SNMP poll failed:`, err.message);
  }
});

// ===========================================
// ICMP Monitoring Cron Job
// ===========================================
const { checkAllHosts } = require('./services/icmp-monitor');
const icmpPollInterval = process.env.ICMP_POLL_INTERVAL || '*/1 * * * *';
let icmpCheckRunning = false;

cron.schedule(icmpPollInterval, async () => {
  if (icmpCheckRunning) {
    console.log('ICMP check skipped because the previous run is still active');
    return;
  }

  icmpCheckRunning = true;
  try {
    const result = await checkAllHosts();
    if (result.count > 0) {
      console.log(`ICMP check completed: ${result.up} up, ${result.down} down`);
    }
  } catch (error) {
    console.error('ICMP check failed:', error.message);
  } finally {
    icmpCheckRunning = false;
  }
});

// ===========================================
// Error handling
// ===========================================
app.use((req, res) => {
  res.status(404).render('login', { error: 'Page not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ===========================================
// Start server
// ===========================================
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     Switch Monitor - SNMP Monitoring     ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Server running on http://localhost:${PORT}  ║`);
  console.log(`║  SNMP Poll Interval: ${pollInterval.padEnd(19)}║`);
  console.log('║  Default login: admin / admin123         ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});
