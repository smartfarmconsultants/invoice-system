const db = require('./index');

async function logAction({ userId, action, entityType = null, entityId = null, ip = null, details = null }) {
  await db.query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, action, entityType, entityId, ip, details]
  );
}

module.exports = { logAction };
