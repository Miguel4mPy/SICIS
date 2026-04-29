const pool = require('../../config/database');
const { auditLog } = require('../middleware/auth');
const { tipoDepositoLabel } = require('../utils/helpers');

exports.index = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, dp.nombre as padre_nombre,
        (SELECT COUNT(*) FROM depositos WHERE deposito_padre_id = d.id) as hijos_count,
        (SELECT COALESCE(SUM(s.cantidad), 0) FROM stock s WHERE s.deposito_id = d.id) as total_stock
      FROM depositos d
      LEFT JOIN depositos dp ON d.deposito_padre_id = dp.id
      ORDER BY d.nivel, d.nombre
    `);

    res.render('depositos/index', {
      title: 'Depósitos',
      depositos: result.rows,
      tipoDepositoLabel,
      success: req.flash('success'),
      error: req.flash('error')
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error al cargar depósitos.');
    res.redirect('/dashboard');
  }
};

exports.new = async (req, res) => {
  const padresRes = await pool.query("SELECT id, codigo, nombre, nivel FROM depositos WHERE nivel < 3 AND activo = true ORDER BY nivel, nombre");
  res.render('depositos/form', {
    title: 'Nuevo Depósito',
    deposito: {},
    padres: padresRes.rows,
    tipoDepositoLabel,
    errors: req.flash('error')
  });
};

exports.create = async (req, res) => {
  const { codigo, nombre, tipo, nivel, deposito_padre_id, zona, departamento, direccion, responsable_nombre } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO depositos (codigo, nombre, tipo, nivel, deposito_padre_id, zona, departamento, direccion, responsable_nombre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [codigo, nombre, tipo, nivel, deposito_padre_id || null, zona, departamento, direccion, responsable_nombre]
    );
    await auditLog(req, 'CREAR_DEPOSITO', 'depositos', result.rows[0].id, null, req.body);
    req.flash('success', 'Depósito creado exitosamente.');
    res.redirect('/depositos');
  } catch (err) {
    console.error(err);
    req.flash('error', err.detail || 'Error al crear depósito.');
    res.redirect('/depositos/nuevo');
  }
};

exports.show = async (req, res) => {
  const { id } = req.params;
  try {
    const dep = await pool.query(`
      SELECT d.*, dp.nombre as padre_nombre FROM depositos d
      LEFT JOIN depositos dp ON d.deposito_padre_id = dp.id WHERE d.id = $1
    `, [id]);
    if (!dep.rows[0]) { req.flash('error', 'Depósito no encontrado.'); return res.redirect('/depositos'); }

    const hijos = await pool.query('SELECT * FROM depositos WHERE deposito_padre_id = $1 AND activo = true ORDER BY nombre', [id]);

    const stock = await pool.query(`
      SELECT s.cantidad, i.nombre as insecticida_nombre, i.tipo_uso, i.unidad_medida,
        l.codigo_lote, l.fecha_vencimiento, ins.id as insecticida_id
      FROM stock s
      JOIN lotes l ON s.lote_id = l.id
      JOIN insecticidas ins ON l.insecticida_id = ins.id
      JOIN insecticidas i ON ins.id = i.id
      WHERE s.deposito_id = $1 AND s.cantidad > 0
      ORDER BY i.nombre, l.fecha_vencimiento
    `, [id]);

    const movimientos = await pool.query(`
      SELECT m.*, i.nombre as insecticida_nombre, l.codigo_lote,
        dor.nombre as origen_nombre, dde.nombre as destino_nombre,
        u.nombre || ' ' || u.apellido as usuario_nombre
      FROM movimientos m
      JOIN insecticidas i ON m.insecticida_id = i.id
      JOIN lotes l ON m.lote_id = l.id
      LEFT JOIN depositos dor ON m.deposito_origen_id = dor.id
      LEFT JOIN depositos dde ON m.deposito_destino_id = dde.id
      JOIN usuarios u ON m.usuario_id = u.id
      WHERE (m.deposito_origen_id = $1 OR m.deposito_destino_id = $1) AND m.estado != 'anulado'
      ORDER BY m.fecha_movimiento DESC LIMIT 20
    `, [id]);

    res.render('depositos/show', {
      title: dep.rows[0].nombre,
      deposito: dep.rows[0],
      hijos: hijos.rows,
      stock: stock.rows,
      movimientos: movimientos.rows,
      tipoDepositoLabel
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error al cargar depósito.');
    res.redirect('/depositos');
  }
};

exports.edit = async (req, res) => {
  const { id } = req.params;
  const dep = await pool.query('SELECT * FROM depositos WHERE id = $1', [id]);
  const padres = await pool.query("SELECT id, codigo, nombre, nivel FROM depositos WHERE nivel < 3 AND activo = true AND id != $1 ORDER BY nivel, nombre", [id]);
  res.render('depositos/form', {
    title: 'Editar Depósito',
    deposito: dep.rows[0] || {},
    padres: padres.rows,
    tipoDepositoLabel,
    errors: req.flash('error')
  });
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { nombre, tipo, nivel, deposito_padre_id, zona, departamento, direccion, responsable_nombre, activo } = req.body;
  try {
    await pool.query(
      `UPDATE depositos SET nombre=$1, tipo=$2, nivel=$3, deposito_padre_id=$4, zona=$5, departamento=$6, direccion=$7, responsable_nombre=$8, activo=$9
       WHERE id=$10`,
      [nombre, tipo, nivel, deposito_padre_id || null, zona, departamento, direccion, responsable_nombre, activo === 'on', id]
    );
    await auditLog(req, 'EDITAR_DEPOSITO', 'depositos', id, null, req.body);
    req.flash('success', 'Depósito actualizado.');
    res.redirect('/depositos');
  } catch (err) {
    req.flash('error', 'Error al actualizar depósito.');
    res.redirect(`/depositos/${id}/editar`);
  }
};

exports.getArbol = async (req, res) => {
  const deps = await pool.query('SELECT * FROM depositos WHERE activo = true ORDER BY nivel, nombre');
  res.render('depositos/arbol', {
    title: 'Árbol de Depósitos',
    depositos: deps.rows,
    tipoDepositoLabel
  });
};
