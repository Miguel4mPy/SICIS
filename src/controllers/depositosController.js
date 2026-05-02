const pool = require('../../config/database');
const { auditLog } = require('../middleware/auth');
const { tipoDepositoLabel } = require('../utils/helpers');

async function getEncargados(client = pool) {
  const result = await client.query(`
    SELECT id, nombre, apellido, email
    FROM usuarios
    WHERE rol = 'encargado' AND activo = true
    ORDER BY apellido, nombre
  `);
  return result.rows;
}

async function syncResponsableDeposito(client, depositoId, responsableUsuarioId) {
  await client.query(
    'UPDATE usuario_depositos SET es_responsable = false WHERE deposito_id = $1 AND es_responsable = true',
    [depositoId]
  );

  if (!responsableUsuarioId) {
    await client.query('UPDATE depositos SET responsable_nombre = NULL WHERE id = $1', [depositoId]);
    return null;
  }

  const user = await client.query(
    "SELECT id, nombre, apellido FROM usuarios WHERE id = $1 AND rol = 'encargado' AND activo = true",
    [responsableUsuarioId]
  );
  if (!user.rows[0]) throw new Error('Seleccione un usuario encargado valido.');

  await client.query(`
    INSERT INTO usuario_depositos (usuario_id, deposito_id, es_responsable)
    VALUES ($1, $2, true)
    ON CONFLICT (usuario_id, deposito_id)
    DO UPDATE SET es_responsable = true
  `, [responsableUsuarioId, depositoId]);

  const responsableNombre = `${user.rows[0].nombre} ${user.rows[0].apellido}`;
  await client.query('UPDATE depositos SET responsable_nombre = $1 WHERE id = $2', [responsableNombre, depositoId]);
  return responsableNombre;
}

