const pool = require('../../config/database');
const { auditLog } = require('../middleware/auth');
const { generarNumeroMovimiento, calcularSemanaEpidemiologica, tipoMovimientoLabel } = require('../utils/helpers');

async function getDepositosPermitidos(userId, rol) {
  if (rol === 'admin' || rol === 'gerente') {
    const r = await pool.query('SELECT * FROM depositos WHERE activo = true ORDER BY nivel, nombre');
    return r.rows;
  }

  const r = await pool.query(`
    WITH RECURSIVE dep_tree AS (
      SELECT d.*
      FROM depositos d
      JOIN usuario_depositos ud ON d.id = ud.deposito_id
      WHERE ud.usuario_id = $1
      UNION ALL
      SELECT d.*
      FROM depositos d
      JOIN dep_tree dt ON d.deposito_padre_id = dt.id
    )
    SELECT DISTINCT * FROM dep_tree WHERE activo = true ORDER BY nivel, nombre
  `, [userId]);
  return r.rows;
}

async function usuarioEsResponsableDeposito(client, userId, depositoId) {
  if (!depositoId) return false;
  const r = await client.query(`
    SELECT 1
    FROM usuario_depositos ud
    JOIN usuarios u ON u.id = ud.usuario_id
    JOIN depositos d ON d.id = ud.deposito_id
    WHERE ud.usuario_id = $1
      AND ud.deposito_id = $2
      AND (
        ud.es_responsable = true
        OR (
          u.rol IN ('encargado', 'encargado_principal')
          AND NOT EXISTS (
            SELECT 1
            FROM usuario_depositos ud_resp
            WHERE ud_resp.deposito_id = ud.deposito_id
              AND ud_resp.es_responsable = true
          )
        )
        OR (u.rol = 'encargado_principal' AND d.nivel = 1)
      )
    LIMIT 1
  `,
    [userId, depositoId]
  );
  return Boolean(r.rows[0]);
}

async function puedeConfirmarMovimiento(client, userId, movimientoId) {
  const r = await client.query(`
    SELECT 1
    FROM movimientos m
    JOIN usuario_depositos ud ON ud.deposito_id = m.deposito_destino_id
    JOIN usuarios u ON u.id = ud.usuario_id
    JOIN depositos d ON d.id = m.deposito_destino_id
    WHERE m.id = $1
      AND ud.usuario_id = $2
      AND (
        ud.es_responsable = true
        OR (
          u.rol IN ('encargado', 'encargado_principal')
          AND NOT EXISTS (
            SELECT 1
            FROM usuario_depositos ud_resp
            WHERE ud_resp.deposito_id = ud.deposito_id
              AND ud_resp.es_responsable = true
          )
        )
        OR (u.rol = 'encargado_principal' AND d.nivel = 1)
      )
    LIMIT 1
  `, [movimientoId, userId]);
  return Boolean(r.rows[0]);
}

function getAnioEpidemiologico(info) {
  return info.anio || info.año || info['a??o'] || new Date().getFullYear();
}

async function getDepositoIdsPermitidos(userId, rol) {
  const depositos = await getDepositosPermitidos(userId, rol);
  return new Set(depositos.map(d => Number(d.id)));
}

function assertDepositoPermitido(depIdsPermitidos, depositoId, mensaje) {
  if (!depositoId) return;
  if (!depIdsPermitidos.has(Number(depositoId))) {
    throw new Error(mensaje || 'No tiene permisos sobre el deposito seleccionado.');
  }
}

const CATEGORIAS_MOVIMIENTO = [
  { value: 'entrada', label: 'Entrada (ingreso al deposito)' },
  { value: 'salida', label: 'Salida (uso / aplicacion)' },
  { value: 'transferencia', label: 'Transferencia (entre depositos)' },
  { value: 'ajuste', label: 'Ajuste de Inventario' }
];

const TIPOS_MOVIMIENTO_BASE = [
  { value: 'interno', label: 'Interno' },
  { value: 'espacial', label: 'Espacial' },
  { value: 'focal', label: 'Focal' },
  { value: 'residual', label: 'Residual' },
  { value: 'larvicida', label: 'Larvicida' }
];

async function getTiposMovimiento(includeInactive = false) {
  try {
    const where = includeInactive ? '' : 'WHERE activo = true';
    const r = await pool.query(`
      SELECT codigo as value, nombre as label, activo, orden, requiere_tipo_uso
      FROM tipos_movimiento
      ${where}
      ORDER BY orden, nombre
    `);
    return r.rows;
  } catch (err) {
    if (err.code !== '42P01') throw err;
    return includeInactive ? TIPOS_MOVIMIENTO_BASE : TIPOS_MOVIMIENTO_BASE;
  }
}

