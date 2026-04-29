const pool = require('../../config/database');

function requireAuth(req, res, next) {
  if (!req.session.userId || !req.session.authenticated) {
    req.flash('error', 'Debe iniciar sesión para acceder al sistema.');
    return res.redirect('/auth/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.userId || !req.session.authenticated) {
      req.flash('error', 'Debe iniciar sesión.');
      return res.redirect('/auth/login');
    }
    if (!roles.includes(req.session.userRol)) {
      req.flash('error', 'No tiene permisos para acceder a esta sección.');
      return res.redirect('/dashboard');
    }
    next();
  };
}

async function loadUser(req, res, next) {
  if (req.session.userId) {
    try {
      const result = await pool.query(
        'SELECT id, nombre, apellido, email, rol, activo FROM usuarios WHERE id = $1',
        [req.session.userId]
      );
      if (result.rows[0]) {
        req.user = result.rows[0];
        res.locals.user = result.rows[0];
        res.locals.userRol = result.rows[0].rol;
      }
    } catch (err) {
      console.error('Error loading user:', err);
    }
  }
  next();
}

async function auditLog(req, accion, tabla, registroId, datosAnt, datosNuevo) {
  try {
    await pool.query(
      `INSERT INTO audit_log (usuario_id, accion, tabla, registro_id, datos_anteriores, datos_nuevos, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.session.userId,
        accion,
        tabla,
        registroId,
        datosAnt ? JSON.stringify(datosAnt) : null,
        datosNuevo ? JSON.stringify(datosNuevo) : null,
        req.ip,
        req.get('user-agent')
      ]
    );
  } catch (err) {
    console.error('Error en audit log:', err.message);
  }
}

module.exports = { requireAuth, requireRole, loadUser, auditLog };
