const express = require('express');
const pool = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');
const { isValidHostAddress, checkHost, checkAllHosts } = require('../services/icmp-monitor');
const { resolveCustomHistoryRange } = require('../utils/history-range');

const router = express.Router();

const ICMP_HISTORY_RANGES = {
  '6h':  { intervalSql: '6 HOUR',  bucketSeconds: 300 },
  '24h': { intervalSql: '24 HOUR', bucketSeconds: 900 },
  '7d':  { intervalSql: '7 DAY',   bucketSeconds: 3600 },
  '30d': { intervalSql: '30 DAY',  bucketSeconds: 21600 }
};

router.get('/latency', isAuthenticated, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const hosts = await conn.query('SELECT * FROM hosts ORDER BY name');
    const latencyValues = hosts
      .filter(host => host.status === 'up' && host.latency_ms !== null)
      .map(host => Number(host.latency_ms));

    res.render('latency-dashboard', {
      title: 'Latency Dashboard',
      activePage: 'latency',
      hosts,
      totalHosts: hosts.length,
      upHosts: hosts.filter(host => host.is_active && host.status === 'up').length,
      downHosts: hosts.filter(host => host.is_active && host.status === 'down').length,
      avgLatency: latencyValues.length
        ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
        : null,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error loading latency dashboard:', error);
    res.render('latency-dashboard', {
      title: 'Latency Dashboard',
      activePage: 'latency',
      hosts: [],
      totalHosts: 0,
      upHosts: 0,
      downHosts: 0,
      avgLatency: null,
      success: null,
      error: 'Gagal memuat data latency'
    });
  } finally {
    if (conn) conn.release();
  }
});

router.get('/api/icmp-history/:hostId', isAuthenticated, async (req, res) => {
  let conn;

  try {
    const customRange = resolveCustomHistoryRange(req.query);
    const rangeKey = customRange
      ? 'custom'
      : (Object.hasOwn(ICMP_HISTORY_RANGES, req.query.range) ? req.query.range : '24h');
    const range = customRange || ICMP_HISTORY_RANGES[rangeKey];
    const timeCondition = customRange
      ? 'checked_at >= ? AND checked_at <= ?'
      : `checked_at >= DATE_SUB(NOW(), INTERVAL ${range.intervalSql}) AND checked_at <= NOW()`;
    const timeParams = customRange ? [customRange.start.sql, customRange.end.sql] : [];

    conn = await pool.getConnection();
    const data = await conn.query(`
      SELECT
        MIN(min_latency_ms) AS min_latency_ms,
        AVG(avg_latency_ms) AS avg_latency_ms,
        MAX(max_latency_ms) AS max_latency_ms,
        AVG(packet_loss) AS packet_loss,
        FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(checked_at) / ?) * ?) AS checked_at
      FROM icmp_data
      WHERE host_id = ?
        AND ${timeCondition}
      GROUP BY FLOOR(UNIX_TIMESTAMP(checked_at) / ?)
      ORDER BY checked_at
    `, [
      range.bucketSeconds,
      range.bucketSeconds,
      req.params.hostId,
      ...timeParams,
      range.bucketSeconds
    ]);

    res.json({
      success: true,
      range: rangeKey,
      start: customRange?.start.input || null,
      end: customRange?.end.input || null,
      data: data.map(row => ({
        min_latency_ms: row.min_latency_ms === null ? null : Number(row.min_latency_ms),
        avg_latency_ms: row.avg_latency_ms === null ? null : Number(row.avg_latency_ms),
        max_latency_ms: row.max_latency_ms === null ? null : Number(row.max_latency_ms),
        packet_loss: Number(row.packet_loss || 0),
        checked_at: row.checked_at
      }))
    });
  } catch (error) {
    console.error('Error loading ICMP history:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Gagal memuat histori ICMP'
    });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/hosts', isAuthenticated, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const address = String(req.body.address || '').trim().toLowerCase();
  const location = String(req.body.location || '').trim();
  let conn;

  if (!name || name.length > 100) {
    return res.redirect('/latency?error=' + encodeURIComponent('Nama host wajib diisi dan maksimal 100 karakter'));
  }
  if (!isValidHostAddress(address)) {
    return res.redirect('/latency?error=' + encodeURIComponent('IP address atau hostname tidak valid'));
  }

  try {
    conn = await pool.getConnection();
    const result = await conn.query(
      'INSERT INTO hosts (name, address, location) VALUES (?, ?, ?)',
      [name, address, location]
    );
    conn.release();
    conn = null;

    await checkHost({ id: Number(result.insertId), address });
    res.redirect('/latency?success=' + encodeURIComponent('Host berhasil ditambahkan'));
  } catch (error) {
    console.error('Error adding ICMP host:', error);
    const message = error.code === 'ER_DUP_ENTRY'
      ? 'Host tersebut sudah terdaftar'
      : 'Gagal menambahkan host';
    res.redirect('/latency?error=' + encodeURIComponent(message));
  } finally {
    if (conn) conn.release();
  }
});

router.post('/hosts/:id/check', isAuthenticated, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT id, address FROM hosts WHERE id = ?', [req.params.id]);
    if (!rows.length) {
      return res.redirect('/latency?error=' + encodeURIComponent('Host tidak ditemukan'));
    }
    conn.release();
    conn = null;

    await checkHost(rows[0]);
    res.redirect('/latency?success=' + encodeURIComponent('Pengecekan ICMP selesai'));
  } catch (error) {
    console.error('Error checking ICMP host:', error);
    res.redirect('/latency?error=' + encodeURIComponent('Pengecekan ICMP gagal'));
  } finally {
    if (conn) conn.release();
  }
});

router.post('/hosts/check-all', isAuthenticated, async (req, res) => {
  try {
    const result = await checkAllHosts();
    res.redirect('/latency?success=' + encodeURIComponent(
      `Pengecekan selesai: ${result.up} up, ${result.down} down`
    ));
  } catch (error) {
    console.error('Error checking all ICMP hosts:', error);
    res.redirect('/latency?error=' + encodeURIComponent('Pengecekan semua host gagal'));
  }
});

router.post('/hosts/:id/delete', isAuthenticated, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM hosts WHERE id = ?', [req.params.id]);
    res.redirect('/latency?success=' + encodeURIComponent('Host berhasil dihapus'));
  } catch (error) {
    console.error('Error deleting ICMP host:', error);
    res.redirect('/latency?error=' + encodeURIComponent('Gagal menghapus host'));
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
