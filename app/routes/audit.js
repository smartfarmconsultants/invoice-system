const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const PAGE_SIZE = 30;

router.get('/audit-log', requireAuth, requireRole('admin'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const countResult = await db.query('SELECT COUNT(*) FROM audit_log');
  const totalCount = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const { rows } = await db.query(
    `SELECT a.*, u.full_name, u.email
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
    [PAGE_SIZE, offset]
  );

  res.render('audit-log', { user: req.session, entries: rows, page, totalPages, totalCount });
});

module.exports = router;
