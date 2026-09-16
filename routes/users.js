const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

const router = express.Router();
const MIN_PASSWORD_LENGTH = 8;

function redirectWithMessage(path, type, message) {
  return `${path}?${type}=${encodeURIComponent(message)}`;
}

function validatePassword(password, confirmation) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password minimal ${MIN_PASSWORD_LENGTH} karakter`;
  }
  if (password.length > 128) {
    return 'Password maksimal 128 karakter';
  }
  if (password !== confirmation) {
    return 'Konfirmasi password tidak sama';
  }
  return null;
}

router.get('/users', isAuthenticated, isAdmin, async (req, res) => {
  let conn;

  try {
    conn = await pool.getConnection();
    const users = await conn.query(
      'SELECT id, username, full_name, role, created_at FROM users ORDER BY username'
    );

    res.render('users', {
      title: 'User Management',
      activePage: 'users',
      users,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error loading users:', error);
    res.render('users', {
      title: 'User Management',
      activePage: 'users',
      users: [],
      success: null,
      error: 'Gagal memuat data user'
    });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/users', isAuthenticated, isAdmin, async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const fullName = String(req.body.full_name || '').trim();
  const password = String(req.body.password || '');
  const passwordConfirmation = String(req.body.password_confirmation || '');
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  let conn;

  if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
    return res.redirect(redirectWithMessage('/users', 'error', 'Username harus 3-50 karakter dan hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda minus'));
  }
  if (fullName.length < 2 || fullName.length > 100) {
    return res.redirect(redirectWithMessage('/users', 'error', 'Nama lengkap harus 2-100 karakter'));
  }

  const passwordError = validatePassword(password, passwordConfirmation);
  if (passwordError) {
    return res.redirect(redirectWithMessage('/users', 'error', passwordError));
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    conn = await pool.getConnection();
    await conn.query(
      'INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)',
      [username, passwordHash, fullName, role]
    );

    res.redirect(redirectWithMessage('/users', 'success', `User ${username} berhasil ditambahkan`));
  } catch (error) {
    console.error('Error adding user:', error);
    const message = error.code === 'ER_DUP_ENTRY'
      ? 'Username sudah digunakan'
      : 'Gagal menambahkan user';
    res.redirect(redirectWithMessage('/users', 'error', message));
  } finally {
    if (conn) conn.release();
  }
});

router.post('/users/:id/password', isAuthenticated, isAdmin, async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  const password = String(req.body.password || '');
  const passwordConfirmation = String(req.body.password_confirmation || '');
  let conn;

  if (!Number.isInteger(userId) || userId < 1) {
    return res.redirect(redirectWithMessage('/users', 'error', 'User tidak valid'));
  }
  if (userId === Number(req.session.userId)) {
    return res.redirect(redirectWithMessage('/users', 'error', 'Gunakan menu Change Password untuk akun Anda sendiri'));
  }

  const passwordError = validatePassword(password, passwordConfirmation);
  if (passwordError) {
    return res.redirect(redirectWithMessage('/users', 'error', passwordError));
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    conn = await pool.getConnection();
    const result = await conn.query(
      'UPDATE users SET password = ? WHERE id = ?',
      [passwordHash, userId]
    );

    if (result.affectedRows === 0) {
      return res.redirect(redirectWithMessage('/users', 'error', 'User tidak ditemukan'));
    }

    res.redirect(redirectWithMessage('/users', 'success', 'Password user berhasil direset'));
  } catch (error) {
    console.error('Error resetting user password:', error);
    res.redirect(redirectWithMessage('/users', 'error', 'Gagal mereset password user'));
  } finally {
    if (conn) conn.release();
  }
});

router.get('/change-password', isAuthenticated, (req, res) => {
  res.render('change-password', {
    title: 'Change Password',
    activePage: 'change-password',
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/change-password', isAuthenticated, async (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const password = String(req.body.password || '');
  const passwordConfirmation = String(req.body.password_confirmation || '');
  let conn;

  const passwordError = validatePassword(password, passwordConfirmation);
  if (passwordError) {
    return res.redirect(redirectWithMessage('/change-password', 'error', passwordError));
  }

  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT password FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (rows.length === 0 || !(await bcrypt.compare(currentPassword, rows[0].password))) {
      return res.redirect(redirectWithMessage('/change-password', 'error', 'Password lama salah'));
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await conn.query(
      'UPDATE users SET password = ? WHERE id = ?',
      [passwordHash, req.session.userId]
    );

    res.redirect(redirectWithMessage('/change-password', 'success', 'Password berhasil diubah'));
  } catch (error) {
    console.error('Error changing password:', error);
    res.redirect(redirectWithMessage('/change-password', 'error', 'Gagal mengubah password'));
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
