const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', requireAuth, async (req, res) => {
  const isPrivileged = ['admin', 'manager'].includes(req.session.role);

  const invoiceQuery = isPrivileged
    ? `SELECT i.*, c.customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id ORDER BY i.created_at DESC LIMIT 10`
    : `SELECT i.*, c.customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.created_by = $1 ORDER BY i.created_at DESC LIMIT 10`;
  const invoiceParams = isPrivileged ? [] : [req.session.userId];

  const totalsQuery = isPrivileged
    ? `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM invoices`
    : `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM invoices WHERE created_by = $1`;
  const totalsParams = isPrivileged ? [] : [req.session.userId];

  const [invoices, totals] = await Promise.all([
    db.query(invoiceQuery, invoiceParams),
    db.query(totalsQuery, totalsParams)
  ]);

  res.render('dashboard', {
    user: req.session,
    invoices: invoices.rows,
    totals: totals.rows[0]
  });
});

module.exports = router;