function getCategoriasPermitidas(rol) {
  if (rol === 'encargado_principal') {
    return CATEGORIAS_MOVIMIENTO.filter(c => ['entrada', 'transferencia', 'ajuste'].includes(c.value));
  }

  if (rol === 'encargado') {
    return CATEGORIAS_MOVIMIENTO.filter(c => ['salida', 'transferencia', 'ajuste'].includes(c.value));
  }

  return CATEGORIAS_MOVIMIENTO;
}

function getTiposMovimientoPermitidos(rol, tiposMovimiento) {
  if (rol === 'encargado_principal') {
    return tiposMovimiento.filter(t => t.value === 'interno');
  }

  return tiposMovimiento;
}

exports.index = async (req, res) => {
  const { fecha_desde, fecha_hasta, tipo, deposito_id, insecticida_id, page = 1 } = req.query;
  const limit = 20;
  const offset = (Number(page) - 1) * limit;

  try {
    const whereConditions = ["m.estado != 'anulado'"];
    const params = [];
    let idx = 1;

    const depositosPermitidos = await getDepositosPermitidos(req.session.userId, req.session.userRol);
    const depIds = depositosPermitidos.map(d => d.id);

    if (depIds.length > 0) {
      whereConditions.push(`(m.deposito_origen_id = ANY($${idx}::int[]) OR m.deposito_destino_id = ANY($${idx}::int[]))`);
      params.push(depIds);
      idx++;
    }

    if (fecha_desde) { whereConditions.push(`m.fecha_movimiento >= $${idx}`); params.push(fecha_desde); idx++; }
    if (fecha_hasta) { whereConditions.push(`m.fecha_movimiento <= $${idx}`); params.push(fecha_hasta); idx++; }
    if (tipo) { whereConditions.push(`m.tipo_movimiento = $${idx}`); params.push(tipo); idx++; }
    if (deposito_id) {
      whereConditions.push(`(m.deposito_origen_id = $${idx} OR m.deposito_destino_id = $${idx})`);
      params.push(deposito_id);
      idx++;
    }
    if (insecticida_id) { whereConditions.push(`m.insecticida_id = $${idx}`); params.push(insecticida_id); idx++; }

    const where = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM movimientos m ${where}`, params);
    const total = Number(countResult.rows[0].count);

    const movimientos = await pool.query(`
      SELECT m.*, i.nombre as insecticida_nombre, i.tipo_uso, l.unidad_medida,
        l.codigo_lote, l.fecha_vencimiento,
        dor.nombre as origen_nombre, dor.tipo as origen_tipo,
        dde.nombre as destino_nombre, dde.tipo as destino_tipo,
        u.nombre || ' ' || u.apellido as usuario_nombre
      FROM movimientos m
      JOIN insecticidas i ON m.insecticida_id = i.id
      JOIN lotes l ON m.lote_id = l.id
      LEFT JOIN depositos dor ON m.deposito_origen_id = dor.id
      LEFT JOIN depositos dde ON m.deposito_destino_id = dde.id
      JOIN usuarios u ON m.usuario_id = u.id
      ${where}
      ORDER BY m.fecha_movimiento DESC, m.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, [...params, limit, offset]);

    const insecticidas = await pool.query('SELECT id, codigo, nombre FROM insecticidas WHERE activo = true ORDER BY nombre');

    res.render('movimientos/index', {
      title: 'Movimientos de Insecticidas',
      movimientos: movimientos.rows,
      depositos: depositosPermitidos,
      insecticidas: insecticidas.rows,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      filtros: { fecha_desde, fecha_hasta, tipo, deposito_id, insecticida_id },
      tipoMovimientoLabel
    });
  } catch (err) {
    console.error('Error cargando movimientos:', err);
    req.flash('error', 'Error al cargar movimientos.');
    res.redirect('/dashboard');
  }
};

