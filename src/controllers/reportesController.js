const pool = require('../../config/database');
const {
  formatearFecha,
  formatearNumero,
  formatearCantidad,
  tipoMovimientoLabel,
  tipoDepositoLabel
} = require('../utils/helpers');
const { buildReportFile } = require('../utils/reportExport');

function colorLotePorVencimiento(diasVencimiento) {
  const dias = Number(diasVencimiento);
  if (Number.isNaN(dias)) return '#6c757d';
  if (dias < 0) return '#6c757d';
  if (dias <= 30) return '#dc3545';
  if (dias <= 90) return '#ffc107';
  return '#198754';
}

function estadoLotePorVencimiento(diasVencimiento) {
  const dias = Number(diasVencimiento);
  if (Number.isNaN(dias)) return 'Sin fecha';
  if (dias < 0) return 'Vencido';
  if (dias <= 30) return 'Por vencer';
  if (dias <= 90) return 'Proximo';
  return 'Vigente';
}

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

function cleanQueryString(query) {
  return new URLSearchParams({ ...query, formato: '' }).toString().replace(/(^|&)formato=$/, '');
}

function canExportReports(rol) {
  return rol === 'admin' || rol === 'gerente';
}

async function getMovimientosReporte(query, userId, userRol) {
  const {
    deposito_id,
    tipo_deposito,
    insecticida_id,
    lote_id,
    fecha_desde,
    fecha_hasta,
    semana,
    anio,
    tipo_mov
  } = query;

  const depositosPermitidos = await getDepositosPermitidos(userId, userRol);
  const depIds = depositosPermitidos.map(d => d.id);
  const conditions = ["m.estado != 'anulado'"];
  const params = [];
  let idx = 1;

  if (depIds.length) {
    conditions.push(`(m.deposito_origen_id = ANY($${idx}::int[]) OR m.deposito_destino_id = ANY($${idx}::int[]))`);
    params.push(depIds);
    idx++;
  }

  if (deposito_id) {
    conditions.push(`(m.deposito_origen_id = $${idx} OR m.deposito_destino_id = $${idx})`);
    params.push(deposito_id);
    idx++;
  }
  if (tipo_deposito) {
    conditions.push(`(dor.tipo = $${idx} OR dde.tipo = $${idx})`);
    params.push(tipo_deposito);
    idx++;
  }
  if (insecticida_id) {
    conditions.push(`m.insecticida_id = $${idx}`);
    params.push(insecticida_id);
    idx++;
  }
  if (lote_id) {
    conditions.push(`m.lote_id = $${idx}`);
    params.push(lote_id);
    idx++;
  }
  if (fecha_desde) {
    conditions.push(`m.fecha_movimiento >= $${idx}`);
    params.push(fecha_desde);
    idx++;
  }
  if (fecha_hasta) {
    conditions.push(`m.fecha_movimiento <= $${idx}`);
    params.push(fecha_hasta);
    idx++;
  }
  if (semana) {
    conditions.push(`m.semana_epidemiologica = $${idx}`);
    params.push(semana);
    idx++;
  }
  if (anio) {
    conditions.push(`m."año_epidemiologico" = $${idx}`);
    params.push(anio);
    idx++;
  }
  if (tipo_mov) {
    conditions.push(`m.tipo_movimiento = $${idx}`);
    params.push(tipo_mov);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await pool.query(`
    SELECT m.*, m."año_epidemiologico" as anio_epidemiologico,
      i.nombre as insecticida_nombre, i.tipo_uso, l.unidad_medida,
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
    ORDER BY m.fecha_movimiento DESC, m.numero_mov
  `, params);

  return { rows: rows.rows, depositosPermitidos };
}

async function getStockReporte(query, userId, userRol) {
  const { deposito_id, tipo_deposito, insecticida_id, incluir_cero } = query;
  const depositosPermitidos = await getDepositosPermitidos(userId, userRol);
  const depIds = depositosPermitidos.map(d => d.id);
  const conditions = depIds.length ? ['s.deposito_id = ANY($1::int[])'] : [];
  const params = depIds.length ? [depIds] : [];
  let idx = params.length + 1;

  if (deposito_id) {
    conditions.push(`s.deposito_id = $${idx}`);
    params.push(deposito_id);
    idx++;
  }
  if (tipo_deposito) {
    conditions.push(`d.tipo = $${idx}`);
    params.push(tipo_deposito);
    idx++;
  }
  if (insecticida_id) {
    conditions.push(`i.id = $${idx}`);
    params.push(insecticida_id);
    idx++;
  }
  if (!incluir_cero) {
    conditions.push('s.cantidad > 0');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await pool.query(`
    SELECT d.codigo as deposito_codigo, d.nombre as deposito_nombre, d.tipo as deposito_tipo, d.nivel,
      i.nombre as insecticida_nombre, i.tipo_uso, l.unidad_medida,
      l.codigo_lote, l.fecha_vencimiento, s.cantidad, s.updated_at
    FROM stock s
    JOIN depositos d ON s.deposito_id = d.id
    JOIN lotes l ON s.lote_id = l.id
    JOIN insecticidas i ON l.insecticida_id = i.id
    ${where}
    ORDER BY d.nivel, d.nombre, i.nombre, l.fecha_vencimiento
  `, params);

  return { rows: rows.rows, depositosPermitidos };
}

async function getSelectedStockFilterOptions({ depositoId, insecticidaId }, userId, userRol) {
  const depositosPermitidos = await getDepositosPermitidos(userId, userRol);
  const depIds = depositosPermitidos.map(d => d.id);

  const selectedDeposito = depositoId && depIds.length
    ? await pool.query(`
        SELECT id, codigo, nombre, tipo, nivel
        FROM depositos
        WHERE id = $1 AND activo = true AND id = ANY($2::int[])
        LIMIT 1
      `, [depositoId, depIds])
    : { rows: [] };

  const selectedInsecticida = insecticidaId
    ? await pool.query(`
        SELECT id, codigo, nombre
        FROM insecticidas
        WHERE id = $1 AND activo = true
        LIMIT 1
      `, [insecticidaId])
    : { rows: [] };

  return {
    deposito: selectedDeposito.rows[0] || null,
    insecticida: selectedInsecticida.rows[0] || null
  };
}

function ordenarDepositosJerarquia(depositos) {
  const byParent = new Map();
  const byId = new Map();

  depositos.forEach(dep => {
    const id = Number(dep.id);
    const parentId = dep.deposito_padre_id ? Number(dep.deposito_padre_id) : null;
    byId.set(id, dep);
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(dep);
  });

  byParent.forEach(children => {
    children.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)) || Number(a.id) - Number(b.id));
  });

  const ordered = [];
  const visited = new Set();
  const visit = (dep) => {
    const id = Number(dep.id);
    if (visited.has(id)) return;
    visited.add(id);
    ordered.push(dep);
    (byParent.get(id) || []).forEach(visit);
  };

  (byParent.get(null) || []).forEach(visit);
  depositos
    .filter(dep => !visited.has(Number(dep.id)) && (!dep.deposito_padre_id || !byId.has(Number(dep.deposito_padre_id))))
    .sort((a, b) => Number(a.nivel) - Number(b.nivel) || String(a.nombre).localeCompare(String(b.nombre)))
    .forEach(visit);

  return ordered;
}

