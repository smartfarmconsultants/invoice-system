// Clears out invoice/customer/audit test data while KEEPING your user
// accounts intact (so you don't have to re-seed logins). Run this once,
// right before you start entering real customers and invoices.
//
// Usage:  npm run clear-test-data
require('dotenv').config();
const readline = require('readline');
const { pool } = require('../db');

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const ok = await confirm(
    'This will permanently delete ALL invoices, invoice items, customers, and audit\n' +
    'log entries — but will KEEP your user accounts/logins. This cannot be undone.\n' +
    'Type "yes" to continue: '
  );

  if (!ok) {
    console.log('Cancelled — nothing was deleted.');
    await pool.end();
    return;
  }

  await pool.query('DELETE FROM invoice_items');
  await pool.query('DELETE FROM invoices');
  await pool.query('DELETE FROM customers');
  await pool.query('DELETE FROM audit_log');

  console.log('Done. Invoices, customers, and audit log are cleared. User accounts were left untouched.');
  await pool.end();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