exports.new = async (req, res) => {
  try {
    const depositosPermitidos = await getDepositosPermitidos(req.session.userId, req.session.userRol);
    const insecticidas = await pool.query('SELECT * FROM insecticidas WHERE activo = true ORDER BY nombre');
    const tiposMovimiento = await getTiposMovimiento();
    const lotes = await pool.query(`
      SELECT l.*, i.nombre as insecticida_nombre, i.tipo_uso
      FROM lotes l
      JOIN insecticidas i ON l.insecticida_id = i.id
      WHERE l.activo = true AND l.fecha_vencimiento >= CURRENT_DATE
      ORDER BY i.nombre, l.codigo_lote
    `);

    res.render('movimientos/form', {
      title: 'Registrar Movimiento',
      movimiento: {},
      depositos: depositosPermitidos,
      insecticidas: insecticidas.rows,
      lotes: lotes.rows,
      categorias: getCategoriasPermitidas(req.session.userRol),
      tiposMovimiento: getTiposMovimientoPermitidos(req.session.userRol, tiposMovimiento),
      rolUsuario: req.session.userRol,
      tipoMovimientoLabel,
      errors: req.flash('error')
    });
  } catch (err) {
    console.error('Error cargando formulario de movimiento:', err);
    req.flash('error', 'Error al cargar formulario de movimiento.');
    res.redirect('/movimientos');
  }
};

exports.create = async (req, res) => {
  const {
    tipo_movimiento,
    categoria,
    deposito_origen_id,
    deposito_destino_id,
    lote_id,
    cantidad,
    fecha_movimiento,
    descripcion,
    observaciones
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cant = Number(cantidad);
    if (!tipo_movimiento || !categoria || !lote_id || !fecha_movimiento) throw new Error('Complete los campos obligatorios.');
    if (Number.isNaN(cant) || cant <= 0) throw new Error('La cantidad debe ser mayor a cero.');
    if (!getCategoriasPermitidas(req.session.userRol).some(c => c.value === categoria)) {
      throw new Error('Su rol no tiene permisos para registrar esta categoria de movimiento.');
    }

    const tiposMovimiento = await getTiposMovimiento();
    const tipoMovimiento = getTiposMovimientoPermitidos(req.session.userRol, tiposMovimiento).find(t => t.value === tipo_movimiento);
    if (!tipoMovimiento) {
      throw new Error('Su rol no tiene permisos para registrar este tipo de movimiento.');
    }
    if (['entrada', 'transferencia', 'ajuste'].includes(categoria) && tipo_movimiento !== 'interno') {
      throw new Error('Las entradas, transferencias y ajustes de inventario deben registrarse como movimiento interno.');
    }

    const depIdsPermitidos = await getDepositoIdsPermitidos(req.session.userId, req.session.userRol);
    assertDepositoPermitido(depIdsPermitidos, deposito_origen_id, 'No tiene permisos sobre el deposito de origen.');
    assertDepositoPermitido(depIdsPermitidos, deposito_destino_id, 'No tiene permisos sobre el deposito de destino.');

    if (req.session.userRol === 'encargado_principal' && categoria === 'entrada') {
      const destino = await client.query('SELECT nivel FROM depositos WHERE id = $1 AND activo = true', [deposito_destino_id || null]);
      if (!destino.rows[0] || Number(destino.rows[0].nivel) !== 1) {
        throw new Error('El encargado principal solo puede registrar entradas a depositos de nivel 1.');
      }
    }

    const loteRes = await client.query(`
      SELECT l.*, i.id as ins_id, i.tipo_uso, COALESCE(i.tipo_usos, ARRAY[i.tipo_uso::TEXT]) as tipo_usos
      FROM lotes l
      JOIN insecticidas i ON l.insecticida_id = i.id
      WHERE l.id = $1
    `, [lote_id]);
    if (!loteRes.rows[0]) throw new Error('Lote no encontrado.');
    const lote = loteRes.rows[0];
    if (tipoMovimiento.requiere_tipo_uso && !lote.tipo_usos.includes(tipo_movimiento)) {
      throw new Error('El tipo de movimiento no esta habilitado para el insecticida seleccionado.');
    }

    const destinoRequiereConfirmacion = Boolean(deposito_destino_id)
      && !['admin', 'gerente'].includes(req.session.userRol)
      && !(await usuarioEsResponsableDeposito(client, req.session.userId, deposito_destino_id));
    const estadoMovimiento = destinoRequiereConfirmacion ? 'pendiente' : 'confirmado';

    if ((categoria === 'entrada' || categoria === 'transferencia') && !deposito_destino_id) {
      throw new Error('Debe especificar el deposito de destino.');
    }
    if (categoria === 'ajuste' && !deposito_destino_id) {
      throw new Error('Debe especificar el deposito donde se realizara el ajuste.');
    }

    if (categoria === 'salida' || categoria === 'transferencia') {
      if (!deposito_origen_id) throw new Error('Debe especificar el deposito de origen.');
      const stockRes = await client.query('SELECT cantidad FROM stock WHERE deposito_id = $1 AND lote_id = $2', [deposito_origen_id, lote_id]);
      const stockActual = Number(stockRes.rows[0]?.cantidad || 0);
      if (stockActual < cant) throw new Error(`Stock insuficiente. Disponible: ${stockActual}`);

      await client.query(`
        INSERT INTO stock (deposito_id, lote_id, cantidad)
        VALUES ($1, $2, $3)
        ON CONFLICT (deposito_id, lote_id)
        DO UPDATE SET cantidad = stock.cantidad - $3, updated_at = NOW()
      `, [deposito_origen_id, lote_id, cant]);
    }

    if (estadoMovimiento === 'confirmado' && (categoria === 'entrada' || categoria === 'transferencia' || categoria === 'ajuste')) {
      const destino = deposito_destino_id || deposito_origen_id;

      await client.query(`
        INSERT INTO stock (deposito_id, lote_id, cantidad)
        VALUES ($1, $2, $3)
        ON CONFLICT (deposito_id, lote_id)
        DO UPDATE SET cantidad = stock.cantidad + $3, updated_at = NOW()
      `, [destino, lote_id, cant]);
    }

    const numeroMov = generarNumeroMovimiento();
    const semanaInfo = calcularSemanaEpidemiologica(fecha_movimiento);
    const movRes = await client.query(`
      INSERT INTO movimientos
        (numero_mov, tipo_movimiento, categoria, deposito_origen_id, deposito_destino_id, lote_id,
         insecticida_id, cantidad, fecha_movimiento, semana_epidemiologica, "a\u00f1o_epidemiologico",
         descripcion, observaciones, usuario_id, estado, aprobado_por, confirmado_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id
    `, [
      numeroMov,
      tipo_movimiento,
      categoria,
      deposito_origen_id || null,
      deposito_destino_id || null,
      lote_id,
      lote.ins_id,
      cant,
      fecha_movimiento,
      semanaInfo.semana,
      getAnioEpidemiologico(semanaInfo),
      descripcion,
      observaciones,
      req.session.userId,
      estadoMovimiento,
      estadoMovimiento === 'confirmado' ? req.session.userId : null,
      estadoMovimiento === 'confirmado' ? new Date() : null
    ]);

    await client.query('COMMIT');
    await auditLog(req, 'CREAR_MOVIMIENTO', 'movimientos', movRes.rows[0].id, null, req.body);
    req.flash('success', estadoMovimiento === 'pendiente'
      ? `Movimiento ${numeroMov} registrado como pendiente. Debe ser confirmado por el encargado del deposito destino.`
      : `Movimiento ${numeroMov} registrado exitosamente.`);
    res.redirect('/movimientos');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando movimiento:', err);
    req.flash('error', err.message || 'Error al registrar movimiento.');
    res.redirect('/movimientos/nuevo');
  } finally {
    client.release();
  }
};

