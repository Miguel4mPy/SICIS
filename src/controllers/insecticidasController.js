const pool = require('../../config/database');
const { auditLog } = require('../middleware/auth');
const { estadoVencimiento, formatearFecha } = require('../utils/helpers');

const TIPOS_USO_VALIDOS = ['focal', 'espacial', 'residual', 'larvicida'];

function normalizarTiposUso(valor) {
  const valores = Array.isArray(valor) ? valor : [valor];
  const tipos = valores.filter(t => TIPOS_USO_VALIDOS.includes(t));
  return [...new Set(tipos)];
}

async function getTiposUso(includeInactive = false) {
  const where = includeInactive ? '' : 'WHERE activo = true';
  const result = await pool.query(`
    SELECT codigo, nombre, activo, orden
    FROM tipos_uso_insecticida
    ${where}
    ORDER BY orden, nombre
  `);
  return result.rows;
}

async function getUnidadesMedida(includeInactive = false) {
  const where = includeInactive ? '' : 'WHERE activo = true';
  const result = await pool.query(`
    SELECT codigo, nombre, abreviatura, activo, orden
    FROM unidades_medida
    ${where}
    ORDER BY orden, nombre
  `);
  return result.rows;
}

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

exports.new = async (req, res) => {
  const [tiposUso, unidadesMedida] = await Promise.all([getTiposUso(), getUnidadesMedida()]);
  res.render('insecticidas/form', {
    title: 'Nuevo Insecticida',
    insecticida: {},
    tiposUso,
    unidadesMedida,
    errors: req.flash('error')
  });
};

exports.create = async (req, res) => {
  const { codigo, nombre, unidad_medida, descripcion } = req.body;
  const tipoUsos = normalizarTiposUso(req.body.tipo_usos || req.body.tipo_uso);
  if (!tipoUsos.length) {
    req.flash('error', 'Seleccione al menos un tipo de uso.');
    return res.redirect('/insecticidas/nuevo');
  }

  try {
    const r = await pool.query(
      'INSERT INTO insecticidas (codigo, nombre, tipo_uso, tipo_usos, unidad_medida, descripcion) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [codigo, nombre, tipoUsos[0], tipoUsos, unidad_medida, descripcion]
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
  const [tiposUso, unidadesMedida] = await Promise.all([getTiposUso(true), getUnidadesMedida(true)]);
  res.render('insecticidas/form', { title: 'Editar Insecticida', insecticida: ins.rows[0] || {}, tiposUso, unidadesMedida, errors: req.flash('error') });
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { codigo, nombre, unidad_medida, descripcion, activo } = req.body;
  const tipoUsos = normalizarTiposUso(req.body.tipo_usos || req.body.tipo_uso);
  if (!tipoUsos.length) {
    req.flash('error', 'Seleccione al menos un tipo de uso.');
    return res.redirect(`/insecticidas/${id}/editar`);
  }

  await pool.query('UPDATE insecticidas SET codigo=$1, nombre=$2, tipo_uso=$3, tipo_usos=$4, unidad_medida=$5, descripcion=$6, activo=$7 WHERE id=$8',
    [codigo, nombre, tipoUsos[0], tipoUsos, unidad_medida, descripcion, activo === 'on', id]);
  req.flash('success', 'Insecticida actualizado.');
  res.redirect('/insecticidas');
};

exports.delete = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const ins = await client.query('SELECT id, nombre FROM insecticidas WHERE id = $1 AND activo = true', [id]);
    if (!ins.rows[0]) throw new Error('Insecticida no encontrado o ya eliminado.');

    await client.query('UPDATE insecticidas SET activo = false WHERE id = $1', [id]);
    await client.query('UPDATE lotes SET activo = false WHERE insecticida_id = $1', [id]);
    await client.query('COMMIT');

    await auditLog(req, 'ELIMINAR_INSECTICIDA', 'insecticidas', id, ins.rows[0], { activo: false });
    req.flash('success', 'Insecticida eliminado. Sus lotes asociados tambien fueron desactivados.');
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.message || 'Error al eliminar insecticida.');
  } finally {
    client.release();
  }

  res.redirect('/insecticidas');
};

