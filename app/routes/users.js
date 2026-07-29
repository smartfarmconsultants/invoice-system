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

module.exports = router;
