const os = require('os');
const pool = require('../../config/database');

function normalizeLimit(value, fallback = 80) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, 20), 250);
}

function addDateFilters(filters, params, alias, desde, hasta) {
  if (desde) {
    params.push(desde);
    filters.push(`${alias}.created_at >= $${params.length}`);
  }
  if (hasta) {
    params.push(`${hasta} 23:59:59`);
    filters.push(`${alias}.created_at <= $${params.length}`);
  }
}

function toMb(bytes) {
  return Number(bytes || 0) / 1024 / 1024;
}

function percent(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (Number(value || 0) / Number(total)) * 100));
}

function cpuSnapshot() {
  return os.cpus().reduce((acc, cpu) => {
    const times = cpu.times;
    const idle = times.idle;
    const total = Object.values(times).reduce((sum, value) => sum + value, 0);
    return {
      idle: acc.idle + idle,
      total: acc.total + total
    };
  }, { idle: 0, total: 0 });
}

function cpuPercentBetween(start, end) {
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;
  return totalDelta > 0 ? percent(totalDelta - idleDelta, totalDelta) : null;
}

exports.index = async (req, res) => {
  const {
    tipo = 'todos',
    usuario_id = '',
    accion = '',
    tabla = '',
    nivel = '',
    origen = '',
    buscar = '',
    fecha_desde = '',
    fecha_hasta = '',
    limit = 80
  } = req.query;

  const rowLimit = normalizeLimit(limit);

  try {
    const auditFilters = [];
    const auditParams = [];
    addDateFilters(auditFilters, auditParams, 'al', fecha_desde, fecha_hasta);

    if (usuario_id) {
      auditParams.push(usuario_id);
      auditFilters.push(`al.usuario_id = $${auditParams.length}`);
    }
    if (accion) {
      auditParams.push(`%${accion.toUpperCase()}%`);
      auditFilters.push(`al.accion ILIKE $${auditParams.length}`);
    }
    if (tabla) {
      auditParams.push(tabla);
      auditFilters.push(`al.tabla = $${auditParams.length}`);
    }
    if (buscar.trim()) {
      auditParams.push(`%${buscar.trim()}%`);
      auditFilters.push(`(al.accion ILIKE $${auditParams.length} OR al.tabla ILIKE $${auditParams.length} OR al.datos_nuevos::text ILIKE $${auditParams.length} OR al.datos_anteriores::text ILIKE $${auditParams.length})`);
    }

    const auditWhere = auditFilters.length ? `WHERE ${auditFilters.join(' AND ')}` : '';

    const systemFilters = [];
    const systemParams = [];
    addDateFilters(systemFilters, systemParams, 'sl', fecha_desde, fecha_hasta);

    if (usuario_id) {
      systemParams.push(usuario_id);
      systemFilters.push(`sl.usuario_id = $${systemParams.length}`);
    }
    if (nivel) {
      systemParams.push(nivel);
      systemFilters.push(`sl.nivel = $${systemParams.length}`);
    }
    if (origen) {
      systemParams.push(`%${origen}%`);
      systemFilters.push(`sl.origen ILIKE $${systemParams.length}`);
    }
    if (buscar.trim()) {
      systemParams.push(`%${buscar.trim()}%`);
      systemFilters.push(`(sl.mensaje ILIKE $${systemParams.length} OR sl.origen ILIKE $${systemParams.length} OR sl.metadata::text ILIKE $${systemParams.length})`);
    }

    const systemWhere = systemFilters.length ? `WHERE ${systemFilters.join(' AND ')}` : '';
    const cpuStart = cpuSnapshot();
    const processCpuStart = process.cpuUsage();
    const processTimeStart = process.hrtime.bigint();

    const [
      auditLogs,
      systemLogs,
      usuarios,
      tablas,
      acciones,
      resumenAudit,
      resumenSystem,
      sesiones,
      dbInfo,
      dbStats
    ] = await Promise.all([
      tipo === 'sistema'
        ? Promise.resolve({ rows: [] })
        : pool.query(`
            SELECT al.*, u.nombre || ' ' || u.apellido as usuario_nombre, u.email as usuario_email
            FROM audit_log al
            LEFT JOIN usuarios u ON u.id = al.usuario_id
            ${auditWhere}
            ORDER BY al.created_at DESC
            LIMIT ${rowLimit}
          `, auditParams),
      tipo === 'usuarios'
        ? Promise.resolve({ rows: [] })
        : pool.query(`
            SELECT sl.*, u.nombre || ' ' || u.apellido as usuario_nombre, u.email as usuario_email
            FROM system_logs sl
            LEFT JOIN usuarios u ON u.id = sl.usuario_id
            ${systemWhere}
            ORDER BY sl.created_at DESC
            LIMIT ${rowLimit}
          `, systemParams),
      pool.query('SELECT id, nombre, apellido, email, rol FROM usuarios ORDER BY apellido, nombre'),
      pool.query('SELECT DISTINCT tabla FROM audit_log WHERE tabla IS NOT NULL ORDER BY tabla'),
      pool.query('SELECT DISTINCT accion FROM audit_log ORDER BY accion'),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as audit_24h,
          COUNT(*) FILTER (WHERE accion ILIKE 'LOGIN_FALLIDO%' AND created_at >= NOW() - INTERVAL '24 hours') as login_fallidos_24h,
          COUNT(*) FILTER (WHERE accion ILIKE '%PASSWORD%' AND created_at >= NOW() - INTERVAL '7 days') as passwords_7d
        FROM audit_log
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as system_24h,
          COUNT(*) FILTER (WHERE nivel IN ('error', 'critical') AND created_at >= NOW() - INTERVAL '24 hours') as errores_24h,
          COUNT(*) FILTER (WHERE nivel = 'warning' AND created_at >= NOW() - INTERVAL '24 hours') as warnings_24h
        FROM system_logs
      `),
      pool.query('SELECT COUNT(*) as total FROM session WHERE expire > NOW()'),
      pool.query('SELECT current_database() as database, version() as version'),
      pool.query(`
        SELECT
          COUNT(*) as conexiones_total,
          COUNT(*) FILTER (WHERE state = 'active') as conexiones_activas,
          COUNT(*) FILTER (WHERE state = 'idle') as conexiones_idle,
          pg_database_size(current_database()) as db_size_bytes
        FROM pg_stat_activity
        WHERE datname = current_database()
      `)
    ]);

    const cpuSistemaPorcentaje = cpuPercentBetween(cpuStart, cpuSnapshot());
    const processCpuDelta = process.cpuUsage(processCpuStart);
    const processElapsedSeconds = Number(process.hrtime.bigint() - processTimeStart) / 1e9;
    const cpuProcessPercent = percent(
      (processCpuDelta.user + processCpuDelta.system) / 1000000,
      Math.max(processElapsedSeconds, 0.001) * Math.max(os.cpus().length, 1)
    );
    const memoria = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const diagnostico = {
      entorno: process.env.NODE_ENV || 'development',
      node: process.version,
      pid: process.pid,
      plataforma: `${os.platform()} ${os.release()}`,
      host: os.hostname(),
      uptimeProceso: process.uptime(),
      uptimeSistema: os.uptime(),
      memoriaRssMb: memoria.rss / 1024 / 1024,
      memoriaHeapMb: memoria.heapUsed / 1024 / 1024,
      memoriaHeapTotalMb: toMb(memoria.heapTotal),
      memoriaExternalMb: toMb(memoria.external),
      memoriaSistemaTotalMb: toMb(totalMem),
      memoriaSistemaLibreMb: toMb(freeMem),
      memoriaSistemaUsadaMb: toMb(usedMem),
      memoriaSistemaPorcentaje: percent(usedMem, totalMem),
      cpuProcesoPorcentaje: cpuProcessPercent,
      cpuSistemaPorcentaje,
      cpuCount: os.cpus().length,
      db: dbInfo.rows[0],
      dbStats: dbStats.rows[0] || {},
      sesionesActivas: Number(sesiones.rows[0]?.total || 0)
    };

    res.render('admin/logs', {
      title: 'Logs',
      auditLogs: auditLogs.rows,
      systemLogs: systemLogs.rows,
      usuarios: usuarios.rows,
      tablas: tablas.rows.map(r => r.tabla),
      acciones: acciones.rows.map(r => r.accion),
      resumenAudit: resumenAudit.rows[0] || {},
      resumenSystem: resumenSystem.rows[0] || {},
      diagnostico,
      filtros: { tipo, usuario_id, accion, tabla, nivel, origen, buscar, fecha_desde, fecha_hasta, limit: rowLimit }
    });
  } catch (err) {
    console.error('Error cargando logs:', err);
    req.flash('error', 'Error al cargar logs del sistema.');
    res.redirect('/dashboard');
  }
};