async function getAncestrosDepositos(depositoIds) {
  if (!depositoIds.length) return [];

  const res = await pool.query(`
    WITH RECURSIVE ancestros AS (
      SELECT p.*
      FROM depositos d
      JOIN depositos p ON p.id = d.deposito_padre_id
      WHERE d.id = ANY($1::int[])
        AND p.activo = true
      UNION
      SELECT gp.*
      FROM depositos p
      JOIN depositos gp ON gp.id = p.deposito_padre_id
      JOIN ancestros a ON a.id = p.id
      WHERE gp.activo = true
    )
    SELECT DISTINCT * FROM ancestros
  `, [depositoIds]);

  return res.rows;
}

async function getStockGeneralReporte(userId, userRol, options = {}) {
  const agruparNivel2 = Boolean(options.agruparNivel2);
  const depositosPermitidos = await getDepositosPermitidos(userId, userRol);
  const depIds = depositosPermitidos.map(d => d.id);
  const ancestros = await getAncestrosDepositos(depIds);
  const depositosById = new Map();
  [...depositosPermitidos, ...ancestros].forEach(dep => {
    depositosById.set(Number(dep.id), dep);
  });

  const depositosReporte = ordenarDepositosJerarquia(
    [...depositosById.values()].filter(dep => !agruparNivel2 || Number(dep.nivel) < 3)
  );

  const [lotesRes, stockRes] = await Promise.all([
    depIds.length
      ? pool.query(`
        SELECT l.id, l.codigo_lote, l.unidad_medida, l.fecha_vencimiento,
          i.codigo as insecticida_codigo, i.nombre as insecticida_nombre,
          COALESCE(SUM(s.cantidad), 0) as total_stock
        FROM lotes l
        JOIN insecticidas i ON i.id = l.insecticida_id
        LEFT JOIN stock s ON s.lote_id = l.id AND s.deposito_id = ANY($1::int[])
        WHERE l.activo IS TRUE AND i.activo IS TRUE
        GROUP BY l.id, i.codigo, i.nombre
        ORDER BY i.nombre, l.fecha_vencimiento, l.codigo_lote
      `, [depIds])
      : Promise.resolve({ rows: [] }),
    depIds.length
      ? pool.query(`
        SELECT
          ${agruparNivel2
            ? `CASE
                WHEN d.nivel = 3 AND d.deposito_padre_id IS NOT NULL THEN d.deposito_padre_id
                ELSE s.deposito_id
              END`
            : 's.deposito_id'} as deposito_id,
          s.lote_id,
          SUM(s.cantidad) as cantidad
        FROM stock s
        JOIN depositos d ON d.id = s.deposito_id
        JOIN lotes l ON l.id = s.lote_id
        JOIN insecticidas i ON i.id = l.insecticida_id
        WHERE s.deposito_id = ANY($1::int[])
          AND s.cantidad > 0
          AND l.activo IS TRUE
          AND i.activo IS TRUE
        GROUP BY 1, s.lote_id
      `, [depIds])
      : Promise.resolve({ rows: [] })
  ]);

  const stockMap = new Map();
  for (const row of stockRes.rows) {
    stockMap.set(`${row.deposito_id}:${row.lote_id}`, Number(row.cantidad || 0));
  }

  const lotes = lotesRes.rows.map(l => ({
    ...l,
    total_stock: Number(l.total_stock || 0)
  }));

  const insecticidaGrupos = [];
  for (const lote of lotes) {
    const last = insecticidaGrupos[insecticidaGrupos.length - 1];
    if (last && last.nombre === lote.insecticida_nombre) {
      last.lotes.push(lote);
    } else {
      insecticidaGrupos.push({
        codigo: lote.insecticida_codigo,
        nombre: lote.insecticida_nombre,
        lotes: [lote]
      });
    }
  }

  const filas = depositosReporte.map(dep => {
    const celdas = lotes.map(lote => stockMap.get(`${dep.id}:${lote.id}`) || 0);
    const total = celdas.reduce((sum, value) => sum + value, 0);
    return { deposito: dep, celdas, total };
  });

  const totalGeneral = filas.reduce((sum, row) => sum + row.total, 0);
  return { depositosReporte, lotes, insecticidaGrupos, filas, totalGeneral, agruparNivel2 };
}