exports.show = async (req, res) => {
  const { id } = req.params;
  try {
    const mov = await pool.query(`
      SELECT m.*, i.nombre as insecticida_nombre, i.tipo_uso, l.unidad_medida, l.codigo_lote, l.fecha_vencimiento,
        dor.nombre as origen_nombre, dor.codigo as origen_codigo,
        dde.nombre as destino_nombre, dde.codigo as destino_codigo,
        u.nombre || ' ' || u.apellido as usuario_nombre, u.email as usuario_email,
        ua.nombre || ' ' || ua.apellido as aprobado_por_nombre
      FROM movimientos m
      JOIN insecticidas i ON m.insecticida_id = i.id
      JOIN lotes l ON m.lote_id = l.id
      LEFT JOIN depositos dor ON m.deposito_origen_id = dor.id
      LEFT JOIN depositos dde ON m.deposito_destino_id = dde.id
      JOIN usuarios u ON m.usuario_id = u.id
      LEFT JOIN usuarios ua ON m.aprobado_por = ua.id
      WHERE m.id = $1
    `, [id]);

    if (!mov.rows[0]) {
      req.flash('error', 'Movimiento no encontrado.');
      return res.redirect('/movimientos');
    }

    const depIdsPermitidos = await getDepositoIdsPermitidos(req.session.userId, req.session.userRol);
    const origenPermitido = mov.rows[0].deposito_origen_id && depIdsPermitidos.has(Number(mov.rows[0].deposito_origen_id));
    const destinoPermitido = mov.rows[0].deposito_destino_id && depIdsPermitidos.has(Number(mov.rows[0].deposito_destino_id));
    if (!origenPermitido && !destinoPermitido) {
      req.flash('error', 'No tiene permisos para ver este movimiento.');
      return res.redirect('/movimientos');
    }

    const puedeConfirmar = mov.rows[0].estado === 'pendiente'
      ? await puedeConfirmarMovimiento(pool, req.session.userId, id)
      : false;

    res.render('movimientos/show', {
      title: `Movimiento ${mov.rows[0].numero_mov}`,
      movimiento: mov.rows[0],
      puedeConfirmar,
      tipoMovimientoLabel
    });
  } catch (err) {
    console.error('Error mostrando movimiento:', err);
    req.flash('error', 'Error al cargar movimiento.');
    res.redirect('/movimientos');
  }
};

