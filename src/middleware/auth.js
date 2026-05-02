const pool = require('../../config/database');

const SESSION_ABANDONED_MIN = parseInt(process.env.SESSION_ABANDONED_MINUTES, 10) || 15;

function destroySession(req) {
  return new Promise(resolve => {
    req.session.destroy(() => resolve());
  });
}

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
        `SELECT id, nombre, apellido, email, rol, activo,
                active_session_id, active_session_last_seen_at
         FROM usuarios
         WHERE id = $1`,
        [req.session.userId]
      );
      if (result.rows[0]) {
        const user = result.rows[0];
        const activeSessionExpired = user.active_session_last_seen_at
          && new Date(user.active_session_last_seen_at).getTime() <= Date.now() - (SESSION_ABANDONED_MIN * 60000);

        if (user.active_session_id && user.active_session_id !== req.sessionID && !activeSessionExpired) {
          await destroySession(req);
          return res.redirect('/auth/login?session=invalid');
        }

        if (!user.active_session_id || user.active_session_id === req.sessionID || activeSessionExpired) {
          await pool.query(`
            UPDATE usuarios
            SET active_session_id = $2,
                active_session_started_at = COALESCE(active_session_started_at, NOW()),
                active_session_last_seen_at = NOW(),
                active_session_ip = $3,
                active_session_user_agent = $4
            WHERE id = $1
          `, [user.id, req.sessionID, req.ip, req.get('user-agent')]);
        }

        req.user = user;
        res.locals.user = user;
        res.locals.userRol = user.rol;
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