exports.tiposUsoIndex = async (req, res) => {
  const tiposUso = await getTiposUso(true);
  res.render('insecticidas/tipos-uso', {
    title: 'Tipos de Uso',
    tiposUso,
    success: req.flash('success'),
    error: req.flash('error')
  });
};

exports.tiposUsoUpdate = async (req, res) => {
  const { tipos = {} } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const codigo of TIPOS_USO_VALIDOS) {
      const item = tipos[codigo] || {};
      const nombre = String(item.nombre || '').trim();
      const orden = parseInt(item.orden, 10);
      if (!nombre) throw new Error('Todos los tipos de uso deben tener nombre.');
      await client.query(
        'UPDATE tipos_uso_insecticida SET nombre=$1, orden=$2, activo=$3 WHERE codigo=$4',
        [nombre, Number.isInteger(orden) ? orden : 0, item.activo === 'on', codigo]
      );
    }
    await client.query('COMMIT');
    await auditLog(req, 'EDITAR_TIPOS_USO_INSECTICIDA', 'tipos_uso_insecticida', null, null, req.body);
    req.flash('success', 'Tipos de uso actualizados.');
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.message || 'Error al actualizar tipos de uso.');
  } finally {
    client.release();
  }
  res.redirect('/tipos-uso');
};

exports.unidadesIndex = async (req, res) => {
  const unidades = await getUnidadesMedida(true);
  const usos = await pool.query(`
    SELECT unidad_medida, COUNT(*) as total
    FROM insecticidas
    GROUP BY unidad_medida
  `);
  const totalPorUnidad = Object.fromEntries(usos.rows.map(r => [r.unidad_medida, Number(r.total)]));

  res.render('insecticidas/unidades-medida', {
    title: 'Unidades de Medida',
    unidades,
    totalPorUnidad,
    success: req.flash('success'),
    error: req.flash('error')
  });
};

exports.unidadesCreate = async (req, res) => {
  const { codigo, nombre, abreviatura, orden } = req.body;
  try {
    const code = String(codigo || '').trim().toLowerCase();
    if (!code || !/^[a-z0-9_-]{1,20}$/.test(code)) {
      throw new Error('El codigo debe tener solo letras, numeros, guion o guion bajo.');
    }
    if (!String(nombre || '').trim() || !String(abreviatura || '').trim()) {
      throw new Error('Nombre y abreviatura son obligatorios.');
    }

    const r = await pool.query(`
      INSERT INTO unidades_medida (codigo, nombre, abreviatura, orden, activo)
      VALUES ($1, $2, $3, $4, true)
      RETURNING codigo
    `, [code, nombre.trim(), abreviatura.trim(), parseInt(orden, 10) || 0]);

    await auditLog(req, 'CREAR_UNIDAD_MEDIDA', 'unidades_medida', null, null, req.body);
    req.flash('success', `Unidad ${r.rows[0].codigo} creada.`);
  } catch (err) {
    req.flash('error', err.detail || err.message || 'Error al crear unidad de medida.');
  }
  res.redirect('/unidades-medida');
};

exports.unidadesUpdate = async (req, res) => {
  const { codigo } = req.params;
  const { nombre, abreviatura, orden, activo } = req.body;
  try {
    if (!String(nombre || '').trim() || !String(abreviatura || '').trim()) {
      throw new Error('Nombre y abreviatura son obligatorios.');
    }

    const old = await pool.query('SELECT * FROM unidades_medida WHERE codigo = $1', [codigo]);
    if (!old.rows[0]) throw new Error('Unidad de medida no encontrada.');

    await pool.query(`
      UPDATE unidades_medida
      SET nombre = $1, abreviatura = $2, orden = $3, activo = $4, updated_at = NOW()
      WHERE codigo = $5
    `, [nombre.trim(), abreviatura.trim(), parseInt(orden, 10) || 0, activo === 'on', codigo]);

    await auditLog(req, 'EDITAR_UNIDAD_MEDIDA', 'unidades_medida', null, old.rows[0], req.body);
    req.flash('success', 'Unidad de medida actualizada.');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar unidad de medida.');
  }
  res.redirect('/unidades-medida');
};

