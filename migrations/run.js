require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔄 Ejecutando migraciones...');
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(sql);
    console.log('✅ Migraciones completadas exitosamente.');
  } catch (err) {
    console.error('❌ Error en migraciones:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(() => process.exit(1));
