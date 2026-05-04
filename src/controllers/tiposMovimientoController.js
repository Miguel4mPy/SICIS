const pool = require('../../config/database');
const { auditLog } = require('../middleware/auth');

function normalizarCodigo(codigo) {
  return String(codigo || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function validarTipo({ codigo, nombre }) {
  if (!codigo || !/^[a-z0-9_]{2,30}$/.test(codigo)) {
    throw new Error('El codigo debe tener entre 2 y 30 caracteres: letras minusculas, numeros o guion bajo.');
  }
  if (!String(nombre || '').trim()) {
    throw new Error('El nombre es obligatorio.');
  }
}

exports.index = async (req, res) => {
  try {
    const tipos = await pool.query(`
      SELECT tm.*,
        (SELECT COUNT(*) FROM movimientos m WHERE m.tipo_movimiento = tm.codigo) as total_movimientos
      FROM tipos_movimiento tm
      ORDER BY tm.orden, tm.nombre
    `);

    res.render('movimientos/tipos-movimiento', {
      title: 'Tipos de Movimiento',
      tipos: tipos.rows,
      success: req.flash('success'),
      error: req.flash('error')
    });
  } catch (err) {
    console.error('Error cargando tipos de movimiento:', err);
    req.flash('error', 'Error al cargar tipos de movimiento.');
    res.redirect('/dashboard');
  }
};

exports.create = async (req, res) => {
  const codigo = normalizarCodigo(req.body.codigo);
  const nombre = String(req.body.nombre || '').trim();
  const orden = parseInt(req.body.orden, 10) || 0;
  const requiereTipoUso = req.body.requiere_tipo_uso === 'on';

  try {
    validarTipo({ codigo, nombre });
    await pool.query(`
      INSERT INTO tipos_movimiento (codigo, nombre, orden, requiere_tipo_uso, activo)
      VALUES ($1, $2, $3, $4, true)
    `, [codigo, nombre, orden, requiereTipoUso]);

    await auditLog(req, 'CREAR_TIPO_MOVIMIENTO', 'tipos_movimiento', null, null, { codigo, nombre, orden, requiere_tipo_uso: requiereTipoUso });
    req.flash('success', 'Tipo de movimiento creado.');
  } catch (err) {
    req.flash('error', err.detail || err.message || 'Error al crear tipo de movimiento.');
  }

  res.redirect('/tipos-movimiento');
};

exports.update = async (req, res) => {
  const { codigo } = req.params;
  const nombre = String(req.body.nombre || '').trim();
  const orden = parseInt(req.body.orden, 10) || 0;
  const activo = codigo === 'interno' ? true : req.body.activo === 'on';
  const requiereTipoUso = codigo === 'interno' ? false : req.body.requiere_tipo_uso === 'on';

  try {
    validarTipo({ codigo, nombre });
    const old = await pool.query('SELECT * FROM tipos_movimiento WHERE codigo = $1', [codigo]);
    if (!old.rows[0]) throw new Error('Tipo de movimiento no encontrado.');

    await pool.query(`
      UPDATE tipos_movimiento
      SET nombre = $1, orden = $2, activo = $3, requiere_tipo_uso = $4, updated_at = NOW()
      WHERE codigo = $5
    `, [nombre, orden, activo, requiereTipoUso, codigo]);

    await auditLog(req, 'EDITAR_TIPO_MOVIMIENTO', 'tipos_movimiento', null, old.rows[0], { nombre, orden, activo, requiere_tipo_uso: requiereTipoUso });
    req.flash('success', 'Tipo de movimiento actualizado.');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar tipo de movimiento.');
  }

  res.redirect('/tipos-movimiento');
};

exports.delete = async (req, res) => {
  const { codigo } = req.params;

  try {
    if (codigo === 'interno') throw new Error('El tipo interno es requerido por el sistema y no se puede desactivar.');

    const old = await pool.query('SELECT * FROM tipos_movimiento WHERE codigo = $1', [codigo]);
    if (!old.rows[0]) throw new Error('Tipo de movimiento no encontrado.');

    await pool.query('UPDATE tipos_movimiento SET activo = false, updated_at = NOW() WHERE codigo = $1', [codigo]);
    await auditLog(req, 'ELIMINAR_TIPO_MOVIMIENTO', 'tipos_movimiento', null, old.rows[0], { activo: false });
    req.flash('success', 'Tipo de movimiento desactivado.');
  } catch (err) {
    req.flash('error', err.message || 'Error al eliminar tipo de movimiento.');
  }

  res.redirect('/tipos-movimiento');
};
