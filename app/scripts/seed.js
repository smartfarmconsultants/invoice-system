// Creates the three built-in accounts (admin, manager, clerk) with
// cryptographically random passwords. Passwords are:
//   1. generated fresh every run (never hardcoded in source)
//   2. hashed with bcrypt before being stored
//   3. printed ONCE to the terminal and written to a gitignored
//      credentials.txt so you can hand them to the right people
//   4. flagged must_change_password = true, forcing a reset on first login
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

function generatePassword(length = 16) {
  // Unambiguous charset (no 0/O, 1/l/I) so it's easy to read/type once.
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
  return Array.from(crypto.randomFillSync(new Uint32Array(length)))
    .map((n) => chars[n % chars.length])
    .join('');
}

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

    console.log(`Created/updated ${acct.role} account: ${acct.email}`);
  }

  const outPath = path.join(__dirname, '..', 'credentials.txt');
  fs.writeFileSync(outPath, lines.join('\n'), { mode: 0o600 });
  console.log(`\nPasswords written once to ${outPath} (gitignored).`);
  console.log('Share them securely with each user, then delete that file.');

  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
