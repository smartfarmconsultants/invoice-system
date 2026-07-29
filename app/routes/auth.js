const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { logAction } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { error: null, csrfToken: req.csrfToken() });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];

    if (!user || !user.status) {
      await logAction({ userId: null, action: 'login.failed', ip, details: `email=${email}` });
      return res.render('login', { error: 'Invalid email or password.', csrfToken: req.csrfToken() });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.render('login', {
        error: 'This account is temporarily locked due to failed login attempts. Try again later.',
        csrfToken: req.csrfToken()
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      const attempts = (user.failed_login_count || 0) + 1;
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await db.query(
        'UPDATE users SET failed_login_count = $1, locked_until = $2 WHERE id = $3',
        [attempts, lockUntil, user.id]
      );
      await logAction({ userId: user.id, action: 'login.failed', ip });
      return res.render('login', { error: 'Invalid email or password.', csrfToken: req.csrfToken() });
    }

    // success — reset failed attempts, establish session
    await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);

    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.fullName = user.full_name;
    req.session.mustChangePassword = user.must_change_password;

    await logAction({ userId: user.id, action: 'login.success', ip });

    if (user.must_change_password) return res.redirect('/change-password');
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Something went wrong. Please try again.', csrfToken: req.csrfToken() });
  }
});

router.get('/change-password', requireAuth, (req, res) => {
  res.render('change-password', { error: null, csrfToken: req.csrfToken() });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { newPassword, confirmPassword } = req.body;

  if (!newPassword || newPassword.length < 10) {
    return res.render('change-password', {
      error: 'Password must be at least 10 characters.',
      csrfToken: req.csrfToken()
    });
  }
  if (newPassword !== confirmPassword) {
    return res.render('change-password', {
      error: 'Passwords do not match.',
      csrfToken: req.csrfToken()
    });
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await db.query(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
    [hash, req.session.userId]
  );
  req.session.mustChangePassword = false;
  await logAction({ userId: req.session.userId, action: 'password.changed', ip: req.ip });

  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// TODO: optional 2FA — add TOTP enrollment/verification here (e.g. with `otplib`)
// before completing login, gated behind a `users.totp_secret` column.

module.exports = router;
