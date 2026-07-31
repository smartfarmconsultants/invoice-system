const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/audit');
const { streamInvoicePdf } = require('../lib/pdf');
const { buildInvoiceReference } = require('../lib/invoiceReference');

const router = express.Router();

const COMPANY = {
  name: 'SmartFarm Consultants Kenya',
  address: 'smartfarmconsultants.co.ke',
  contact: 'Tel: +254 711 580 975 | smartfarmconsultants@gmail.com',
  paymentInstructions: 'Bank transfer — details on file. Paybill 400200, A/C 1183282. Contact +254 711 580 975 for assistance.'
};

const STATUSES = ['draft', 'sent', 'paid', 'overdue', 'void'];
const PAGE_SIZE = 15;

function canAccessInvoice(session, invoice) {
  if (['admin', 'manager'].includes(session.role)) return true;
  // clerks may only access invoices they created
  return invoice.created_by === session.userId;
}

// Recomputes subtotal/tax/total from posted line items. Prices are treated
// as VAT-inclusive (see note in the create/edit handlers below).
function computeTotals(items, taxRatePercent) {
  const rate = (Number(taxRatePercent) || 0) / 100;
  const grossTotal = items.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
  const tax = rate > 0 ? grossTotal - grossTotal / (1 + rate) : 0;
  const subtotal = grossTotal - tax;
  return { subtotal, tax, total: grossTotal };
}

function parseItemsFromBody(body) {
  const descs = [].concat(body.descriptions || []);
  const qtys = [].concat(body.quantities || []).map(Number);
  const prices = [].concat(body.unit_prices || []).map(Number);
  return descs
    .map((d, i) => ({ description: d, quantity: qtys[i] || 0, unit_price: prices[i] || 0 }))
    .filter((it) => it.description && it.quantity > 0);
}

