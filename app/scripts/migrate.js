// Applies db/schema.sql to the configured PostgreSQL database.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Migration complete: tables created/verified.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
