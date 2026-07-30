// Creates the three built-in accounts (admin, manager, clerk) with
// cryptographically random passwords. Passwords are:
//   1. generated fresh every run (never hardcoded in source)
//   2. hashed with bcrypt before being stored
//   3. printed ONCE to the terminal and written to a gitignored
//      credentials.txt so you can hand them to the right people
//   4. flagged must_change_password = true, forcing a reset on first login
require('dotenv').config();
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { generatePassword } = require('../lib/password');

const ACCOUNTS = [
  {
    full_name: 'System Administrator',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@yourcompany.com',
    role: 'admin'
  },
  {
    full_name: 'Invoice Manager',
    email: process.env.SEED_MANAGER_EMAIL || 'manager@yourcompany.com',
    role: 'manager'
  },
  {
    full_name: 'Invoice Clerk',
    email: process.env.SEED_CLERK_EMAIL || 'clerk@yourcompany.com',
    role: 'clerk'
  }
];

async function main() {
  const lines = [
    'GENERATED LOGIN CREDENTIALS — distribute securely, then delete this file.',
    'Each account must change its password on first login.',
    ''
  ];

  console.log('\n================ GENERATED LOGIN CREDENTIALS ================');
  console.log('Copy these now — they will not be shown again.\n');

  for (const acct of ACCOUNTS) {
    const plainPassword = generatePassword();
    const hash = await bcrypt.hash(plainPassword, 12);

    await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, status, must_change_password)
       VALUES ($1, $2, $3, $4, TRUE, TRUE)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             must_change_password = TRUE`,
      [acct.full_name, acct.email, hash, acct.role]
    );

    lines.push(`Role: ${acct.role}`);
    lines.push(`Email: ${acct.email}`);
    lines.push(`Temporary password: ${plainPassword}`);
    lines.push('');

    console.log(`Role: ${acct.role}`);
    console.log(`Email: ${acct.email}`);
    console.log(`Temporary password: ${plainPassword}`);
    console.log('');
  }

  console.log('================================================================\n');

  // Also write to a local file, useful when running with shell/file access
  // (e.g. on your own machine). On hosts without shell access this file is
  // unreachable, which is why the credentials are also printed above.
  try {
    const outPath = path.join(__dirname, '..', 'credentials.txt');
    fs.writeFileSync(outPath, lines.join('\n'), { mode: 0o600 });
    console.log(`(Also written to ${outPath} where the filesystem is reachable.)`);
  } catch (err) {
    console.log('(Could not write credentials.txt in this environment — use the printed output above instead.)');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