exports.anular = async (req, res) => {
  const { id } = req.params;
  const { motivo_anulacion } = req.body;
  if (!motivo_anulacion) {
    req.flash('error', 'Debe indicar el motivo de anulacion.');
    return res.redirect(`/movimientos/${id}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const movRes = await client.query('SELECT * FROM movimientos WHERE id = $1 AND estado != $2', [id, 'anulado']);
    if (!movRes.rows[0]) throw new Error('Movimiento no encontrado o ya anulado.');
    const mov = movRes.rows[0];

    if (mov.estado === 'confirmado' && mov.categoria === 'entrada' && mov.deposito_destino_id) {
      await client.query('UPDATE stock SET cantidad = cantidad - $1 WHERE deposito_id = $2 AND lote_id = $3', [mov.cantidad, mov.deposito_destino_id, mov.lote_id]);
    }
    if (mov.categoria === 'salida' && mov.deposito_origen_id) {
      await client.query('UPDATE stock SET cantidad = cantidad + $1 WHERE deposito_id = $2 AND lote_id = $3', [mov.cantidad, mov.deposito_origen_id, mov.lote_id]);
    }
    if (mov.categoria === 'transferencia') {
      if (mov.estado === 'confirmado' && mov.deposito_destino_id) await client.query('UPDATE stock SET cantidad = cantidad - $1 WHERE deposito_id = $2 AND lote_id = $3', [mov.cantidad, mov.deposito_destino_id, mov.lote_id]);
      if (mov.deposito_origen_id) await client.query('UPDATE stock SET cantidad = cantidad + $1 WHERE deposito_id = $2 AND lote_id = $3', [mov.cantidad, mov.deposito_origen_id, mov.lote_id]);
    }
    if (mov.estado === 'confirmado' && mov.categoria === 'ajuste') {
      const depositoAjuste = mov.deposito_destino_id || mov.deposito_origen_id;
      if (depositoAjuste) await client.query('UPDATE stock SET cantidad = cantidad - $1 WHERE deposito_id = $2 AND lote_id = $3', [mov.cantidad, depositoAjuste, mov.lote_id]);
    }

    await client.query(
      "UPDATE movimientos SET estado = 'anulado', anulado_por = $1, motivo_anulacion = $2 WHERE id = $3",
      [req.session.userId, motivo_anulacion, id]
    );

    await client.query('COMMIT');
    await auditLog(req, 'ANULAR_MOVIMIENTO', 'movimientos', id, mov, { motivo_anulacion });
    req.flash('success', 'Movimiento anulado y stock revertido.');
    res.redirect('/movimientos');
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.message);
    res.redirect(`/movimientos/${id}`);
  } finally {
    client.release();
  }
};

exports.confirmaciones = async (req, res) => {
  try {
    const params = [req.session.userId];

    const pendientes = await pool.query(`
      SELECT m.*, i.nombre as insecticida_nombre, l.unidad_medida,
        l.codigo_lote, l.fecha_vencimiento,
        dor.nombre as origen_nombre, dor.codigo as origen_codigo,
        dde.nombre as destino_nombre, dde.codigo as destino_codigo,
        u.nombre || ' ' || u.apellido as usuario_nombre,
        resp.nombre || ' ' || resp.apellido as encargado_destino_nombre
      FROM movimientos m
      JOIN insecticidas i ON m.insecticida_id = i.id
      JOIN lotes l ON m.lote_id = l.id
      LEFT JOIN depositos dor ON m.deposito_origen_id = dor.id
      LEFT JOIN depositos dde ON m.deposito_destino_id = dde.id
      JOIN usuarios u ON m.usuario_id = u.id
      LEFT JOIN LATERAL (
        SELECT ur.nombre, ur.apellido
        FROM usuario_depositos ud_resp
        JOIN usuarios ur ON ur.id = ud_resp.usuario_id
        WHERE ud_resp.deposito_id = m.deposito_destino_id
          AND ur.activo = true
          AND ur.rol IN ('encargado', 'encargado_principal')
        ORDER BY ud_resp.es_responsable DESC, ur.apellido, ur.nombre
        LIMIT 1
      ) resp ON true
      WHERE m.estado = 'pendiente'
        AND m.deposito_destino_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM usuario_depositos ud
          JOIN usuarios ur ON ur.id = ud.usuario_id
          JOIN depositos dd ON dd.id = m.deposito_destino_id
          WHERE ud.usuario_id = $1
            AND ud.deposito_id = m.deposito_destino_id
            AND (
              ud.es_responsable = true
              OR (
                ur.rol IN ('encargado', 'encargado_principal')
                AND NOT EXISTS (
                  SELECT 1
                  FROM usuario_depositos ud_resp
                  WHERE ud_resp.deposito_id = ud.deposito_id
                    AND ud_resp.es_responsable = true
                )
              )
              OR (ur.rol = 'encargado_principal' AND dd.nivel = 1)
            )
        )
      ORDER BY m.created_at ASC
    `, params);

    res.render('movimientos/confirmaciones', {
      title: 'Confirmacion de Movimiento',
      movimientos: pendientes.rows,
      tipoMovimientoLabel
    });
  } catch (err) {
    console.error('Error cargando confirmaciones:', err);
    req.flash('error', 'Error al cargar movimientos pendientes.');
    res.redirect('/movimientos');
  }
};

exports.confirmar = async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const puede = await puedeConfirmarMovimiento(client, req.session.userId, id);
    if (!puede) throw new Error('No tiene permisos para confirmar este movimiento.');

    const movRes = await client.query('SELECT * FROM movimientos WHERE id = $1 AND estado = $2 FOR UPDATE', [id, 'pendiente']);
    if (!movRes.rows[0]) throw new Error('Movimiento pendiente no encontrado.');
    const mov = movRes.rows[0];

    const destino = mov.deposito_destino_id || mov.deposito_origen_id;
    if (!destino) throw new Error('El movimiento no tiene deposito destino para confirmar.');

    await client.query(`
      INSERT INTO stock (deposito_id, lote_id, cantidad)
      VALUES ($1, $2, $3)
      ON CONFLICT (deposito_id, lote_id)
      DO UPDATE SET cantidad = stock.cantidad + $3, updated_at = NOW()
    `, [destino, mov.lote_id, mov.cantidad]);

    await client.query(`
      UPDATE movimientos
      SET estado = 'confirmado', aprobado_por = $1, confirmado_at = NOW(), updated_at = NOW()
      WHERE id = $2
    `, [req.session.userId, id]);

    await client.query('COMMIT');
    await auditLog(req, 'CONFIRMAR_MOVIMIENTO', 'movimientos', id, mov, { aprobado_por: req.session.userId });
    req.flash('success', 'Movimiento confirmado y stock de destino actualizado.');
    res.redirect('/movimientos/confirmaciones');
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.message || 'No se pudo confirmar el movimiento.');
    res.redirect('/movimientos/confirmaciones');
  } finally {
    client.release();
  }
};

exports.getStockPorDeposito = async (req, res) => {
  const { deposito_id } = req.params;
  try {
    const depIdsPermitidos = await getDepositoIdsPermitidos(req.session.userId, req.session.userRol);
    if (!depIdsPermitidos.has(Number(deposito_id))) {
      return res.status(403).json({ error: 'No tiene permisos sobre este deposito.' });
    }

    const stock = await pool.query(`
      SELECT s.cantidad, l.id as lote_id, l.codigo_lote, l.fecha_vencimiento, l.unidad_medida
      FROM stock s
      JOIN lotes l ON s.lote_id = l.id
      JOIN insecticidas i ON l.insecticida_id = i.id
      WHERE s.deposito_id = $1 AND l.insecticida_id = $2 AND s.cantidad > 0
    `, [deposito_id, req.query.insecticida_id]);
    res.json(stock.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
