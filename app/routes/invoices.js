const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../db/audit');
const { streamInvoicePdf } = require('../lib/pdf');
const { buildInvoiceReference } = require('../lib/invoiceReference');
const { toCsv } = require('../lib/csv');
const { getSettings } = require('../db/settings');

const router = express.Router();

function settingsToCompany(settings) {
  return {
    name: settings.company_name,
    address: settings.company_address,
    contact: settings.company_contact,
    paymentInstructions: settings.payment_instructions
  };
}

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

// Shared between the list view and the CSV export so filtering behaves
// identically in both places — exporting always matches what's on screen.
function buildInvoiceFilters(session, query) {
  const isPrivileged = ['admin', 'manager'].includes(session.role);
  const q = (query.q || '').trim();
  const statusFilter = STATUSES.includes(query.status) ? query.status : '';

  const conditions = [];
  const params = [];

  if (!isPrivileged) {
    params.push(session.userId);
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
  return { whereClause, params, q, statusFilter };
}

router.get('/invoices', requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const { whereClause, params, q, statusFilter } = buildInvoiceFilters(req.session, req.query);

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

// CSV export — respects the same search/status filters as the list view,
// so "export what I'm looking at" works as expected.
router.get('/invoices/export.csv', requireAuth, async (req, res) => {
  const { whereClause, params } = buildInvoiceFilters(req.session, req.query);

  const { rows } = await db.query(
    `SELECT i.*, c.customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id
     ${whereClause} ORDER BY i.created_at DESC`,
    params
  );

  const columns = [
    { label: 'Invoice Number', value: 'invoice_number' },
    { label: 'Customer', value: 'customer_name' },
    { label: 'Invoice Date', value: (r) => new Date(r.invoice_date).toISOString().slice(0, 10) },
    { label: 'Due Date', value: (r) => (r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : '') },
    { label: 'Status', value: 'status' },
    { label: 'Subtotal (excl. VAT)', value: (r) => Number(r.subtotal).toFixed(2) },
    { label: 'VAT', value: (r) => Number(r.tax).toFixed(2) },
    { label: 'Total (VAT inclusive)', value: (r) => Number(r.total).toFixed(2) },
    { label: 'Discount', value: (r) => Number(r.discount || 0).toFixed(2) },
    { label: 'Amount Due', value: (r) => Math.max(0, Number(r.total) - Number(r.discount || 0)).toFixed(2) },
    { label: 'Created At', value: (r) => new Date(r.created_at).toISOString() }
  ];

  await logAction({ userId: req.session.userId, action: 'invoice.export_csv', ip: req.ip });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(columns, rows));
});

router.get('/invoices/new', requireAuth, async (req, res) => {
  const { rows: customers } = await db.query('SELECT id, customer_name FROM customers ORDER BY customer_name ASC');
  const settings = await getSettings();
  res.render('invoice-form', {
    user: req.session,
    customers,
    csrfToken: req.csrfToken(),
    invoice: null,
    items: [],
    defaultTaxRate: Number(settings.default_tax_rate)
  });
});

router.post('/invoices', requireAuth, async (req, res) => {
  const { customer_id, invoice_date, due_date, tax_rate, discount } = req.body;
  const items = parseItemsFromBody(req.body);

  if (items.length === 0) return res.status(400).send('At least one line item is required.');

  // Unit prices are VAT-INCLUSIVE (e.g. an item priced at 1200 already contains
  // the 16% VAT — it is not added on top). "total" is simply the sum of the
  // line amounts as entered; "tax" is the VAT portion already baked into that
  // total, extracted for display/reporting. Discount is a flat KES amount
  // (not a percentage) deducted from the total to get the amount actually due.
  const { subtotal, tax, total } = computeTotals(items, tax_rate);
  const discountAmount = Math.max(0, Number(discount) || 0);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Insert first (invoice_number left NULL) so we know the row's id, then
    // assign a sequential INV-0001-style number derived from that id. This
    // keeps numbering gap-free and safely unique even under concurrent
    // writes, since it rides on Postgres's own id sequence rather than a
    // separately-maintained counter.
    const { rows } = await client.query(
      `INSERT INTO invoices (customer_id, invoice_date, due_date, subtotal, tax, total, discount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [customer_id, invoice_date, due_date || null, subtotal, tax, total, discountAmount, req.session.userId]
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
  const settings = await getSettings();

  res.render('invoice-form', {
    user: req.session,
    customers,
    csrfToken: req.csrfToken(),
    invoice,
    items,
    defaultTaxRate: Number(settings.default_tax_rate)
  });
});

router.post('/invoices/:id/edit', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const { customer_id, invoice_date, due_date, tax_rate, discount } = req.body;
  const items = parseItemsFromBody(req.body);

  if (items.length === 0) return res.status(400).send('At least one line item is required.');

  const { subtotal, tax, total } = computeTotals(items, tax_rate);
  const discountAmount = Math.max(0, Number(discount) || 0);
  const invoiceId = req.params.id;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rowCount } = await client.query(
      `UPDATE invoices SET customer_id = $1, invoice_date = $2, due_date = $3,
         subtotal = $4, tax = $5, total = $6, discount = $7, updated_at = NOW()
       WHERE id = $8`,
      [customer_id, invoice_date, due_date || null, subtotal, tax, total, discountAmount, invoiceId]
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

// Deleting an invoice is admin-only and irreversible — this is the
// exception to "admins and managers" for financial actions, since
// deletion (vs. voiding) actually erases the record rather than just
// marking its status.
router.post('/invoices/:id/delete', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await db.query('SELECT invoice_number FROM invoices WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).render('error', { message: 'Invoice not found.' });

  await db.query('DELETE FROM invoices WHERE id = $1', [req.params.id]); // invoice_items cascade-deletes

  await logAction({
    userId: req.session.userId,
    action: 'invoice.delete',
    entityType: 'invoice',
    entityId: Number(req.params.id),
    ip: req.ip,
    details: rows[0].invoice_number
  });

  res.redirect('/invoices');
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

  const settings = await getSettings();

  streamInvoicePdf(res, invoice, items, settingsToCompany(settings)).catch((err) => {
    console.error('PDF generation failed:', err);
    if (!res.headersSent) res.status(500).send('Failed to generate PDF.');
  });
});

module.exports = router;