async function getMovimientosPorSemanaInsecticida(query, userId, userRol) {
  const { deposito_id, fecha_desde, fecha_hasta, anio } = query;
  const depositosPermitidos = await getDepositosPermitidos(userId, userRol);
  const depIds = depositosPermitidos.map(d => d.id);
  const year = anio || new Date().getFullYear();
  const conditions = ['m.estado != $1', 'm."año_epidemiologico" = $2'];
  const params = ['anulado', year];
  let idx = 3;

  if (depIds.length) {
    conditions.push(`(m.deposito_origen_id = ANY($${idx}::int[]) OR m.deposito_destino_id = ANY($${idx}::int[]))`);
    params.push(depIds);
    idx++;
  }
  if (deposito_id) {
    conditions.push(`(m.deposito_origen_id = $${idx} OR m.deposito_destino_id = $${idx})`);
    params.push(deposito_id);
    idx++;
  }
  if (fecha_desde) {
    conditions.push(`m.fecha_movimiento >= $${idx}`);
    params.push(fecha_desde);
    idx++;
  }
  if (fecha_hasta) {
    conditions.push(`m.fecha_movimiento <= $${idx}`);
    params.push(fecha_hasta);
    idx++;
  }

  const result = await pool.query(`
    SELECT
      m.semana_epidemiologica,
      i.id as insecticida_id,
      i.nombre as insecticida_nombre,
      l.unidad_medida,
      SUM(m.cantidad) as total
    FROM movimientos m
    JOIN insecticidas i ON i.id = m.insecticida_id
    JOIN lotes l ON l.id = m.lote_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY m.semana_epidemiologica, i.id, i.nombre, l.unidad_medida
    ORDER BY m.semana_epidemiologica, i.nombre, l.unidad_medida
  `, params);

  const semanas = [...new Set(result.rows.map(row => Number(row.semana_epidemiologica)))].sort((a, b) => a - b);
  const series = [...new Map(result.rows.map(row => [
    `${row.insecticida_id}:${row.unidad_medida || ''}`,
    {
      id: row.insecticida_id,
      nombre: row.insecticida_nombre,
      unidad: row.unidad_medida || ''
    }
  ])).values()].sort((a, b) => a.nombre.localeCompare(b.nombre) || a.unidad.localeCompare(b.unidad));
  const totals = new Map(result.rows.map(row => [
    `${row.semana_epidemiologica}:${row.insecticida_id}:${row.unidad_medida || ''}`,
    Number(row.total || 0)
  ]));
  const unidades = [...new Set(series.map(ins => ins.unidad || 'Sin unidad'))].sort((a, b) => a.localeCompare(b));
  const unitGroups = unidades.map(unidad => {
    const unitSeries = series.filter(ins => (ins.unidad || 'Sin unidad') === unidad);
    return {
      unidad,
      labels: semanas.map(semana => `SE ${semana}`),
      datasets: unitSeries.map(ins => ({
        label: ins.nombre,
        data: semanas.map(semana => totals.get(`${semana}:${ins.id}:${ins.unidad}`) || 0),
        meta: {
          unidad_medida: ins.unidad
        }
      }))
    };
  });

  return {
    year,
    rows: result.rows,
    labels: semanas.map(semana => `SE ${semana}`),
    unitGroups,
    datasets: series.map(ins => ({
      label: `${ins.nombre}${ins.unidad ? ` (${ins.unidad})` : ''}`,
      data: semanas.map(semana => totals.get(`${semana}:${ins.id}:${ins.unidad}`) || 0),
      meta: {
        unidad_medida: ins.unidad
      }
    }))
  };
}

async function getAniosGraficoDisponibles(depositosPermitidos, depositoId) {
  const depIds = depositosPermitidos.map(d => d.id);
  const movConditions = ["m.estado != 'anulado'"];
  const stockConditions = ['s.cantidad > 0', 'l.activo IS TRUE', 'i.activo IS TRUE'];
  const params = [];
  let idx = 1;

  if (depIds.length) {
    movConditions.push(`(m.deposito_origen_id = ANY($${idx}::int[]) OR m.deposito_destino_id = ANY($${idx}::int[]))`);
    stockConditions.push(`s.deposito_id = ANY($${idx}::int[])`);
    params.push(depIds);
    idx++;
  }

  if (depositoId) {
    movConditions.push(`(m.deposito_origen_id = $${idx} OR m.deposito_destino_id = $${idx})`);
    stockConditions.push(`s.deposito_id = $${idx}`);
    params.push(depositoId);
  }

  const result = await pool.query(`
    WITH anios AS (
      SELECT DISTINCT m."año_epidemiologico"::int as anio
      FROM movimientos m
      WHERE ${movConditions.join(' AND ')}
        AND m."año_epidemiologico" IS NOT NULL
      UNION
      SELECT DISTINCT EXTRACT(YEAR FROM s.updated_at)::int as anio
      FROM stock s
      JOIN lotes l ON l.id = s.lote_id
      JOIN insecticidas i ON i.id = l.insecticida_id
      WHERE ${stockConditions.join(' AND ')}
        AND s.updated_at IS NOT NULL
    )
    SELECT anio
    FROM anios
    ORDER BY anio DESC
  `, params);

  return result.rows.map(row => Number(row.anio)).filter(Boolean);
}

