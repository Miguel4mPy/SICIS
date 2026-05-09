require('dotenv').config({ path: '../.env' });
const bcrypt = require('bcryptjs');
const pool = require('../config/database');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🌱 Cargando datos iniciales...');

    // Depósito Central
    const centralRes = await client.query(`
      INSERT INTO depositos (codigo, nombre, tipo, nivel, zona, departamento)
      VALUES ('DEP-OC-001', 'Suministro Oficina Central', 'oficina_central', 1, 'Central', 'Asunción')
      ON CONFLICT (codigo) DO NOTHING RETURNING id
    `);
    let centralId = centralRes.rows[0]?.id;
    if (!centralId) {
      const r = await client.query("SELECT id FROM depositos WHERE codigo='DEP-OC-001'");
      centralId = r.rows[0].id;
    }

    // 19 Depósitos Zona
    const zonas = [
      { codigo: 'DEP-ZN-001', nombre: 'Deposito Zona 1 - Central', dep: 'Central' },
      { codigo: 'DEP-ZN-002', nombre: 'Deposito Zona 2 - Cordillera', dep: 'Cordillera' },
      { codigo: 'DEP-ZN-003', nombre: 'Deposito Zona 3 - Guairá', dep: 'Guairá' },
      { codigo: 'DEP-ZN-004', nombre: 'Deposito Zona 4 - Caaguazú', dep: 'Caaguazú' },
      { codigo: 'DEP-ZN-005', nombre: 'Deposito Zona 5 - Caazapá', dep: 'Caazapá' },
      { codigo: 'DEP-ZN-006', nombre: 'Deposito Zona 6 - Itapúa', dep: 'Itapúa' },
      { codigo: 'DEP-ZN-007', nombre: 'Deposito Zona 7 - Misiones', dep: 'Misiones' },
      { codigo: 'DEP-ZN-008', nombre: 'Deposito Zona 8 - Paraguarí', dep: 'Paraguarí' },
      { codigo: 'DEP-ZN-009', nombre: 'Deposito Zona 9 - Alto Paraná', dep: 'Alto Paraná' },
      { codigo: 'DEP-ZN-010', nombre: 'Deposito Zona 10 - Central Sur', dep: 'Central' },
      { codigo: 'DEP-ZN-011', nombre: 'Deposito Zona 11 - Ñeembucú', dep: 'Ñeembucú' },
      { codigo: 'DEP-ZN-012', nombre: 'Deposito Zona 12 - Amambay', dep: 'Amambay' },
      { codigo: 'DEP-ZN-013', nombre: 'Deposito Zona 13 - Canindeyú', dep: 'Canindeyú' },
      { codigo: 'DEP-ZN-014', nombre: 'Deposito Zona 14 - Presidente Hayes', dep: 'Presidente Hayes' },
      { codigo: 'DEP-ZN-015', nombre: 'Deposito Zona 15 - Alto Paraguay', dep: 'Alto Paraguay' },
      { codigo: 'DEP-ZN-016', nombre: 'Deposito Zona 16 - Boquerón', dep: 'Boquerón' },
      { codigo: 'DEP-ZN-017', nombre: 'Deposito Zona 17 - San Pedro', dep: 'San Pedro' },
      { codigo: 'DEP-ZN-018', nombre: 'Deposito Zona 18 - Concepción', dep: 'Concepción' },
      { codigo: 'DEP-ZN-019', nombre: 'Deposito Zona 19 - Capital', dep: 'Asunción' },
    ];

    const zonaIds = [];
    for (const z of zonas) {
      const r = await client.query(`
        INSERT INTO depositos (codigo, nombre, tipo, nivel, deposito_padre_id, zona, departamento)
        VALUES ($1, $2, 'zona', 2, $3, $4, $5)
        ON CONFLICT (codigo) DO NOTHING RETURNING id
      `, [z.codigo, z.nombre, centralId, z.dep, z.dep]);
      let id = r.rows[0]?.id;
      if (!id) {
        const x = await client.query('SELECT id FROM depositos WHERE codigo=$1', [z.codigo]);
        id = x.rows[0].id;
      }
      zonaIds.push(id);
    }

    // Sectores para las primeras 3 zonas como ejemplo
    const sectores = [
      { codigo: 'DEP-SC-001', nombre: 'Deposito Sector 1 - Luque', zona_idx: 0, dep: 'Central' },
      { codigo: 'DEP-SC-002', nombre: 'Deposito Sector 2 - San Lorenzo', zona_idx: 0, dep: 'Central' },
      { codigo: 'DEP-SC-003', nombre: 'Deposito Sector 3 - Caacupé', zona_idx: 1, dep: 'Cordillera' },
      { codigo: 'DEP-SC-004', nombre: 'Deposito Sector 4 - Villarrica', zona_idx: 2, dep: 'Guairá' },
      { codigo: 'DEP-SC-005', nombre: 'Deposito Sector 5 - Coronel Oviedo', zona_idx: 3, dep: 'Caaguazú' },
    ];

    for (const s of sectores) {
      await client.query(`
        INSERT INTO depositos (codigo, nombre, tipo, nivel, deposito_padre_id, zona, departamento)
        VALUES ($1, $2, 'sector', 3, $3, $4, $5)
        ON CONFLICT (codigo) DO NOTHING
      `, [s.codigo, s.nombre, zonaIds[s.zona_idx], s.dep, s.dep]);
    }

    // Insecticidas
    const insecticidas = [
      { codigo: 'INS-FOC-001', nombre: 'Malathion 57% CE', tipos: ['focal'], unidad: 'litro' },
      { codigo: 'INS-ESP-001', nombre: 'Cipermetrina 25% CE', tipos: ['espacial'], unidad: 'litro' },
      { codigo: 'INS-ESP-002', nombre: 'Deltametrina 5% CE', tipos: ['espacial', 'focal'], unidad: 'litro' },
      { codigo: 'INS-RES-001', nombre: 'Lambda-Cihalotrina 10% CE', tipos: ['residual'], unidad: 'litro' },
      { codigo: 'INS-RES-002', nombre: 'Bifentrina 10% CE', tipos: ['residual'], unidad: 'litro' },
      { codigo: 'INS-LAR-001', nombre: 'Temefos 1% GR', tipos: ['larvicida'], unidad: 'kg' },
      { codigo: 'INS-LAR-002', nombre: 'Bacillus thuringiensis H-14', tipos: ['larvicida'], unidad: 'litro' },
      { codigo: 'INS-FOC-002', nombre: 'Sumithion 50% CE', tipos: ['focal'], unidad: 'litro' },
    ];

    for (const ins of insecticidas) {
      await client.query(`
        INSERT INTO insecticidas (codigo, nombre, tipo_uso, tipo_usos, unidad_medida)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (codigo) DO NOTHING
      `, [ins.codigo, ins.nombre, ins.tipos[0], ins.tipos, ins.unidad]);
    }

    // Lotes
    const lotes = [
      { codigo: 'LOT-2024-001', ins_codigo: 'INS-FOC-001', vence: '2026-12-31' },
      { codigo: 'LOT-2024-002', ins_codigo: 'INS-ESP-001', vence: '2026-06-30' },
      { codigo: 'LOT-2024-003', ins_codigo: 'INS-ESP-002', vence: '2027-03-31' },
      { codigo: 'LOT-2024-004', ins_codigo: 'INS-RES-001', vence: '2026-09-30' },
      { codigo: 'LOT-2024-005', ins_codigo: 'INS-LAR-001', vence: '2026-12-31' },
      { codigo: 'LOT-2025-001', ins_codigo: 'INS-FOC-001', vence: '2027-06-30' },
      { codigo: 'LOT-2025-002', ins_codigo: 'INS-ESP-001', vence: '2027-12-31' },
    ];

    for (const lote of lotes) {
      const insRes = await client.query('SELECT id FROM insecticidas WHERE codigo=$1', [lote.ins_codigo]);
      if (insRes.rows.length > 0) {
        await client.query(`
          INSERT INTO lotes (codigo_lote, insecticida_id, fecha_vencimiento)
          VALUES ($1, $2, $3) ON CONFLICT ON CONSTRAINT lotes_insecticida_codigo_lote_key DO NOTHING
        `, [lote.codigo, insRes.rows[0].id, lote.vence]);
      }
    }

    // Usuario Admin
    const adminHash = await bcrypt.hash('Admin@SICIS2025!', 12);
    await client.query(`
      INSERT INTO usuarios (nombre, apellido, email, password_hash, rol)
      VALUES ('Administrador', 'Sistema', 'admin@senepa.gov.py', $1, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash]);

    // Usuario Gerente
    const gerenteHash = await bcrypt.hash('Gerente@SICIS2025!', 12);
    await client.query(`
      INSERT INTO usuarios (nombre, apellido, email, password_hash, rol)
      VALUES ('Juan', 'Pérez', 'gerente@senepa.gov.py', $1, 'gerente')
      ON CONFLICT (email) DO NOTHING
    `, [gerenteHash]);


    // Usuario Encargado
    const encargadoHash = await bcrypt.hash('Encargado@SICIS2025!', 12);
    const encRes = await client.query(`
      INSERT INTO usuarios (nombre, apellido, email, password_hash, rol)
      VALUES ('Carlos', 'Encargado', 'encargado@senepa.gov.py', $1, 'encargado')
      ON CONFLICT (email) DO NOTHING RETURNING id
    `, [encargadoHash]);

    if (encRes.rows[0]?.id && zonaIds[0]) {
      await client.query(
        'UPDATE usuario_depositos SET es_responsable = false WHERE deposito_id = $1 AND es_responsable = true',
        [zonaIds[0]]
      );
      await client.query(`
        INSERT INTO usuario_depositos (usuario_id, deposito_id, es_responsable)
        VALUES ($1, $2, true)
        ON CONFLICT (usuario_id, deposito_id) DO UPDATE SET es_responsable = true
      `, [encRes.rows[0].id, zonaIds[0]]);
      await client.query(
        "UPDATE depositos SET responsable_nombre = 'Carlos Encargado' WHERE id = $1",
        [zonaIds[0]]
      );
    }

    await client.query('COMMIT');
    console.log('✅ Datos iniciales cargados exitosamente.');
    console.log('\n📋 Credenciales de acceso:');
    console.log('   Admin:    admin@senepa.gov.py    / Admin@SICIS2025!');
    console.log('   Gerente:  gerente@senepa.gov.py  / Gerente@SICIS2025!');
    console.log('   Encargado: encargado@senepa.gov.py / Encargado@SICIS2025!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en seeds:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));

