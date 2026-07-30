const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/audit');

const router = express.Router();

function generatePassword(length = 16) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
  return Array.from(crypto.randomFillSync(new Uint32Array(length)))
    .map((n) => chars[n % chars.length])
    .join('');
}

router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await db.query('SELECT id, full_name, email, role, status, created_at FROM users ORDER BY created_at ASC');
  res.render('users', { user: req.session, users: rows, csrfToken: req.csrfToken(), newPassword: null });
});

// Admin creates a new user. A random temp password is generated and shown ONCE.
router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { full_name, email, role } = req.body;
  if (!full_name || !email || !['admin', 'manager', 'clerk'].includes(role)) {
    return res.status(400).send('Invalid input.');
  }

  const tempPassword = generatePassword();
  const hash = await bcrypt.hash(tempPassword, 12);

  await db.query(
    `INSERT INTO users (full_name, email, password_hash, role, status, must_change_password)
     VALUES ($1,$2,$3,$4,TRUE,TRUE)`,
    [full_name, email, hash, role]
  );

  await logAction({ userId: req.session.userId, action: 'user.create', entityType: 'user', ip: req.ip, details: email });

  const { rows } = await db.query('SELECT id, full_name, email, role, status, created_at FROM users ORDER BY created_at ASC');
  res.render('users', { user: req.session, users: rows, csrfToken: req.csrfToken(), newPassword: { email, tempPassword } });
});

router.post('/users/:id/disable', requireAuth, requireRole('admin'), async (req, res) => {
  await db.query('UPDATE users SET status = FALSE WHERE id = $1', [req.params.id]);
  await logAction({ userId: req.session.userId, action: 'user.disable', entityType: 'user', entityId: Number(req.params.id), ip: req.ip });
  res.redirect('/users');
});

router.post('/users/:id/enable', requireAuth, requireRole('admin'), async (req, res) => {
  await db.query('UPDATE users SET status = TRUE, failed_login_count = 0, locked_until = NULL WHERE id = $1', [req.params.id]);
  await logAction({ userId: req.session.userId, action: 'user.enable', entityType: 'user', entityId: Number(req.params.id), ip: req.ip });
  res.redirect('/users');
});

// Admin edits a user's name/email — does NOT touch the password.
router.post('/users/:id/edit', requireAuth, requireRole('admin'), async (req, res) => {
  const { full_name, email, role } = req.body;
  if (!full_name || !email || !['admin', 'manager', 'clerk'].includes(role)) {
    return res.status(400).send('Invalid input.');
  }
  await db.query('UPDATE users SET full_name = $1, email = $2, role = $3 WHERE id = $4', [
    full_name, email, role, req.params.id
  ]);
  await logAction({
    userId: req.session.userId,
    action: 'user.edit',
    entityType: 'user',
    entityId: Number(req.params.id),
    ip: req.ip,
    details: email
  });
  res.redirect('/users');
});

// Admin resets another user's password to a fresh random one, shown ONCE,
// and forces them to set their own password on next login.
router.post('/users/:id/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  const tempPassword = generatePassword();
  const hash = await bcrypt.hash(tempPassword, 12);

  const { rows } = await db.query(
    'UPDATE users SET password_hash = $1, must_change_password = TRUE, failed_login_count = 0, locked_until = NULL WHERE id = $2 RETURNING email',
    [hash, req.params.id]
  );
  if (rows.length === 0) return res.status(404).render('error', { message: 'User not found.' });

  await logAction({
    userId: req.session.userId,
    action: 'user.password_reset',
    entityType: 'user',
    entityId: Number(req.params.id),
    ip: req.ip
  });

  const { rows: users } = await db.query('SELECT id, full_name, email, role, status, created_at FROM users ORDER BY created_at ASC');
  res.render('users', {
    user: req.session,
    users,
    csrfToken: req.csrfToken(),
    newPassword: { email: rows[0].email, tempPassword }
  });
});

module.exports = router;