exports.index = async (req, res) => {
  res.render('reportes/index', { title: 'Reportes' });
};

exports.movimientos = async (req, res) => {
  const {
    deposito_id,
    tipo_deposito,
    insecticida_id,
    lote_id,
    fecha_desde,
    fecha_hasta,
    semana,
    anio,
    tipo_mov,
    formato
  } = req.query;

  try {
    const depositosPermitidos = await getDepositosPermitidos(req.session.userId, req.session.userRol);
    const depIds = depositosPermitidos.map(d => d.id);
    const conditions = ["m.estado != 'anulado'"];
    const params = [];
    let idx = 1;

    if (depIds.length) {
      conditions.push(`(m.deposito_origen_id = ANY($${idx}::int[]) OR m.deposito_destino_id = ANY($${idx}::int[]))`);
      params.push(depIds);
      idx++;
    }

    if (deposito_id) {
      conditions.push(`(m.deposito_origen_id = $${idx} OR m.deposito_destino_id = $${idx})`);
      params.push(deposito_id);
      idx++;
    }
    if (tipo_deposito) {
      conditions.push(`(dor.tipo = $${idx} OR dde.tipo = $${idx})`);
      params.push(tipo_deposito);
      idx++;
    }
    if (insecticida_id) {
      conditions.push(`m.insecticida_id = $${idx}`);
      params.push(insecticida_id);
      idx++;
    }
    if (lote_id) {
      conditions.push(`m.lote_id = $${idx}`);
      params.push(lote_id);
      idx++;
    }
    if (fecha_desde) {
      conditions.push(`m.fecha_movimiento >= $${idx}`);
      params.push(fecha_desde);
      idx++;
    }
    if (fecha_hasta) {
      conditions.push(`m.fecha_movimiento <= $${idx}`);
      params.push(fecha_hasta);
      idx++;
    }
    if (semana) {
      conditions.push(`m.semana_epidemiologica = $${idx}`);
      params.push(semana);
      idx++;
    }
    if (anio) {
      conditions.push(`m."año_epidemiologico" = $${idx}`);
      params.push(anio);
      idx++;
    }
    if (tipo_mov) {
      conditions.push(`m.tipo_movimiento = $${idx}`);
      params.push(tipo_mov);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows, insecticidas, lotes] = await Promise.all([
      pool.query(`
        SELECT m.*, m."año_epidemiologico" as anio_epidemiologico,
          i.nombre as insecticida_nombre, i.tipo_uso, l.unidad_medida,
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
        ORDER BY m.fecha_movimiento DESC, m.numero_mov
      `, params),
      pool.query('SELECT id, codigo, nombre FROM insecticidas WHERE activo = true ORDER BY nombre'),
      pool.query('SELECT id, codigo_lote FROM lotes WHERE activo = true ORDER BY codigo_lote')
    ]);

    res.render('reportes/movimientos', {
      title: 'Reporte de Movimientos',
      movimientos: rows.rows,
      filtros: { deposito_id, tipo_deposito, insecticida_id, lote_id, fecha_desde, fecha_hasta, semana, anio, tipo_mov },
      depositos: depositosPermitidos,
      insecticidas: insecticidas.rows,
      lotes: lotes.rows,
      formatearFecha,
      formatearNumero,
      formatearCantidad,
      tipoMovimientoLabel,
      tipoDepositoLabel,
      querystring: cleanQueryString(req.query),
      print: formato === 'imprimir',
      layout: formato === 'imprimir' ? 'layouts/print' : 'layouts/main'
    });
  } catch (err) {
    console.error('Error cargando reporte de movimientos:', err);
    req.flash('error', 'Error al cargar reporte de movimientos.');
    res.redirect('/reportes');
  }
};

exports.stock = async (req, res) => {
  const { deposito_id, tipo_deposito, insecticida_id, formato, incluir_cero } = req.query;

  try {
    const depositosPermitidos = await getDepositosPermitidos(req.session.userId, req.session.userRol);
    const depIds = depositosPermitidos.map(d => d.id);
    const conditions = depIds.length ? ['s.deposito_id = ANY($1::int[])'] : [];
    const params = depIds.length ? [depIds] : [];
    let idx = params.length + 1;

    if (deposito_id) {
      conditions.push(`s.deposito_id = $${idx}`);
      params.push(deposito_id);
      idx++;
    }
    if (tipo_deposito) {
      conditions.push(`d.tipo = $${idx}`);
      params.push(tipo_deposito);
      idx++;
    }
    if (insecticida_id) {
      conditions.push(`i.id = $${idx}`);
      params.push(insecticida_id);
      idx++;
    }
    if (!incluir_cero) {
      conditions.push('s.cantidad > 0');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows, selectedOptions] = await Promise.all([
      pool.query(`
        SELECT d.codigo as deposito_codigo, d.nombre as deposito_nombre, d.tipo as deposito_tipo, d.nivel,
          i.nombre as insecticida_nombre, i.tipo_uso, l.unidad_medida,
          l.codigo_lote, l.fecha_vencimiento, s.cantidad, s.updated_at
        FROM stock s
        JOIN depositos d ON s.deposito_id = d.id
        JOIN lotes l ON s.lote_id = l.id
        JOIN insecticidas i ON l.insecticida_id = i.id
        ${where}
        ORDER BY d.nivel, d.nombre, i.nombre, l.fecha_vencimiento
      `, params),
      getSelectedStockFilterOptions({ depositoId: deposito_id, insecticidaId: insecticida_id }, req.session.userId, req.session.userRol)
    ]);

    res.render('reportes/stock', {
      title: 'Reporte de Stock',
      stock: rows.rows,
      filtros: {
        deposito_id,
        tipo_deposito: tipo_deposito || selectedOptions.deposito?.tipo || '',
        insecticida_id,
        incluir_cero
      },
      selectedOptions,
      formatearFecha,
      formatearCantidad,
      tipoDepositoLabel,
      querystring: cleanQueryString(req.query),
      print: formato === 'imprimir',
      layout: formato === 'imprimir' ? 'layouts/print' : 'layouts/main'
    });
  } catch (err) {
    console.error('Error cargando reporte de stock:', err);
    req.flash('error', 'Error al cargar reporte de stock.');
    res.redirect('/reportes');
  }
};

