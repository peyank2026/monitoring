const express = require('express');
const pool = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /devices - Device management page
 */
router.get('/devices', isAuthenticated, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const devices = await conn.query(
      'SELECT * FROM devices ORDER BY created_at DESC'
    );

    res.render('devices', {
      title: 'Device Management',
      activePage: 'devices',
      devices,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error fetching devices:', err);
    res.render('devices', {
      title: 'Device Management',
      activePage: 'devices',
      devices: [],
      success: null,
      error: 'Gagal memuat data device'
    });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * POST /devices - Add new device
 */
router.post('/devices', isAuthenticated, async (req, res) => {
  const { name, ip_address, vendor, snmp_community, snmp_version, location } = req.body;
  const versionNum = parseInt(snmp_version, 10) || 2;
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.query(
      `INSERT INTO devices (name, ip_address, vendor, snmp_community, snmp_version, location)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, ip_address, vendor, snmp_community || 'public', versionNum, location || '']
    );

    res.redirect('/devices?success=Device berhasil ditambahkan');
  } catch (err) {
    console.error('Error adding device:', err);
    res.redirect('/devices?error=Gagal menambahkan device: ' + err.message);
  } finally {
    if (conn) conn.release();
  }
});

/**
 * POST /devices/:id/update - Update device
 */
router.post('/devices/:id/update', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { name, ip_address, vendor, snmp_community, snmp_version, location, is_active } = req.body;
  const versionNum = parseInt(snmp_version, 10) || 2;
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.query(
      `UPDATE devices 
       SET name = ?, ip_address = ?, vendor = ?, snmp_community = ?, 
           snmp_version = ?, location = ?, is_active = ?
       WHERE id = ?`,
      [name, ip_address, vendor, snmp_community, versionNum, location, is_active === 'on' ? 1 : 0, id]
    );

    res.redirect('/devices?success=Device berhasil diupdate');
  } catch (err) {
    console.error('Error updating device:', err);
    res.redirect('/devices?error=Gagal mengupdate device');
  } finally {
    if (conn) conn.release();
  }
});

/**
 * POST /devices/:id/delete - Delete device
 */
router.post('/devices/:id/delete', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  let conn;

  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM devices WHERE id = ?', [id]);
    res.redirect('/devices?success=Device berhasil dihapus');
  } catch (err) {
    console.error('Error deleting device:', err);
    res.redirect('/devices?error=Gagal menghapus device');
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
