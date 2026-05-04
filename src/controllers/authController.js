const bcrypt = require('bcryptjs');
const pool = require('../../config/database');
const { sendPasswordResetEmail } = require('../utils/email');
const { auditLog } = require('../middleware/auth');
const { createPasswordResetToken, hashPasswordResetToken } = require('../utils/passwordTokens');

const MAX_INTENTOS = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOCKOUT_MIN = parseInt(process.env.LOCKOUT_DURATION_MINUTES) || 30;
const TOKEN_HOURS = parseInt(process.env.PASSWORD_TOKEN_HOURS) || 24;
const SESSION_ABANDONED_MIN = parseInt(process.env.SESSION_ABANDONED_MINUTES, 10) || 15;

function tokenExpiry() {
  return new Date(Date.now() + TOKEN_HOURS * 60 * 60 * 1000);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => (err ? reject(err) : resolve()));
  });
}

function destroySession(req) {
  return new Promise(resolve => {
    req.session.destroy(() => resolve());
  });
}

exports.createPasswordToken = async function createPasswordToken(userId) {
  const token = createPasswordResetToken();
  await pool.query(
    'UPDATE usuarios SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
    [hashPasswordResetToken(token), tokenExpiry(), userId]
  );
  return token;
};

exports.getLogin = (req, res) => {
  if (req.session.userId && req.session.authenticated) return res.redirect('/dashboard');
  const errors = req.flash('error');
  const success = req.flash('success');
  if (req.query.session === 'invalid') {
    errors.push('Su sesion ya no es valida porque existe otra sesion activa.');
  }
  if (req.query.timeout === '1') {
    errors.push('Su sesion fue cerrada por inactividad.');
  }
  res.render('auth/login', {
    title: 'Iniciar Sesion',
    layout: 'layouts/auth',
    errors,
    success
  });
};

exports.postLogin = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    req.flash('error', 'Complete todos los campos.');
    return res.redirect('/auth/login');
  }

  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [normalizeEmail(email)]);
    const user = result.rows[0];

    if (!user || !user.activo) {
      req.flash('error', 'Credenciales incorrectas.');
      await auditLog(req, 'LOGIN_FALLIDO', 'usuarios', user?.id || null, null, { email });
      return res.redirect('/auth/login');
    }

    if (user.bloqueado && user.bloqueado_hasta && new Date() < new Date(user.bloqueado_hasta)) {
      const min = Math.ceil((new Date(user.bloqueado_hasta) - new Date()) / 60000);
      req.flash('error', `Cuenta bloqueada. Intente en ${min} minutos.`);
      return res.redirect('/auth/login');
    }

    const passwordOk = user.password_hash && await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      const nuevosIntentos = (user.intentos_fallidos || 0) + 1;
      const bloquear = nuevosIntentos >= MAX_INTENTOS;
      await pool.query(
        'UPDATE usuarios SET intentos_fallidos = $1, bloqueado = $2, bloqueado_hasta = $3 WHERE id = $4',
        [nuevosIntentos, bloquear, bloquear ? new Date(Date.now() + LOCKOUT_MIN * 60000) : null, user.id]
      );
      req.flash('error', bloquear
        ? `Cuenta bloqueada por ${LOCKOUT_MIN} minutos por multiples intentos fallidos.`
        : `Credenciales incorrectas. ${MAX_INTENTOS - nuevosIntentos} intento(s) restante(s).`
      );
      await auditLog(req, 'LOGIN_FALLIDO', 'usuarios', user.id, null, { email });
      return res.redirect('/auth/login');
    }

    const sesionActivaReciente = user.active_session_id
      && user.active_session_last_seen_at
      && new Date(user.active_session_last_seen_at).getTime() > Date.now() - (SESSION_ABANDONED_MIN * 60000);

    if (sesionActivaReciente && user.active_session_id !== req.sessionID) {
      req.flash('error', `Tu usuario ya tiene una sesion iniciada. Vuelva a intentar mas tarde o cierre la sesion anterior.`);
      await auditLog(req, 'LOGIN_BLOQUEADO_SESION_ACTIVA', 'usuarios', user.id, null, {
        email: user.email,
        active_session_last_seen_at: user.active_session_last_seen_at
      });
      return res.redirect('/auth/login');
    }

    await regenerateSession(req);

    await pool.query(
      `UPDATE usuarios
       SET intentos_fallidos = 0,
           bloqueado = false,
           bloqueado_hasta = NULL,
           ultimo_acceso = NOW(),
           active_session_id = $2,
           active_session_started_at = NOW(),
           active_session_last_seen_at = NOW(),
           active_session_ip = $3,
           active_session_user_agent = $4
       WHERE id = $1`,
      [user.id, req.sessionID, req.ip, req.get('user-agent')]
    );

    req.session.userId = user.id;
    req.session.userRol = user.rol;
    req.session.userName = `${user.nombre} ${user.apellido}`;
    req.session.authenticated = true;

    await auditLog(req, 'LOGIN_EXITOSO', 'usuarios', user.id, null, { email: user.email, rol: user.rol });
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error en login:', err);
    req.flash('error', 'Error interno del servidor.');
    res.redirect('/auth/login');
  }
};