exports.stockGeneral = async (req, res) => {
  const { formato } = req.query;
  const agruparNivel2 = req.query.agrupar_nivel_2 === 'true';

  try {
    const data = await getStockGeneralReporte(req.session.userId, req.session.userRol, { agruparNivel2 });

    res.render('reportes/stock-general', {
      title: 'Reporte de Stock General',
      depositos: data.depositosReporte,
      lotes: data.lotes,
      insecticidaGrupos: data.insecticidaGrupos,
      filas: data.filas,
      totalGeneral: data.totalGeneral,
      filtros: { agrupar_nivel_2: agruparNivel2 },
      querystring: cleanQueryString(req.query),
      formatearFecha,
      formatearNumero,
      print: formato === 'imprimir',
      layout: formato === 'imprimir' ? 'layouts/print' : 'layouts/main'
    });
  } catch (err) {
    console.error('Error cargando reporte de stock general:', err);
    req.flash('error', 'Error al cargar reporte de stock general.');
    res.redirect('/reportes/stock');
  }
};

exports.stockFilterDepositos = async (req, res) => {
  try {
    const { tipo_deposito, q = '' } = req.query;
    if (!tipo_deposito) return res.json({ depositos: [] });

    const depositosPermitidos = await getDepositosPermitidos(req.session.userId, req.session.userRol);
    const depIds = depositosPermitidos.map(d => d.id);
    if (!depIds.length) return res.json({ depositos: [] });

    const params = [depIds, tipo_deposito];
    const conditions = ['d.activo = true', 'd.id = ANY($1::int[])', 'd.tipo = $2'];

    if (q.trim()) {
      params.push(`%${q.trim()}%`);
      conditions.push(`(d.codigo ILIKE $${params.length} OR d.nombre ILIKE $${params.length})`);
    }

    const { rows } = await pool.query(`
      SELECT d.id, d.codigo, d.nombre, d.tipo, d.nivel
      FROM depositos d
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.nivel, d.nombre
      LIMIT 80
    `, params);

    res.json({ depositos: rows });
  } catch (err) {
    console.error('Error cargando depositos para filtro de stock:', err);
    res.status(500).json({ error: 'Error al cargar depositos.' });
  }
};

exports.stockFilterInsecticidas = async (req, res) => {
  try {
    const { deposito_id, q = '' } = req.query;
    if (!deposito_id) return res.json({ insecticidas: [] });

    const depositosPermitidos = await getDepositosPermitidos(req.session.userId, req.session.userRol);
    const depIds = depositosPermitidos.map(d => Number(d.id));
    const depositoId = Number(deposito_id);

    if (!depIds.includes(depositoId)) return res.status(403).json({ error: 'Deposito no permitido.' });

    const params = [depositoId];
    const conditions = ['s.deposito_id = $1', 'i.activo = true', 'l.activo = true'];

    if (q.trim()) {
      params.push(`%${q.trim()}%`);
      conditions.push(`(i.codigo ILIKE $${params.length} OR i.nombre ILIKE $${params.length})`);
    }

    const { rows } = await pool.query(`
      SELECT DISTINCT i.id, i.codigo, i.nombre
      FROM stock s
      JOIN lotes l ON l.id = s.lote_id
      JOIN insecticidas i ON i.id = l.insecticida_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY i.nombre
      LIMIT 80
    `, params);

    res.json({ insecticidas: rows });
  } catch (err) {
    console.error('Error cargando insecticidas para filtro de stock:', err);
    res.status(500).json({ error: 'Error al cargar insecticidas.' });
  }
};

