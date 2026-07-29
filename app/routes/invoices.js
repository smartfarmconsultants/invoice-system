const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logAction } = require('../db/audit');
const { streamInvoicePdf } = require('../lib/pdf');

const router = express.Router();

const COMPANY = {
  name: 'SmartFarm Consultants Kenya',
  address: 'smartfarmconsultants.co.ke',
  contact: 'Tel: +254 711 580 975 | smartfarmconsultants@gmail.com',
  paymentInstructions: 'Bank transfer — details on file. Paybill 400200, A/C 1183282. Contact +254 711 580 975 for assistance.'
};

function canAccessInvoice(session, invoice) {
  if (['admin', 'manager'].includes(session.role)) return true;
  // clerks may only access invoices they created
  return invoice.created_by === session.userId;
}

router.get('/invoices', requireAuth, async (req, res) => {
  const isPrivileged = ['admin', 'manager'].includes(req.session.role);
  const query = isPrivileged
    ? `SELECT i.*, c.customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id ORDER BY i.created_at DESC`
    : `SELECT i.*, c.customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.created_by = $1 ORDER BY i.created_at DESC`;
  const params = isPrivileged ? [] : [req.session.userId];
  const { rows } = await db.query(query, params);
  res.render('invoices', { user: req.session, invoices: rows });
});

router.get('/invoices/new', requireAuth, async (req, res) => {
  const { rows: customers } = await db.query('SELECT id, customer_name FROM customers ORDER BY customer_name ASC');
  res.render('invoice-form', { user: req.session, customers, csrfToken: req.csrfToken() });
});

router.post('/invoices', requireAuth, async (req, res) => {
  const { customer_id, invoice_date, due_date, tax_rate, descriptions, quantities, unit_prices } = req.body;

  const descs = [].concat(descriptions || []);
  const qtys = [].concat(quantities || []).map(Number);
  const prices = [].concat(unit_prices || []).map(Number);

  const items = descs
    .map((d, i) => ({ description: d, quantity: qtys[i] || 0, unit_price: prices[i] || 0 }))
    .filter((it) => it.description && it.quantity > 0);

  if (items.length === 0) return res.status(400).send('At least one line item is required.');

  // Unit prices are VAT-INCLUSIVE (e.g. an item priced at 1200 already contains
  // the 16% VAT — it is not added on top). "total" is simply the sum of the
  // line amounts as entered; "tax" is the VAT portion already baked into that
  // total, extracted for display/reporting: vat = gross - gross / (1 + rate/100).
  const rate = (Number(tax_rate) || 0) / 100;
  const grossTotal = items.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
  const tax = rate > 0 ? grossTotal - grossTotal / (1 + rate) : 0;
  const subtotal = grossTotal - tax; // net (VAT-exclusive) amount
  const total = grossTotal;
  const invoiceNumber = `INV-${Date.now()}`;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO invoices (invoice_number, customer_id, invoice_date, due_date, subtotal, tax, total, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [invoiceNumber, customer_id, invoice_date, due_date || null, subtotal, tax, total, req.session.userId]
    );
    const invoiceId = rows[0].id;

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
  res.render('invoice-detail', { user: req.session, invoice, items });
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