exports.index = async (req, res) => {
  const sortMap = {
    codigo: 'd.codigo',
    nombre: 'd.nombre',
    tipo: 'd.tipo',
    nivel: 'd.nivel',
    padre: 'dp.nombre',
    departamento: 'd.departamento',
    stock: 'total_stock',
    hijos: 'hijos_count',
    estado: 'd.activo'
  };
  const sort = sortMap[req.query.sort] ? req.query.sort : 'nivel';
  const dir = String(req.query.dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const nivel = ['1', '2', '3'].includes(String(req.query.nivel || '')) ? String(req.query.nivel) : '';
  const params = [];
  const where = [];

  if (nivel) {
    params.push(Number(nivel));
    where.push(`d.nivel = $${params.length}`);
  }

  try {
    const result = await pool.query(`
      SELECT d.*, dp.nombre as padre_nombre,
        COALESCE(ur.nombre || ' ' || ur.apellido, d.responsable_nombre) as responsable_nombre,
        (SELECT COUNT(*) FROM depositos WHERE deposito_padre_id = d.id) as hijos_count,
        (SELECT COALESCE(SUM(s.cantidad), 0) FROM stock s WHERE s.deposito_id = d.id) as total_stock
      FROM depositos d
      LEFT JOIN depositos dp ON d.deposito_padre_id = dp.id
      LEFT JOIN usuario_depositos udr ON udr.deposito_id = d.id AND udr.es_responsable = true
      LEFT JOIN usuarios ur ON ur.id = udr.usuario_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${sortMap[sort]} ${dir}, d.nombre ASC
    `, params);

    res.render('depositos/index', {
      title: 'Depositos',
      depositos: result.rows,
      filtros: { nivel, sort, dir: dir.toLowerCase() },
      tipoDepositoLabel,
      success: req.flash('success'),
      error: req.flash('error')
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Error al cargar depositos.');
    res.redirect('/dashboard');
  }
};

exports.new = async (req, res) => {
  const [padresRes, encargados] = await Promise.all([
    pool.query("SELECT id, codigo, nombre, nivel FROM depositos WHERE nivel < 3 AND activo = true ORDER BY nivel, nombre"),
    getEncargados()
  ]);

  res.render('depositos/form', {
    title: 'Nuevo Deposito',
    deposito: {},
    padres: padresRes.rows,
    encargados,
    responsableUsuarioId: null,
    tipoDepositoLabel,
    errors: req.flash('error')
  });
};

exports.create = async (req, res) => {
  const { codigo, nombre, tipo, nivel, deposito_padre_id, zona, departamento, direccion, responsable_usuario_id } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO depositos (codigo, nombre, tipo, nivel, deposito_padre_id, zona, departamento, direccion, responsable_nombre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL) RETURNING id`,
      [codigo, nombre, tipo, nivel, deposito_padre_id || null, zona, departamento, direccion]
    );

    await syncResponsableDeposito(client, result.rows[0].id, responsable_usuario_id || null);
    await client.query('COMMIT');
    await auditLog(req, 'CREAR_DEPOSITO', 'depositos', result.rows[0].id, null, req.body);
    req.flash('success', 'Deposito creado exitosamente.');
    res.redirect('/depositos');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    req.flash('error', err.detail || err.message || 'Error al crear deposito.');
    res.redirect('/depositos/nuevo');
  } finally {
    client.release();
  }
};

exports.show = async (req, res) => {
  const { id } = req.params;
  try {
    const dep = await pool.query(`
      SELECT d.*, dp.nombre as padre_nombre,
        COALESCE(ur.nombre || ' ' || ur.apellido, d.responsable_nombre) as responsable_nombre
      FROM depositos d
      LEFT JOIN depositos dp ON d.deposito_padre_id = dp.id
      LEFT JOIN usuario_depositos udr ON udr.deposito_id = d.id AND udr.es_responsable = true
      LEFT JOIN usuarios ur ON ur.id = udr.usuario_id
      WHERE d.id = $1
    `, [id]);
    if (!dep.rows[0]) {
      req.flash('error', 'Deposito no encontrado.');
      return res.redirect('/depositos');
    }

    const hijos = await pool.query('SELECT * FROM depositos WHERE deposito_padre_id = $1 AND activo = true ORDER BY nombre', [id]);

    const stock = await pool.query(`
      SELECT s.cantidad, i.nombre as insecticida_nombre, i.tipo_uso, i.tipo_usos, l.unidad_medida,
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
    req.flash('error', 'Error al cargar deposito.');
    res.redirect('/depositos');
  }
};

exports.edit = async (req, res) => {
  const { id } = req.params;
  const [dep, padres, encargados, responsable] = await Promise.all([
    pool.query('SELECT * FROM depositos WHERE id = $1', [id]),
    pool.query("SELECT id, codigo, nombre, nivel FROM depositos WHERE nivel < 3 AND activo = true AND id != $1 ORDER BY nivel, nombre", [id]),
    getEncargados(),
    pool.query('SELECT usuario_id FROM usuario_depositos WHERE deposito_id = $1 AND es_responsable = true LIMIT 1', [id])
  ]);

  res.render('depositos/form', {
    title: 'Editar Deposito',
    deposito: dep.rows[0] || {},
    padres: padres.rows,
    encargados,
    responsableUsuarioId: responsable.rows[0]?.usuario_id || null,
    tipoDepositoLabel,
    errors: req.flash('error')
  });
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { codigo, nombre, tipo, nivel, deposito_padre_id, zona, departamento, direccion, responsable_usuario_id, activo } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE depositos SET codigo=$1, nombre=$2, tipo=$3, nivel=$4, deposito_padre_id=$5, zona=$6, departamento=$7, direccion=$8, activo=$9
       WHERE id=$10`,
      [codigo, nombre, tipo, nivel, deposito_padre_id || null, zona, departamento, direccion, activo === 'on', id]
    );
    await syncResponsableDeposito(client, id, responsable_usuario_id || null);
    await client.query('COMMIT');
    await auditLog(req, 'EDITAR_DEPOSITO', 'depositos', id, null, req.body);
    req.flash('success', 'Deposito actualizado.');
    res.redirect('/depositos');
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.message || 'Error al actualizar deposito.');
    res.redirect(`/depositos/${id}/editar`);
  } finally {
    client.release();
  }
};

exports.delete = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const dep = await client.query('SELECT id, nombre FROM depositos WHERE id = $1 AND activo = true', [id]);
    if (!dep.rows[0]) throw new Error('Deposito no encontrado o ya eliminado.');

    await client.query('UPDATE depositos SET activo = false WHERE id = $1', [id]);
    await client.query('UPDATE usuario_depositos SET es_responsable = false WHERE deposito_id = $1', [id]);
    await client.query('COMMIT');

    await auditLog(req, 'ELIMINAR_DEPOSITO', 'depositos', id, dep.rows[0], { activo: false });
    req.flash('success', 'Deposito eliminado.');
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.message || 'Error al eliminar deposito.');
  } finally {
    client.release();
  }

  res.redirect('/depositos');
};

exports.getArbol = async (req, res) => {
  const deps = await pool.query('SELECT * FROM depositos WHERE activo = true ORDER BY nivel, nombre');
  res.render('depositos/arbol', {
    title: 'Arbol de Depositos',
    depositos: deps.rows,
    tipoDepositoLabel
  });
};