exports.grafico = async (req, res) => {
  const { tipo_grafico = 'movimientos_por_tipo', deposito_id, fecha_desde, fecha_hasta, anio, formato } = req.query;

  try {
    const depositosPermitidos = await getDepositosPermitidos(req.session.userId, req.session.userRol);
    const depIds = depositosPermitidos.map(d => d.id);
    const aniosDisponibles = await getAniosGraficoDisponibles(depositosPermitidos, deposito_id);
    const anioSeleccionado = aniosDisponibles.includes(Number(anio)) ? Number(anio) : (aniosDisponibles[0] || '');
    const params = [];
    const conditions = ["estado != 'anulado'"];
    let idx = 1;

    if (depIds.length) {
      conditions.push(`(deposito_origen_id = ANY($${idx}::int[]) OR deposito_destino_id = ANY($${idx}::int[]))`);
      params.push(depIds);
      idx++;
    }
    if (deposito_id) {
      conditions.push(`(deposito_origen_id = $${idx} OR deposito_destino_id = $${idx})`);
      params.push(deposito_id);
      idx++;
    }
    if (fecha_desde) {
      conditions.push(`fecha_movimiento >= $${idx}`);
      params.push(fecha_desde);
      idx++;
    }
    if (fecha_hasta) {
      conditions.push(`fecha_movimiento <= $${idx}`);
      params.push(fecha_hasta);
      idx++;
    }
    if (anioSeleccionado) {
      conditions.push(`"año_epidemiologico" = $${idx}`);
      params.push(anioSeleccionado);
      idx++;
    }

    let chartData = { labels: [], datasets: [] };

    if (tipo_grafico === 'movimientos_por_tipo') {
      const r = await pool.query(`
        SELECT tipo_movimiento, COUNT(*) as total
        FROM movimientos
        WHERE ${conditions.join(' AND ')}
        GROUP BY tipo_movimiento
        ORDER BY total DESC
      `, params);
      chartData = {
        labels: r.rows.map(x => tipoMovimientoLabel(x.tipo_movimiento)),
        datasets: [{ label: 'Cantidad de movimientos', data: r.rows.map(x => Number(x.total)) }]
      };
    }

    if (tipo_grafico === 'stock_por_insecticida') {
      const stockConditions = [];
      const stockParams = [];
      let stockIdx = 1;

      if (depIds.length) {
        stockConditions.push(`s.deposito_id = ANY($${stockIdx}::int[])`);
        stockParams.push(depIds);
        stockIdx++;
      }
      if (deposito_id) {
        stockConditions.push(`s.deposito_id = $${stockIdx}`);
        stockParams.push(deposito_id);
        stockIdx++;
      }

      const stockWhere = stockConditions.length ? `AND ${stockConditions.join(' AND ')}` : '';
      const r = await pool.query(`
        SELECT
          i.id as insecticida_id,
          i.nombre as insecticida_nombre,
          l.id as lote_id,
          l.codigo_lote,
          l.fecha_vencimiento,
          TO_CHAR(l.fecha_vencimiento, 'DD/MM/YYYY') as fecha_vencimiento_label,
          l.fecha_vencimiento - CURRENT_DATE as dias_vencimiento,
          l.unidad_medida,
          SUM(s.cantidad) as total
        FROM stock s
        JOIN lotes l ON s.lote_id = l.id
        JOIN insecticidas i ON l.insecticida_id = i.id
        WHERE s.cantidad > 0 ${stockWhere}
        GROUP BY i.id, i.nombre, l.id
        ORDER BY i.nombre, l.fecha_vencimiento, l.codigo_lote
      `, stockParams);

      const stockRows = r.rows.map(row => {
          const cantidad = Number(row.total || 0);
          const color = colorLotePorVencimiento(row.dias_vencimiento);
          const meta = {
            insecticida: row.insecticida_nombre,
            lote: row.codigo_lote,
            vencimiento: row.fecha_vencimiento_label,
            dias_vencimiento: Number(row.dias_vencimiento),
            estado_vencimiento: estadoLotePorVencimiento(row.dias_vencimiento),
            unidad_medida: row.unidad_medida,
            cantidad
          };

          return {
            label: `${row.codigo_lote} | ${formatearCantidad(cantidad, row.unidad_medida || '')} | Vto. ${row.fecha_vencimiento_label} | ${meta.estado_vencimiento}`,
            insecticida: row.insecticida_nombre,
            unidad: row.unidad_medida || 'Sin unidad',
            value: cantidad,
            backgroundColor: color,
            borderColor: color,
            borderWidth: 1,
            stack: 'stock',
            meta
          };
      });
      const labels = [...new Set(stockRows.map(x => x.insecticida))];
      const totalsByInsecticida = new Map(labels.map(label => [label, 0]));
      stockRows.forEach(row => {
        totalsByInsecticida.set(row.insecticida, totalsByInsecticida.get(row.insecticida) + Number(row.value || 0));
      });
      labels.sort((a, b) => totalsByInsecticida.get(b) - totalsByInsecticida.get(a) || a.localeCompare(b));

      const unidades = [...new Set(stockRows.map(row => row.unidad || 'Sin unidad'))].sort((a, b) => a.localeCompare(b));
      const unitGroups = unidades.map(unidad => {
        const unitRows = stockRows.filter(row => (row.unidad || 'Sin unidad') === unidad);
        const unitLabels = [...new Set(unitRows.map(row => row.insecticida))].sort((a, b) => {
          const totalA = unitRows.filter(row => row.insecticida === a).reduce((sum, row) => sum + Number(row.value || 0), 0);
          const totalB = unitRows.filter(row => row.insecticida === b).reduce((sum, row) => sum + Number(row.value || 0), 0);
          return totalB - totalA || a.localeCompare(b);
        });
        return {
          unidad,
          labels: unitLabels,
          datasets: unitRows.map(row => ({
            ...row,
            data: unitLabels.map(label => (label === row.insecticida ? row.value : 0))
          }))
        };
      });

      chartData = {
        labels,
        chartType: 'stock_por_insecticida',
        unitGroups,
        datasets: stockRows.map(row => ({
          ...row,
          data: labels.map(label => (label === row.insecticida ? row.value : 0))
        }))
      };
    }

    if (tipo_grafico === 'movimientos_por_semana') {
      const semanal = await getMovimientosPorSemanaInsecticida(
        { ...req.query, anio: anioSeleccionado || undefined },
        req.session.userId,
        req.session.userRol
      );
      chartData = {
        labels: semanal.labels,
        chartType: 'movimientos_por_semana_por_unidad',
        unitGroups: semanal.unitGroups,
        datasets: semanal.datasets
      };
    }

    res.render('reportes/grafico', {
      title: 'Reportes Graficos',
      chartData,
      tipo_grafico,
      filtros: { deposito_id, fecha_desde, fecha_hasta, anio: anioSeleccionado },
      depositos: depositosPermitidos,
      anios: aniosDisponibles,
      querystring: cleanQueryString({ ...req.query, anio: anioSeleccionado || '' }),
      print: formato === 'imprimir',
      layout: formato === 'imprimir' ? 'layouts/print' : 'layouts/main'
    });
  } catch (err) {
    console.error('Error cargando reporte grafico:', err);
    req.flash('error', 'Error al cargar reporte grafico.');
    res.redirect('/reportes');
  }
};

