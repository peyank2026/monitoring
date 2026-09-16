const express = require('express');
const pool = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { pollDevice, pollAllDevices } = require('../services/snmp-poller');

const router = express.Router();

/**
 * GET /dashboard - Main dashboard with device overview
 */
router.get('/dashboard', isAuthenticated, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();

    // Get all devices
    const devices = await conn.query('SELECT * FROM devices ORDER BY name');

    // For each device, get interface summary from latest poll
    const deviceSummaries = [];
    for (const device of devices) {
      const ifStats = await conn.query(`
        SELECT 
          COUNT(*) as total_interfaces,
          SUM(CASE WHEN if_status = 'up' THEN 1 ELSE 0 END) as up_count,
          SUM(CASE WHEN rx_power IS NOT NULL AND rx_power < -25 THEN 1 ELSE 0 END) as alarm_count,
          MAX(polled_at) as last_polled
        FROM interface_data 
        WHERE device_id = ? 
          AND polled_at = (SELECT MAX(polled_at) FROM interface_data WHERE device_id = ?)
      `, [device.id, device.id]);

      deviceSummaries.push({
        ...device,
        interface_count: ifStats[0]?.total_interfaces || 0,
        up_count: ifStats[0]?.up_count || 0,
        alarm_count: ifStats[0]?.alarm_count || 0,
        last_polled: ifStats[0]?.last_polled || null
      });
    }

    // Calculate totals
    const totalDevices = devices.length;
    const onlineDevices = devices.filter(d => d.is_active && d.last_poll_success === 1).length;
    const offlineDevices = devices.filter(d => d.is_active && d.last_poll_success !== 1).length;
    const totalAlarms = deviceSummaries.reduce((sum, d) => sum + (d.alarm_count || 0), 0);

    res.render('dashboard', {
      title: 'Dashboard',
      activePage: 'dashboard',
      devices: deviceSummaries,
      totalDevices,
      onlineDevices,
      offlineDevices,
      totalAlarms
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.render('dashboard', {
      title: 'Dashboard',
      activePage: 'dashboard',
      devices: [],
      totalDevices: 0,
      onlineDevices: 0,
      offlineDevices: 0,
      totalAlarms: 0
    });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * GET /device/:id - Device detail with interface monitoring
 */
router.get('/device/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  let conn;

  try {
    conn = await pool.getConnection();

    // Get device info
    const deviceRows = await conn.query('SELECT * FROM devices WHERE id = ?', [id]);
    if (deviceRows.length === 0) {
      return res.redirect('/dashboard');
    }
    const device = deviceRows[0];

    // Get latest interface data
    const interfaces = await conn.query(`
      SELECT * FROM interface_data 
      WHERE device_id = ? 
        AND polled_at = (SELECT MAX(polled_at) FROM interface_data WHERE device_id = ?)
      ORDER BY if_index
    `, [id, id]);

    device.last_polled = device.last_poll_at || interfaces[0]?.polled_at || null;

    res.render('device-detail', {
      title: device.name,
      activePage: 'devices',
      device,
      interfaces
    });
  } catch (err) {
    console.error('Device detail error:', err);
    res.redirect('/dashboard');
  } finally {
    if (conn) conn.release();
  }
});

/**
 * GET /api/interfaces/:deviceId - JSON API: latest interface data
 */
router.get('/api/interfaces/:deviceId', isAuthenticated, async (req, res) => {
  const { deviceId } = req.params;
  let conn;

  try {
    conn = await pool.getConnection();
    const interfaces = await conn.query(`
      SELECT * FROM interface_data 
      WHERE device_id = ? 
        AND polled_at = (SELECT MAX(polled_at) FROM interface_data WHERE device_id = ?)
      ORDER BY if_index
    `, [deviceId, deviceId]);

    res.json({ success: true, data: interfaces });
  } catch (err) {
    console.error('API interfaces error:', err);
    res.json({ success: false, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

const TRAFFIC_RANGES = {
  '6h':  { intervalSql: '6 HOUR',   bucketSeconds: 300 },
  '12h': { intervalSql: '12 HOUR',  bucketSeconds: 600 },
  '24h': { intervalSql: '24 HOUR',  bucketSeconds: 900 },
  '1w':  { intervalSql: '1 WEEK',   bucketSeconds: 3600 },
  '2w':  { intervalSql: '2 WEEK',   bucketSeconds: 7200 },
  '1mo': { intervalSql: '1 MONTH',  bucketSeconds: 21600 },
  '2mo': { intervalSql: '2 MONTH',  bucketSeconds: 43200 },
  '3mo': { intervalSql: '3 MONTH',  bucketSeconds: 86400 },
  '6mo': { intervalSql: '6 MONTH',  bucketSeconds: 172800 },
  '1y':  { intervalSql: '1 YEAR',   bucketSeconds: 604800 },
  '2y':  { intervalSql: '2 YEAR',   bucketSeconds: 1209600 }
};

/**
 * GET /api/traffic-history/:deviceId/:ifIndex?range=24h
 * Returns time-bucketed traffic data to keep long-range charts responsive.
 */
router.get('/api/traffic-history/:deviceId/:ifIndex', isAuthenticated, async (req, res) => {
  const { deviceId, ifIndex } = req.params;
  const rangeKey = Object.hasOwn(TRAFFIC_RANGES, req.query.range) ? req.query.range : '24h';
  const range = TRAFFIC_RANGES[rangeKey];
  let conn;

  try {
    conn = await pool.getConnection();
    const data = await conn.query(`
      SELECT
        ROUND(AVG(in_traffic_bps)) AS in_traffic_bps,
        ROUND(AVG(out_traffic_bps)) AS out_traffic_bps,
        FROM_UNIXTIME(
          FLOOR(UNIX_TIMESTAMP(polled_at) / ?) * ?
        ) AS polled_at
      FROM interface_data 
      WHERE device_id = ? AND if_index = ? 
        AND polled_at >= DATE_SUB(NOW(), INTERVAL ${range.intervalSql})
        AND polled_at <= NOW()
      GROUP BY FLOOR(UNIX_TIMESTAMP(polled_at) / ?)
      ORDER BY polled_at
    `, [range.bucketSeconds, range.bucketSeconds, deviceId, ifIndex, range.bucketSeconds]);

    const formattedData = data.map(row => ({
      in_traffic_bps: Number(row.in_traffic_bps || 0),
      out_traffic_bps: Number(row.out_traffic_bps || 0),
      polled_at: row.polled_at
    }));

    res.json({ success: true, range: rangeKey, data: formattedData });
  } catch (err) {
    console.error('API traffic history error:', err);
    res.json({ success: false, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * GET /api/optical-history/:deviceId/:ifIndex - Optical power history (24h)
 */
router.get('/api/optical-history/:deviceId/:ifIndex', isAuthenticated, async (req, res) => {
  const { deviceId, ifIndex } = req.params;
  let conn;

  try {
    conn = await pool.getConnection();
    const data = await conn.query(`
      SELECT tx_power, rx_power, polled_at 
      FROM interface_data 
      WHERE device_id = ? AND if_index = ? 
        AND polled_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY polled_at
    `, [deviceId, ifIndex]);

    res.json({ success: true, data });
  } catch (err) {
    console.error('API optical history error:', err);
    res.json({ success: false, error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * GET/POST /api/poll/:deviceId - Manual poll trigger for a device
 */
const handleDevicePoll = async (req, res) => {
  const { deviceId } = req.params;
  let conn;

  try {
    conn = await pool.getConnection();
    const deviceRows = await conn.query('SELECT * FROM devices WHERE id = ?', [deviceId]);

    if (deviceRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }

    conn.release();
    conn = null;

    const result = await pollDevice(deviceRows[0]);
    res.json({ success: true, message: `Poll completed for ${deviceRows[0].name}`, result });
  } catch (err) {
    console.error('Manual poll error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (conn) conn.release();
  }
};

router.get('/api/poll/:deviceId', isAuthenticated, handleDevicePoll);
router.post('/api/poll/:deviceId', isAuthenticated, handleDevicePoll);

/**
 * GET/POST /api/poll-all - Manual poll trigger for all devices
 */
const handlePollAll = async (req, res) => {
  try {
    const result = await pollAllDevices();
    res.json({ success: true, message: 'All devices polled', result });
  } catch (err) {
    console.error('Global poll error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

router.get('/api/poll-all', isAuthenticated, handlePollAll);
router.post('/api/poll-all', isAuthenticated, handlePollAll);

module.exports = router;