exports.logout = async (req, res) => {
  const userId = req.session.userId;
  const sessionId = req.sessionID;
  if (userId) {
    await auditLog(req, 'LOGOUT', 'usuarios', userId, null, null);
    await pool.query(`
      UPDATE usuarios
      SET active_session_id = NULL,
          active_session_started_at = NULL,
          active_session_last_seen_at = NULL,
          active_session_ip = NULL,
          active_session_user_agent = NULL
      WHERE id = $1 AND active_session_id = $2
    `, [userId, sessionId]);
  }
  const timeout = req.query.timeout === '1';
  await destroySession(req);
  res.redirect(timeout ? '/auth/login?timeout=1' : '/auth/login');
};

exports.getForgotPassword = (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Recuperar Contrasena',
    layout: 'layouts/auth',
    errors: req.flash('error'),
    success: req.flash('success')
  });
};

exports.postForgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND activo = true', [normalizeEmail(email)]);
    req.flash('success', 'Si el correo existe, recibira instrucciones para crear una nueva contrasena.');

    if (result.rows[0]) {
      const user = result.rows[0];
      const token = await exports.createPasswordToken(user.id);
      const resetUrl = `${process.env.APP_URL}/auth/reset-password/${token}`;
      try {
        await sendPasswordResetEmail(user.email, user.nombre, resetUrl);
      } catch (e) {
        console.error('Error enviando reset:', e.message);
        console.log(`Reset URL para ${user.email}: ${resetUrl}`);
      }
    }
    res.redirect('/auth/forgot-password');
  } catch (err) {
    console.error('Error forgot password:', err);
    req.flash('error', 'Error al procesar solicitud.');
    res.redirect('/auth/forgot-password');
  }
};

exports.getResetPassword = async (req, res) => {
  const { token } = req.params;
  const result = await pool.query(
    'SELECT id, nombre, email FROM usuarios WHERE password_reset_token = $1 AND password_reset_expires > NOW() AND activo = true',
    [hashPasswordResetToken(token)]
  );
  if (!result.rows[0]) {
    req.flash('error', 'Enlace invalido o expirado.');
    return res.redirect('/auth/forgot-password');
  }

  res.render('auth/reset-password', {
    title: 'Definir Contrasena',
    layout: 'layouts/auth',
    token,
    email: result.rows[0].email,
    errors: req.flash('error')
  });
};

exports.postResetPassword = async (req, res) => {
  const token = req.params.token || req.body.token;
  const { password, password_confirm } = req.body;

  if (!password || password !== password_confirm) {
    req.flash('error', 'Las contrasenas no coinciden.');
    return res.redirect(`/auth/reset-password/${token}`);
  }
  if (password.length < 8) {
    req.flash('error', 'La contrasena debe tener al menos 8 caracteres.');
    return res.redirect(`/auth/reset-password/${token}`);
  }

  try {
    const result = await pool.query(
      'SELECT id, email FROM usuarios WHERE password_reset_token = $1 AND password_reset_expires > NOW() AND activo = true',
      [hashPasswordResetToken(token)]
    );
    if (!result.rows[0]) {
      req.flash('error', 'Enlace invalido o expirado.');
      return res.redirect('/auth/forgot-password');
    }

    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await pool.query(
      `UPDATE usuarios
       SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL,
           intentos_fallidos = 0, bloqueado = false, bloqueado_hasta = NULL,
           active_session_id = NULL,
           active_session_started_at = NULL,
           active_session_last_seen_at = NULL,
           active_session_ip = NULL,
           active_session_user_agent = NULL
       WHERE id = $2`,
      [hash, result.rows[0].id]
    );

    await auditLog(req, 'PASSWORD_SET', 'usuarios', result.rows[0].id, null, { email: result.rows[0].email });
    req.flash('success', 'Contrasena actualizada exitosamente. Puede iniciar sesion.');
    res.redirect('/auth/login');
  } catch (err) {
    console.error('Error reset password:', err);
    req.flash('error', 'Error al actualizar contrasena.');
    res.redirect(`/auth/reset-password/${token}`);
  }
};