async function getGraficoExport(query, userId, userRol) {
  const { tipo_grafico = 'movimientos_por_tipo', deposito_id, fecha_desde, fecha_hasta, anio } = query;
  const depositosPermitidos = await getDepositosPermitidos(userId, userRol);
  const depIds = depositosPermitidos.map(d => d.id);
  const params = [];
  const conditions = ["estado != 'anulado'"];
  let idx = 1;

  if (depIds.length) {
    conditions.push(`(deposito_origen_id = ANY($${idx}::int[]) OR deposito_destino_id = ANY($${idx}::int[]))`);
    params.push(depIds);
    idx++;
  }
  if (deposito_id) {
    conditions.push(`(deposito_origen_id = $${idx} OR deposito_destino_id = $${idx})`);
    params.push(deposito_id);
    idx++;
  }
  if (fecha_desde) {
    conditions.push(`fecha_movimiento >= $${idx}`);
    params.push(fecha_desde);
    idx++;
  }
  if (fecha_hasta) {
    conditions.push(`fecha_movimiento <= $${idx}`);
    params.push(fecha_hasta);
    idx++;
  }
  if (anio) {
    conditions.push(`"año_epidemiologico" = $${idx}`);
    params.push(anio);
    idx++;
  }

  if (tipo_grafico === 'stock_por_insecticida') {
    const stockConditions = [];
    const stockParams = [];
    let stockIdx = 1;

    if (depIds.length) {
      stockConditions.push(`s.deposito_id = ANY($${stockIdx}::int[])`);
      stockParams.push(depIds);
      stockIdx++;
    }
    if (deposito_id) {
      stockConditions.push(`s.deposito_id = $${stockIdx}`);
      stockParams.push(deposito_id);
      stockIdx++;
    }

    const stockWhere = stockConditions.length ? `AND ${stockConditions.join(' AND ')}` : '';
    const r = await pool.query(`
      SELECT i.nombre as insecticida, l.codigo_lote as lote,
        TO_CHAR(l.fecha_vencimiento, 'DD/MM/YYYY') as vencimiento,
        l.unidad_medida as unidad, SUM(s.cantidad) as total
      FROM stock s
      JOIN lotes l ON s.lote_id = l.id
      JOIN insecticidas i ON l.insecticida_id = i.id
      WHERE s.cantidad > 0 ${stockWhere}
      GROUP BY i.nombre, l.id
      ORDER BY i.nombre, l.fecha_vencimiento, l.codigo_lote
    `, stockParams);

    return {
      sheetName: 'Stock por insecticida',
      filename: 'reporte-grafico-stock',
      columns: [
        { key: 'insecticida', header: 'Insecticida' },
        { key: 'lote', header: 'Lote' },
        { key: 'vencimiento', header: 'Vencimiento' },
        { key: 'unidad', header: 'Unidad' },
        { key: 'total', header: 'Total' }
      ],
      rows: r.rows.map(row => ({ ...row, total: formatearNumero(row.total, 3) }))
    };
  }

  if (tipo_grafico === 'movimientos_por_semana') {
    const semanal = await getMovimientosPorSemanaInsecticida(query, userId, userRol);

    return {
      sheetName: 'Movimientos por semana',
      filename: 'reporte-grafico-semanas',
      columns: [
        { key: 'semana', header: 'Semana Epidemiologica' },
        { key: 'anio', header: 'Anio' },
        { key: 'insecticida', header: 'Insecticida' },
        { key: 'unidad', header: 'Unidad de Medida' },
        { key: 'total', header: 'Cantidad Movida' }
      ],
      rows: semanal.rows.map(row => ({
        semana: `SE ${row.semana_epidemiologica}`,
        anio: semanal.year,
        insecticida: row.insecticida_nombre,
        unidad: row.unidad_medida || '',
        total: formatearNumero(row.total, 3)
      }))
    };
  }

  const r = await pool.query(`
    SELECT tipo_movimiento, COUNT(*) as total
    FROM movimientos
    WHERE ${conditions.join(' AND ')}
    GROUP BY tipo_movimiento
    ORDER BY total DESC
  `, params);

  return {
    sheetName: 'Movimientos por tipo',
    filename: 'reporte-grafico-tipos',
    columns: [
      { key: 'tipo', header: 'Tipo de Movimiento' },
      { key: 'total', header: 'Cantidad de Movimientos' }
    ],
    rows: r.rows.map(row => ({
      tipo: tipoMovimientoLabel(row.tipo_movimiento),
      total: row.total
    }))
  };
}

