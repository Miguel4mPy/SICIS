const pool = require('../../config/database');
const { auditLog } = require('../middleware/auth');
const { estadoVencimiento, formatearFecha } = require('../utils/helpers');

exports.index = async (req, res) => {
  const insecticidas = await pool.query(`
    SELECT i.*,
      (SELECT COUNT(*) FROM lotes WHERE insecticida_id = i.id AND activo = true) as total_lotes,
      (SELECT COALESCE(SUM(s.cantidad), 0) FROM stock s JOIN lotes l ON s.lote_id = l.id WHERE l.insecticida_id = i.id) as stock_total
    FROM insecticidas i ORDER BY i.tipo_uso, i.nombre
  `);
  res.render('insecticidas/index', {
    title: 'Insecticidas',
    insecticidas: insecticidas.rows,
    success: req.flash('success'),
    error: req.flash('error')
  });
};

exports.new = (req, res) => {
  res.render('insecticidas/form', {
    title: 'Nuevo Insecticida',
    insecticida: {},
    errors: req.flash('error')
  });
};

exports.create = async (req, res) => {
  const { codigo, nombre, tipo_uso, unidad_medida, descripcion } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO insecticidas (codigo, nombre, tipo_uso, unidad_medida, descripcion) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [codigo, nombre, tipo_uso, unidad_medida, descripcion]
    );
    await auditLog(req, 'CREAR_INSECTICIDA', 'insecticidas', r.rows[0].id, null, req.body);
    req.flash('success', 'Insecticida creado exitosamente.');
    res.redirect('/insecticidas');
  } catch (err) {
    req.flash('error', err.detail || 'Error al crear insecticida.');
    res.redirect('/insecticidas/nuevo');
  }
};

exports.show = async (req, res) => {
  const { id } = req.params;
  const ins = await pool.query('SELECT * FROM insecticidas WHERE id = $1', [id]);
  if (!ins.rows[0]) { req.flash('error', 'No encontrado.'); return res.redirect('/insecticidas'); }

  const lotes = await pool.query(`
    SELECT l.*,
      COALESCE((SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id = l.id), 0) as stock_total
    FROM lotes l WHERE l.insecticida_id = $1 ORDER BY l.fecha_vencimiento
  `, [id]);

  res.render('insecticidas/show', {
    title: ins.rows[0].nombre,
    insecticida: ins.rows[0],
    lotes: lotes.rows.map(l => ({ ...l, estadoVenc: estadoVencimiento(l.fecha_vencimiento) })),
    formatearFecha,
    estadoVencimiento
  });
};

exports.edit = async (req, res) => {
  const ins = await pool.query('SELECT * FROM insecticidas WHERE id = $1', [req.params.id]);
  res.render('insecticidas/form', { title: 'Editar Insecticida', insecticida: ins.rows[0] || {}, errors: req.flash('error') });
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { nombre, tipo_uso, unidad_medida, descripcion, activo } = req.body;
  await pool.query('UPDATE insecticidas SET nombre=$1, tipo_uso=$2, unidad_medida=$3, descripcion=$4, activo=$5 WHERE id=$6',
    [nombre, tipo_uso, unidad_medida, descripcion, activo === 'on', id]);
  req.flash('success', 'Insecticida actualizado.');
  res.redirect('/insecticidas');
};

// LOTES
exports.lotesIndex = async (req, res) => {
  const { insecticida_id } = req.query;
  let query = `
    SELECT l.*, i.nombre as insecticida_nombre, i.tipo_uso, i.unidad_medida,
      COALESCE((SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id = l.id), 0) as stock_total
    FROM lotes l JOIN insecticidas i ON l.insecticida_id = i.id
  `;
  const params = [];
  if (insecticida_id) { query += ' WHERE l.insecticida_id = $1'; params.push(insecticida_id); }
  query += ' ORDER BY l.fecha_vencimiento, i.nombre';

  const lotes = await pool.query(query, params);
  const insecticidas = await pool.query('SELECT id, codigo, nombre FROM insecticidas WHERE activo = true ORDER BY nombre');

  res.render('lotes/index', {
    title: 'Lotes de Insecticidas',
    lotes: lotes.rows.map(l => ({ ...l, estadoVenc: estadoVencimiento(l.fecha_vencimiento) })),
    insecticidas: insecticidas.rows,
    filtros: { insecticida_id },
    formatearFecha,
    success: req.flash('success'),
    error: req.flash('error')
  });
};

exports.loteNew = async (req, res) => {
  const insecticidas = await pool.query('SELECT id, codigo, nombre FROM insecticidas WHERE activo = true ORDER BY nombre');
  res.render('lotes/form', {
    title: 'Nuevo Lote',
    lote: {},
    insecticidas: insecticidas.rows,
    errors: req.flash('error')
  });
};

exports.loteCreate = async (req, res) => {
  const { codigo_lote, insecticida_id, fecha_fabricacion, fecha_vencimiento, cantidad_inicial, observaciones } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'INSERT INTO lotes (codigo_lote, insecticida_id, fecha_fabricacion, fecha_vencimiento, cantidad_inicial, observaciones) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [codigo_lote, insecticida_id, fecha_fabricacion || null, fecha_vencimiento, parseFloat(cantidad_inicial), observaciones]
    );
    await client.query('COMMIT');
    await auditLog(req, 'CREAR_LOTE', 'lotes', r.rows[0].id, null, req.body);
    req.flash('success', 'Lote creado exitosamente.');
    res.redirect('/lotes');
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.detail || 'Error al crear lote.');
    res.redirect('/lotes/nuevo');
  } finally {
    client.release();
  }
};

exports.loteEdit = async (req, res) => {
  const lote = await pool.query('SELECT * FROM lotes WHERE id=$1', [req.params.id]);
  const insecticidas = await pool.query('SELECT id, codigo, nombre FROM insecticidas WHERE activo = true ORDER BY nombre');
  res.render('lotes/form', { title: 'Editar Lote', lote: lote.rows[0] || {}, insecticidas: insecticidas.rows, errors: req.flash('error') });
};

exports.loteUpdate = async (req, res) => {
  const { id } = req.params;
  const { fecha_fabricacion, fecha_vencimiento, observaciones, activo } = req.body;
  await pool.query('UPDATE lotes SET fecha_fabricacion=$1, fecha_vencimiento=$2, observaciones=$3, activo=$4 WHERE id=$5',
    [fecha_fabricacion || null, fecha_vencimiento, observaciones, activo === 'on', id]);
  req.flash('success', 'Lote actualizado.');
  res.redirect('/lotes');
};
