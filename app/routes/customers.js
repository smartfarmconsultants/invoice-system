const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/audit');
const { toCsv } = require('../lib/csv');

const router = express.Router();

const PAGE_SIZE = 15;

function buildCustomerFilters(query) {
  const q = (query.q || '').trim();
  const conditions = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(customer_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params, q };
}

// All authenticated roles can view customers (per spec: manager "view customer records";
// clerks need this too to select a customer when creating an invoice).
router.get('/customers', requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const { whereClause, params, q } = buildCustomerFilters(req.query);

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

// CSV export — respects the same search filter as the list view.
router.get('/customers/export.csv', requireAuth, async (req, res) => {
  const { whereClause, params } = buildCustomerFilters(req.query);
  const { rows } = await db.query(`SELECT * FROM customers ${whereClause} ORDER BY customer_name ASC`, params);

  const columns = [
    { label: 'Name', value: 'customer_name' },
    { label: 'Phone', value: (r) => r.phone || '' },
    { label: 'Email', value: (r) => r.email || '' },
    { label: 'Address', value: (r) => r.address || '' },
    { label: 'Created At', value: (r) => new Date(r.created_at).toISOString() }
  ];

  await logAction({ userId: req.session.userId, action: 'customer.export_csv', ip: req.ip });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(columns, rows));
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
