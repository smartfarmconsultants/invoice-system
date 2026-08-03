const db = require('./index');

async function getSettings() {
  const { rows } = await db.query('SELECT * FROM app_settings WHERE id = 1');
  // Should always exist (schema.sql inserts the default row), but fall
  // back gracefully rather than crashing if migrate hasn't been re-run yet.
  return (
    rows[0] || {
      company_name: 'SmartFarm Consultants Kenya',
      company_address: 'smartfarmconsultants.co.ke',
      company_contact: 'Tel: +254 711 580 975 | smartfarmconsultants@gmail.com',
      payment_instructions: 'Bank transfer — details on file. Paybill 400200, A/C 1183282.',
      default_tax_rate: 16
    }
  );
}

async function updateSettings({ companyName, companyAddress, companyContact, paymentInstructions, defaultTaxRate }) {
  await db.query(
    `UPDATE app_settings SET
       company_name = $1,
       company_address = $2,
       company_contact = $3,
       payment_instructions = $4,
       default_tax_rate = $5,
       updated_at = NOW()
     WHERE id = 1`,
    [companyName, companyAddress, companyContact, paymentInstructions, defaultTaxRate]
  );
}

module.exports = { getSettings, updateSettings };
