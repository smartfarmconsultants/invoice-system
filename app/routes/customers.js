const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/audit');

const router = express.Router();

// All authenticated roles can view customers (per spec: manager "view customer records";
// clerks need this too to select a customer when creating an invoice).
router.get('/customers', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM customers ORDER BY customer_name ASC');
  res.render('customers', { user: req.session, customers: rows, csrfToken: req.csrfToken() });
});

// Creating/editing customer records — admin & manager only per access rules.
router.post('/customers', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const { customer_name, phone, email, address } = req.body;
  if (!customer_name) return res.status(400).send('Customer name is required.');

  const { rows } = await db.query(
    `INSERT INTO customers (customer_name, phone, email, address) VALUES ($1,$2,$3,$4) RETURNING id`,
    [customer_name, phone || null, email || null, address || null]
  );
  await logAction({
    userId: req.session.userId,
    action: 'customer.create',
    entityType: 'customer',
    entityId: rows[0].id,
    ip: req.ip
  });
  res.redirect('/customers');
});

module.exports = router;