function sendExport(res, format, filename, columns, rows, sheetName) {
  const file = buildReportFile(format, columns, rows, sheetName);
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.${file.extension}"`);
  res.send(file.buffer);
}

exports.exportar = async (req, res) => {
  const { reporte } = req.params;
  const format = String(req.query.formato || '').toLowerCase();
  const allowedFormats = ['csv', 'xlsx', 'dbf'];

  if (!canExportReports(req.session.userRol)) {
    req.flash('error', 'No tiene permisos para exportar reportes.');
    return res.redirect('/reportes');
  }

  if (!allowedFormats.includes(format)) {
    req.flash('error', 'Formato de exportacion no valido.');
    return res.redirect('/reportes');
  }

  try {
    if (reporte === 'movimientos') {
      const { rows } = await getMovimientosReporte(req.query, req.session.userId, req.session.userRol);
      const columns = [
        { key: 'numero_mov', header: 'Nro. Movimiento' },
        { key: 'fecha_movimiento', header: 'Fecha' },
        { key: 'semana', header: 'Semana Epidemiologica' },
        { key: 'tipo_movimiento', header: 'Tipo' },
        { key: 'insecticida_nombre', header: 'Insecticida' },
        { key: 'codigo_lote', header: 'Lote' },
        { key: 'origen_nombre', header: 'Origen' },
        { key: 'destino_nombre', header: 'Destino' },
        { key: 'cantidad', header: 'Cantidad' },
        { key: 'unidad_medida', header: 'Unidad' },
        { key: 'usuario_nombre', header: 'Responsable' },
        { key: 'estado', header: 'Estado' }
      ];
      const exportRows = rows.map(row => ({
        numero_mov: row.numero_mov,
        fecha_movimiento: formatearFecha(row.fecha_movimiento),
        semana: `SE${row.semana_epidemiologica}/${row.anio_epidemiologico || ''}`,
        tipo_movimiento: tipoMovimientoLabel(row.tipo_movimiento),
        insecticida_nombre: row.insecticida_nombre,
        codigo_lote: row.codigo_lote,
        origen_nombre: row.origen_nombre || '',
        destino_nombre: row.destino_nombre || '',
        cantidad: formatearNumero(row.cantidad, 3),
        unidad_medida: row.unidad_medida || '',
        usuario_nombre: row.usuario_nombre || '',
        estado: row.estado
      }));
      return sendExport(res, format, 'reporte-movimientos', columns, exportRows, 'Movimientos');
    }

    if (reporte === 'stock') {
      const { rows } = await getStockReporte(req.query, req.session.userId, req.session.userRol);
      const columns = [
        { key: 'deposito', header: 'Deposito' },
        { key: 'tipo', header: 'Tipo' },
        { key: 'insecticida', header: 'Insecticida' },
        { key: 'lote', header: 'Lote' },
        { key: 'vencimiento', header: 'Vencimiento' },
        { key: 'stock', header: 'Stock' },
        { key: 'unidad', header: 'Unidad' },
        { key: 'actualizado', header: 'Actualizado' }
      ];
      const exportRows = rows.map(row => ({
        deposito: `${row.deposito_codigo || ''} ${row.deposito_nombre || ''}`.trim(),
        tipo: `N${row.nivel} ${tipoDepositoLabel(row.deposito_tipo)}`,
        insecticida: row.insecticida_nombre,
        lote: row.codigo_lote,
        vencimiento: formatearFecha(row.fecha_vencimiento),
        stock: formatearNumero(row.cantidad, 3),
        unidad: row.unidad_medida || '',
        actualizado: formatearFecha(row.updated_at)
      }));
      return sendExport(res, format, 'reporte-stock', columns, exportRows, 'Stock');
    }

    if (reporte === 'stock-general') {
      const data = await getStockGeneralReporte(req.session.userId, req.session.userRol, {
        agruparNivel2: req.query.agrupar_nivel_2 === 'true'
      });
      const lotesColumns = data.lotes.map((lote, index) => ({
        key: `lote_${index}`,
        header: `${lote.insecticida_nombre} - Lote ${lote.codigo_lote} - Vto. ${formatearFecha(lote.fecha_vencimiento)}`,
        dbfName: `LOTE${String(index + 1).padStart(3, '0')}`
      }));
      const columns = [
        { key: 'deposito', header: 'Deposito', dbfName: 'DEPOSITO' },
        ...lotesColumns,
        { key: 'total', header: 'Total', dbfName: 'TOTAL' }
      ];
      const exportRows = data.filas.map(row => {
        const out = {
          deposito: `N${row.deposito.nivel} - ${row.deposito.nombre}`,
          total: formatearNumero(row.total, 3)
        };
        row.celdas.forEach((value, index) => {
          out[`lote_${index}`] = value ? formatearNumero(value, 3) : formatearNumero(0, 3);
        });
        return out;
      });
      return sendExport(res, format, 'reporte-stock-general', columns, exportRows, 'Stock General');
    }

    if (reporte === 'grafico') {
      const data = await getGraficoExport(req.query, req.session.userId, req.session.userRol);
      return sendExport(res, format, data.filename, data.columns, data.rows, data.sheetName);
    }

    req.flash('error', 'Reporte no encontrado.');
    return res.redirect('/reportes');
  } catch (err) {
    console.error('Error exportando reporte:', err);
    req.flash('error', 'Error al exportar el reporte.');
    return res.redirect('/reportes');
  }
};
