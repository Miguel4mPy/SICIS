const pool = require('../../config/database');
const {
  formatearFecha,
  formatearCantidad,
  tipoMovimientoLabel,
  tipoDepositoLabel,
  getAnios
} = require('../utils/helpers');

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
      tipoMovimientoLabel,
      tipoDepositoLabel,
      querystring: new URLSearchParams({ ...req.query, formato: '' }).toString().replace(/(^|&)formato=$/, ''),
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

    const [rows, insecticidas] = await Promise.all([
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
      pool.query('SELECT * FROM insecticidas WHERE activo = true ORDER BY nombre')
    ]);

    res.render('reportes/stock', {
      title: 'Reporte de Stock',
      stock: rows.rows,
      filtros: { deposito_id, tipo_deposito, insecticida_id, incluir_cero },
      depositos: depositosPermitidos,
      insecticidas: insecticidas.rows,
      formatearFecha,
      formatearCantidad,
      tipoDepositoLabel,
      querystring: new URLSearchParams({ ...req.query, formato: '' }).toString().replace(/(^|&)formato=$/, ''),
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
  try {
    const depositosPermitidos = await getDepositosPermitidos(req.session.userId, req.session.userRol);
    const depIds = depositosPermitidos.map(d => d.id);
    const depIdsVisiblesSet = new Set(depositosPermitidos.filter(d => Number(d.nivel) < 3).map(d => Number(d.id)));

    const padresNivel3Res = depIds.length
      ? await pool.query(`
        SELECT DISTINCT dp.*
        FROM depositos d
        JOIN depositos dp ON dp.id = d.deposito_padre_id
        WHERE d.id = ANY($1::int[])
          AND d.nivel = 3
          AND dp.activo = true
      `, [depIds])
      : { rows: [] };

    const depositosReporte = [
      ...depositosPermitidos.filter(d => Number(d.nivel) < 3),
      ...padresNivel3Res.rows.filter(d => !depIdsVisiblesSet.has(Number(d.id)))
    ].sort((a, b) => Number(a.nivel) - Number(b.nivel) || String(a.nombre).localeCompare(String(b.nombre)));

    const [lotesRes, stockRes] = await Promise.all([
      depIds.length
        ? pool.query(`
          SELECT l.id, l.codigo_lote, l.unidad_medida, l.fecha_vencimiento,
            i.codigo as insecticida_codigo, i.nombre as insecticida_nombre,
            COALESCE(SUM(s.cantidad), 0) as total_stock
          FROM lotes l
          JOIN insecticidas i ON i.id = l.insecticida_id
          LEFT JOIN stock s ON s.lote_id = l.id AND s.deposito_id = ANY($1::int[])
          WHERE l.activo = true AND i.activo = true
          GROUP BY l.id, i.codigo, i.nombre
          ORDER BY i.nombre, l.fecha_vencimiento, l.codigo_lote
        `, [depIds])
        : Promise.resolve({ rows: [] }),
      depIds.length
        ? pool.query(`
          SELECT
            CASE
              WHEN d.nivel = 3 AND d.deposito_padre_id IS NOT NULL THEN d.deposito_padre_id
              ELSE s.deposito_id
            END as deposito_id,
            s.lote_id,
            SUM(s.cantidad) as cantidad
          FROM stock s
          JOIN depositos d ON d.id = s.deposito_id
          WHERE s.deposito_id = ANY($1::int[]) AND s.cantidad > 0
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

    res.render('reportes/stock-general', {
      title: 'Reporte de Stock General',
      depositos: depositosReporte,
      lotes,
      insecticidaGrupos,
      filas,
      totalGeneral,
      formatearFecha
    });
  } catch (err) {
    console.error('Error cargando reporte de stock general:', err);
    req.flash('error', 'Error al cargar reporte de stock general.');
    res.redirect('/reportes/stock');
  }
};

exports.grafico = async (req, res) => {
  const { tipo_grafico = 'movimientos_por_tipo', deposito_id, fecha_desde, fecha_hasta, anio, formato } = req.query;

  try {
    const depositosPermitidos = await getDepositosPermitidos(req.session.userId, req.session.userRol);
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

      const labels = [...new Set(r.rows.map(x => x.insecticida_nombre))];
      const totalsByInsecticida = new Map(labels.map(label => [label, 0]));
      r.rows.forEach(row => {
        totalsByInsecticida.set(row.insecticida_nombre, totalsByInsecticida.get(row.insecticida_nombre) + Number(row.total || 0));
      });
      labels.sort((a, b) => totalsByInsecticida.get(b) - totalsByInsecticida.get(a) || a.localeCompare(b));

      chartData = {
        labels,
        chartType: 'stock_por_insecticida',
        datasets: r.rows.map(row => {
          const cantidad = Number(row.total || 0);
          const data = labels.map(label => (label === row.insecticida_nombre ? cantidad : 0));
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
            label: `${row.codigo_lote} | ${formatearCantidad(cantidad)} ${row.unidad_medida || ''} | Vto. ${row.fecha_vencimiento_label}`,
            data,
            backgroundColor: color,
            borderColor: color,
            borderWidth: 1,
            stack: 'stock',
            meta
          };
        })
      };
    }

    if (tipo_grafico === 'movimientos_por_semana') {
      const year = anio || new Date().getFullYear();
      const r = await pool.query(`
        SELECT semana_epidemiologica, SUM(cantidad) as total
        FROM movimientos
        WHERE estado != 'anulado' AND "año_epidemiologico" = $1
        ${depIds.length ? 'AND (deposito_origen_id = ANY($2::int[]) OR deposito_destino_id = ANY($2::int[]))' : ''}
        GROUP BY semana_epidemiologica
        ORDER BY semana_epidemiologica
      `, depIds.length ? [year, depIds] : [year]);
      chartData = {
        labels: r.rows.map(x => `SE ${x.semana_epidemiologica}`),
        datasets: [{ label: 'Cantidad movida', data: r.rows.map(x => Number(x.total)) }]
      };
    }

    res.render('reportes/grafico', {
      title: 'Reportes Graficos',
      chartData,
      tipo_grafico,
      filtros: { deposito_id, fecha_desde, fecha_hasta, anio },
      depositos: depositosPermitidos,
      anios: getAnios(),
      querystring: new URLSearchParams({ ...req.query, formato: '' }).toString().replace(/(^|&)formato=$/, ''),
      print: formato === 'imprimir',
      layout: formato === 'imprimir' ? 'layouts/print' : 'layouts/main'
    });
  } catch (err) {
    console.error('Error cargando reporte grafico:', err);
    req.flash('error', 'Error al cargar reporte grafico.');
    res.redirect('/reportes');
  }
};