router.get('/invoices', requireAuth, async (req, res) => {
  const isPrivileged = ['admin', 'manager'].includes(req.session.role);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const q = (req.query.q || '').trim();
  const statusFilter = STATUSES.includes(req.query.status) ? req.query.status : '';

  const conditions = [];
  const params = [];

  if (!isPrivileged) {
    params.push(req.session.userId);
    conditions.push(`i.created_by = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(i.invoice_number ILIKE $${params.length} OR c.customer_name ILIKE $${params.length})`);
  }
  if (statusFilter) {
    params.push(statusFilter);
    conditions.push(`i.status = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.query(
    `SELECT COUNT(*) FROM invoices i JOIN customers c ON c.id = i.customer_id ${whereClause}`,
    params
  );
  const totalCount = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  const listParams = [...params, PAGE_SIZE, offset];
  const { rows } = await db.query(
    `SELECT i.*, c.customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id
     ${whereClause} ORDER BY i.created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.render('invoices', {
    user: req.session,
    invoices: rows,
    csrfToken: req.csrfToken(),
    statuses: STATUSES,
    q,
    statusFilter,
    page,
    totalPages,
    totalCount
  });
});

router.get('/invoices/new', requireAuth, async (req, res) => {
  const { rows: customers } = await db.query('SELECT id, customer_name FROM customers ORDER BY customer_name ASC');
  res.render('invoice-form', { user: req.session, customers, csrfToken: req.csrfToken(), invoice: null, items: [] });
});

router.post('/invoices', requireAuth, async (req, res) => {
  const { customer_id, invoice_date, due_date, tax_rate } = req.body;
  const items = parseItemsFromBody(req.body);

  if (items.length === 0) return res.status(400).send('At least one line item is required.');

  // Unit prices are VAT-INCLUSIVE (e.g. an item priced at 1200 already contains
  // the 16% VAT — it is not added on top). "total" is simply the sum of the
  // line amounts as entered; "tax" is the VAT portion already baked into that
  // total, extracted for display/reporting.
  const { subtotal, tax, total } = computeTotals(items, tax_rate);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Insert first (invoice_number left NULL) so we know the row's id, then
    // assign a sequential INV-0001-style number derived from that id. This
    // keeps numbering gap-free and safely unique even under concurrent
    // writes, since it rides on Postgres's own id sequence rather than a
    // separately-maintained counter.
    const { rows } = await client.query(
      `INSERT INTO invoices (customer_id, invoice_date, due_date, subtotal, tax, total, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [customer_id, invoice_date, due_date || null, subtotal, tax, total, req.session.userId]
    );
    const invoiceId = rows[0].id;
    const invoiceNumber = `INV-${String(invoiceId).padStart(4, '0')}`;

    await client.query('UPDATE invoices SET invoice_number = $1 WHERE id = $2', [invoiceNumber, invoiceId]);

    for (const it of items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [invoiceId, it.description, it.quantity, it.unit_price, it.quantity * it.unit_price]
      );
    }
    await client.query('COMMIT');

    await logAction({
      userId: req.session.userId,
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: invoiceId,
      ip: req.ip,
      details: invoiceNumber
    });

    res.redirect(`/invoices/${invoiceId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Failed to create invoice.');
  } finally {
    client.release();
  }
});

router.get('/invoices/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT i.*, c.customer_name, c.email AS customer_email, c.address AS customer_address
     FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`,
    [req.params.id]
  );
  const invoice = rows[0];
  if (!invoice) return res.status(404).render('error', { message: 'Invoice not found.' });
  if (!canAccessInvoice(req.session, invoice)) {
    return res.status(403).render('error', { message: 'You do not have permission to view this invoice.' });
  }

  const { rows: items } = await db.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [invoice.id]);
  const reference = buildInvoiceReference(invoice);
  res.render('invoice-detail', { user: req.session, invoice, items, reference, statuses: STATUSES, csrfToken: req.csrfToken() });
});

// Admins/managers can edit any invoice's details (customer, dates, line
// items) and totals are recalculated from scratch — the invoice_number
// itself never changes once assigned.
router.get('/invoices/:id/edit', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
  const invoice = rows[0];
  if (!invoice) return res.status(404).render('error', { message: 'Invoice not found.' });

  const { rows: items } = await db.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [invoice.id]);
  const { rows: customers } = await db.query('SELECT id, customer_name FROM customers ORDER BY customer_name ASC');

  res.render('invoice-form', { user: req.session, customers, csrfToken: req.csrfToken(), invoice, items });
});

router.post('/invoices/:id/edit', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const { customer_id, invoice_date, due_date, tax_rate } = req.body;
  const items = parseItemsFromBody(req.body);

  if (items.length === 0) return res.status(400).send('At least one line item is required.');

  const { subtotal, tax, total } = computeTotals(items, tax_rate);
  const invoiceId = req.params.id;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rowCount } = await client.query(
      `UPDATE invoices SET customer_id = $1, invoice_date = $2, due_date = $3,
         subtotal = $4, tax = $5, total = $6, updated_at = NOW()
       WHERE id = $7`,
      [customer_id, invoice_date, due_date || null, subtotal, tax, total, invoiceId]
    );
    if (rowCount === 0) throw new Error('Invoice not found');

    await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoiceId]);
    for (const it of items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [invoiceId, it.description, it.quantity, it.unit_price, it.quantity * it.unit_price]
      );
    }
    await client.query('COMMIT');

    await logAction({
      userId: req.session.userId,
      action: 'invoice.edit',
      entityType: 'invoice',
      entityId: Number(invoiceId),
      ip: req.ip
    });

    res.redirect(`/invoices/${invoiceId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Failed to update invoice.');
  } finally {
    client.release();
  }
});

// Change an invoice's status (draft/sent/paid/overdue/void) — admins and
// managers only, since this is a financial/accounting action.
router.post('/invoices/:id/status', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).send('Invalid status.');

  const { rowCount } = await db.query(
    'UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, req.params.id]
  );
  if (rowCount === 0) return res.status(404).render('error', { message: 'Invoice not found.' });

  await logAction({
    userId: req.session.userId,
    action: 'invoice.status_change',
    entityType: 'invoice',
    entityId: Number(req.params.id),
    ip: req.ip,
    details: status
  });

  res.redirect(req.get('Referer') || '/invoices');
});

router.get('/invoices/:id/pdf', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT i.*, c.customer_name, c.email AS customer_email, c.address AS customer_address
     FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`,
    [req.params.id]
  );
  const invoice = rows[0];
  if (!invoice) return res.status(404).render('error', { message: 'Invoice not found.' });
  if (!canAccessInvoice(req.session, invoice)) {
    return res.status(403).render('error', { message: 'You do not have permission to export this invoice.' });
  }

  const { rows: items } = await db.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [invoice.id]);

  await logAction({
    userId: req.session.userId,
    action: 'invoice.pdf_export',
    entityType: 'invoice',
    entityId: invoice.id,
    ip: req.ip
  });

  streamInvoicePdf(res, invoice, items, COMPANY).catch((err) => {
    console.error('PDF generation failed:', err);
    if (!res.headersSent) res.status(500).send('Failed to generate PDF.');
  });
});

module.exports = router;
