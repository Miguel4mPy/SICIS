const pool = require('../../config/database');

async function logSystemEvent(nivel, origen, mensaje, metadata = null, req = null) {
  try {
    await pool.query(`
      INSERT INTO system_logs (nivel, origen, mensaje, metadata, usuario_id, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      nivel || 'info',
      origen || 'server',
      mensaje || 'Evento sin mensaje',
      metadata ? JSON.stringify(metadata) : null,
      req?.session?.userId || null,
      req?.ip || null,
      req?.get ? req.get('user-agent') : null
    ]);
  } catch (err) {
    console.error('Error registrando system log:', err.message);
  }
}

module.exports = { logSystemEvent };
