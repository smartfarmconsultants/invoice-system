const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/audit');

const router = express.Router();

const PAGE_SIZE = 15;

// All authenticated roles can view customers (per spec: manager "view customer records";
// clerks need this too to select a customer when creating an invoice).
router.get('/customers', requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const q = (req.query.q || '').trim();

  const conditions = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(customer_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.query(`SELECT COUNT(*) FROM customers ${whereClause}`, params);
  const totalCount = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  const listParams = [...params, PAGE_SIZE, offset];
  const { rows } = await db.query(
    `SELECT * FROM customers ${whereClause} ORDER BY customer_name ASC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.render('customers', {
    user: req.session,
    customers: rows,
    csrfToken: req.csrfToken(),
    q,
    page,
    totalPages,
    totalCount
  });
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

router.post('/customers/:id/edit', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const { customer_name, phone, email, address } = req.body;
  if (!customer_name) return res.status(400).send('Customer name is required.');

  const { rowCount } = await db.query(
    `UPDATE customers SET customer_name = $1, phone = $2, email = $3, address = $4 WHERE id = $5`,
    [customer_name, phone || null, email || null, address || null, req.params.id]
  );
  if (rowCount === 0) return res.status(404).render('error', { message: 'Customer not found.' });

  await logAction({
    userId: req.session.userId,
    action: 'customer.edit',
    entityType: 'customer',
    entityId: Number(req.params.id),
    ip: req.ip
  });
  res.redirect('/customers');
});

router.post('/customers/:id/delete', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).render('error', { message: 'Customer not found.' });

    await logAction({
      userId: req.session.userId,
      action: 'customer.delete',
      entityType: 'customer',
      entityId: Number(req.params.id),
      ip: req.ip
    });
    res.redirect('/customers');
  } catch (err) {
    // Foreign key constraint — customer still has invoices referencing them.
    if (err.code === '23503') {
      return res.status(400).render('error', {
        message: 'This customer has existing invoices and cannot be deleted. Remove or reassign their invoices first.'
      });
    }
    console.error(err);
    res.status(500).render('error', { message: 'Failed to delete customer.' });
  }
});

module.exports = router;