exports.unidadesDelete = async (req, res) => {
  const { codigo } = req.params;
  try {
    const old = await pool.query('SELECT * FROM unidades_medida WHERE codigo = $1', [codigo]);
    if (!old.rows[0]) throw new Error('Unidad de medida no encontrada.');

    await pool.query('UPDATE unidades_medida SET activo = false, updated_at = NOW() WHERE codigo = $1', [codigo]);
    await auditLog(req, 'ELIMINAR_UNIDAD_MEDIDA', 'unidades_medida', null, old.rows[0], { activo: false });
    req.flash('success', 'Unidad de medida desactivada.');
  } catch (err) {
    req.flash('error', err.message || 'Error al eliminar unidad de medida.');
  }
  res.redirect('/unidades-medida');
};

// LOTES
exports.lotesIndex = async (req, res) => {
  let { insecticida_id } = req.query;
  const insecticidas = await pool.query(`
    SELECT DISTINCT i.id, i.codigo, i.nombre
    FROM insecticidas i
    JOIN lotes l ON l.insecticida_id = i.id
    WHERE i.activo = true AND l.activo = true
    ORDER BY i.nombre
  `);

  const idsFiltro = new Set(insecticidas.rows.map(i => String(i.id)));
  if (insecticida_id && !idsFiltro.has(String(insecticida_id))) {
    insecticida_id = '';
  }

  let query = `
    SELECT l.*, i.nombre as insecticida_nombre, i.tipo_uso, i.tipo_usos, i.unidad_medida,
      COALESCE((SELECT SUM(s.cantidad) FROM stock s WHERE s.lote_id = l.id), 0) as stock_total
    FROM lotes l JOIN insecticidas i ON l.insecticida_id = i.id
  `;
  const params = [];
  const where = ['l.activo = true', 'i.activo = true'];
  if (insecticida_id) { where.push('l.insecticida_id = $1'); params.push(insecticida_id); }
  query += ` WHERE ${where.join(' AND ')}`;
  query += ' ORDER BY l.fecha_vencimiento, i.nombre';

  const lotes = await pool.query(query, params);

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
  const { codigo_lote, fecha_fabricacion, fecha_vencimiento, observaciones, activo } = req.body;
  await pool.query('UPDATE lotes SET codigo_lote=$1, fecha_fabricacion=$2, fecha_vencimiento=$3, observaciones=$4, activo=$5 WHERE id=$6',
    [codigo_lote, fecha_fabricacion || null, fecha_vencimiento, observaciones, activo === 'on', id]);
  req.flash('success', 'Lote actualizado.');
  res.redirect('/lotes');
};

exports.loteDelete = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const lote = await client.query('SELECT id, codigo_lote FROM lotes WHERE id = $1 AND activo = true', [id]);
    if (!lote.rows[0]) throw new Error('Lote no encontrado o ya eliminado.');

    await client.query('UPDATE lotes SET activo = false WHERE id = $1', [id]);
    await client.query('UPDATE stock SET cantidad = 0 WHERE lote_id = $1', [id]);
    await client.query('COMMIT');

    await auditLog(req, 'ELIMINAR_LOTE', 'lotes', id, lote.rows[0], { activo: false });
    req.flash('success', 'Lote eliminado.');
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.message || 'Error al eliminar lote.');
  } finally {
    client.release();
  }

  res.redirect('/lotes');
};
