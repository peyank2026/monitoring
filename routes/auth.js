const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');

const router = express.Router();

/**
 * GET /login - Render login page
 */
router.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  res.render('login', { error: null });
});

/**
 * POST /login - Authenticate user
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  let conn;

  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT id, username, password, full_name, role FROM users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.render('login', { error: 'Username atau password salah' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.render('login', { error: 'Username atau password salah' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.fullName = user.full_name;
    req.session.userRole = user.role;

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { error: 'Terjadi kesalahan server' });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * GET /logout - Destroy session
 */
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/login');
  });
});

module.exports = router;
