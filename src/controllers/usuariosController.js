const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../../config/database');
const { auditLog } = require('../middleware/auth');
const { sendPasswordSetupEmail, sendPasswordResetEmail } = require('../utils/email');

const TOKEN_HOURS = parseInt(process.env.PASSWORD_TOKEN_HOURS) || 24;
const ROLES_VALIDOS = ['admin', 'gerente', 'operador', 'encargado', 'encargado_principal'];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function tokenExpiry() {
  return new Date(Date.now() + TOKEN_HOURS * 60 * 60 * 1000);
}

async function setPasswordToken(userId) {
  const token = uuidv4();
  await pool.query(
    'UPDATE usuarios SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
    [token, tokenExpiry(), userId]
  );
  return token;
}

async function sendPasswordLink(user, kind) {
  const token = await setPasswordToken(user.id);
  const url = `${process.env.APP_URL}/auth/reset-password/${token}`;
  try {
    if (kind === 'setup') {
      await sendPasswordSetupEmail(user.email, user.nombre, url);
    } else {
      await sendPasswordResetEmail(user.email, user.nombre, url);
    }
  } catch (err) {
    console.error('Error enviando enlace de contrasena:', err.message);
    console.log(`Password URL para ${user.email}: ${url}`);
  }
  return url;
}

function normalizeIds(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(v => parseInt(v, 10)).filter(Number.isInteger))];
}

function ensureValidRole(rol) {
  if (!ROLES_VALIDOS.includes(rol)) {
    throw new Error('Seleccione un rol valido.');
  }
}

async function syncUsuarioDepositos(client, userId, rol, depositoIdsRaw, responsableIdsRaw) {
  const depositoIds = normalizeIds(depositoIdsRaw);
  const responsableIds = (rol === 'encargado' || rol === 'encargado_principal') ? normalizeIds(responsableIdsRaw) : [];
  const allIds = [...new Set([...depositoIds, ...responsableIds])];

  const oldResponsables = await client.query(
    'SELECT deposito_id FROM usuario_depositos WHERE usuario_id = $1 AND es_responsable = true',
    [userId]
  );

  await client.query('DELETE FROM usuario_depositos WHERE usuario_id = $1', [userId]);

  for (const depId of allIds) {
    const esResponsable = responsableIds.includes(depId);
    if (esResponsable) {
      await client.query(
        'UPDATE usuario_depositos SET es_responsable = false WHERE deposito_id = $1 AND es_responsable = true',
        [depId]
      );
    }
    await client.query(
      'INSERT INTO usuario_depositos (usuario_id, deposito_id, es_responsable) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [userId, depId, esResponsable]
    );
  }

  const user = await client.query('SELECT nombre, apellido FROM usuarios WHERE id = $1', [userId]);
  const responsableNombre = user.rows[0] ? `${user.rows[0].nombre} ${user.rows[0].apellido}` : null;

  for (const depId of responsableIds) {
    await client.query('UPDATE depositos SET responsable_nombre = $1 WHERE id = $2', [responsableNombre, depId]);
  }

  const oldIds = oldResponsables.rows.map(r => r.deposito_id);
  const removedIds = oldIds.filter(depId => !responsableIds.includes(depId));
  for (const depId of removedIds) {
    const current = await client.query(`
      SELECT u.nombre || ' ' || u.apellido as nombre
      FROM usuario_depositos ud
      JOIN usuarios u ON u.id = ud.usuario_id
      WHERE ud.deposito_id = $1 AND ud.es_responsable = true
      LIMIT 1
    `, [depId]);
    await client.query('UPDATE depositos SET responsable_nombre = $1 WHERE id = $2', [current.rows[0]?.nombre || null, depId]);
  }
}

exports.index = async (req, res) => {
  const { buscar = '', rol = '', estado = '' } = req.query;
  const filters = [];
  const params = [];

  if (buscar.trim()) {
    params.push(`%${buscar.trim().toLowerCase()}%`);
    filters.push(`(LOWER(u.nombre) LIKE $${params.length} OR LOWER(u.apellido) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`);
  }
  if (rol) {
    params.push(rol);
    filters.push(`u.rol = $${params.length}`);
  }
  if (estado === 'activo') filters.push('u.activo = true AND u.bloqueado = false');
  if (estado === 'bloqueado') filters.push('u.bloqueado = true');
  if (estado === 'inactivo') filters.push('u.activo = false');

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  try {
    const usuarios = await pool.query(`
      SELECT u.*,
        COALESCE(
          JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('codigo', d.codigo, 'nombre', d.nombre, 'responsable', ud.es_responsable))
            FILTER (WHERE d.id IS NOT NULL),
          '[]'::jsonb
        ) as depositos
      FROM usuarios u
      LEFT JOIN usuario_depositos ud ON u.id = ud.usuario_id
      LEFT JOIN depositos d ON ud.deposito_id = d.id
      ${where}
      GROUP BY u.id
      ORDER BY u.rol, u.apellido, u.nombre
    `, params);

    res.render('usuarios/index', {
      title: 'Gestion de Usuarios',
      usuarios: usuarios.rows,
      buscar,
      rol,
      estado
    });
  } catch (err) {
    console.error('Error cargando usuarios:', err);
    req.flash('error', 'Error al cargar usuarios.');
    res.redirect('/dashboard');
  }
};

exports.new = async (req, res) => {
  const deps = await pool.query('SELECT id, codigo, nombre, tipo, nivel FROM depositos WHERE activo = true ORDER BY nivel, nombre');
  res.render('usuarios/form', {
    title: 'Nuevo Usuario',
    usuario: {},
    depositos: deps.rows,
    userDepIds: [],
    userResponsibleDepIds: [],
    errors: req.flash('error')
  });
};

exports.create = async (req, res) => {
  const { nombre, apellido, email, rol, deposito_ids, responsable_deposito_ids } = req.body;
  const client = await pool.connect();
  try {
    ensureValidRole(rol);
    await client.query('BEGIN');
    const unusableHash = await bcrypt.hash(uuidv4(), parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const result = await client.query(
      'INSERT INTO usuarios (nombre, apellido, email, password_hash, rol) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [nombre, apellido, normalizeEmail(email), unusableHash, rol]
    );

    const user = result.rows[0];
    await syncUsuarioDepositos(client, user.id, rol, deposito_ids, responsable_deposito_ids);

    await client.query('COMMIT');
    await sendPasswordLink(user, 'setup');
    await auditLog(req, 'CREAR_USUARIO', 'usuarios', user.id, null, { email: user.email, rol });
    req.flash('success', 'Usuario creado. Se envio un enlace al correo para verificarlo y crear su contrasena.');
    res.redirect('/usuarios');
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.detail || err.message || 'Error al crear usuario.');
    res.redirect('/usuarios/nuevo');
  } finally {
    client.release();
  }
};

exports.edit = async (req, res) => {
  const { id } = req.params;
  const user = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
  const deps = await pool.query('SELECT id, codigo, nombre, tipo, nivel FROM depositos WHERE activo = true ORDER BY nivel, nombre');
  const userDeps = await pool.query('SELECT deposito_id, es_responsable FROM usuario_depositos WHERE usuario_id = $1', [id]);

  res.render('usuarios/form', {
    title: 'Editar Usuario',
    usuario: user.rows[0] || {},
    depositos: deps.rows,
    userDepIds: userDeps.rows.map(r => r.deposito_id),
    userResponsibleDepIds: userDeps.rows.filter(r => r.es_responsable).map(r => r.deposito_id),
    errors: req.flash('error')
  });
};

exports.update = async (req, res) => {
  const { id } = req.params;
  const { nombre, apellido, email, rol, activo, deposito_ids, responsable_deposito_ids } = req.body;
  const client = await pool.connect();
  try {
    ensureValidRole(rol);
    await client.query('BEGIN');
    await client.query(
      'UPDATE usuarios SET nombre=$1, apellido=$2, email=$3, rol=$4, activo=$5 WHERE id=$6',
      [nombre, apellido, normalizeEmail(email), rol, activo === 'on', id]
    );

    await syncUsuarioDepositos(client, id, rol, deposito_ids, responsable_deposito_ids);

    await client.query('COMMIT');
    await auditLog(req, 'EDITAR_USUARIO', 'usuarios', id, null, req.body);
    req.flash('success', 'Usuario actualizado.');
    res.redirect('/usuarios');
  } catch (err) {
    await client.query('ROLLBACK');
    req.flash('error', err.message);
    res.redirect(`/usuarios/${id}/editar`);
  } finally {
    client.release();
  }
};

exports.resetPassword = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT id, nombre, email FROM usuarios WHERE id = $1 AND activo = true', [id]);
    if (!result.rows[0]) {
      req.flash('error', 'Usuario no encontrado o inactivo.');
      return res.redirect(`/usuarios/${id}/editar`);
    }
    await sendPasswordLink(result.rows[0], 'reset');
    await auditLog(req, 'SOLICITAR_RESET_PASSWORD', 'usuarios', id, null, { email: result.rows[0].email });
    req.flash('success', 'Se envio un enlace al correo del usuario para restablecer su contrasena.');
    res.redirect(`/usuarios/${id}/editar`);
  } catch (err) {
    console.error('Error reset admin:', err);
    req.flash('error', 'No se pudo enviar el enlace de restablecimiento.');
    res.redirect(`/usuarios/${id}/editar`);
  }
};

exports.toggleBloqueo = async (req, res) => {
  const { id } = req.params;
  const user = await pool.query('SELECT bloqueado FROM usuarios WHERE id=$1', [id]);
  if (!user.rows[0]) {
    req.flash('error', 'Usuario no encontrado.');
    return res.redirect('/usuarios');
  }
  const nuevo = !user.rows[0].bloqueado;
  await pool.query('UPDATE usuarios SET bloqueado=$1, intentos_fallidos=0, bloqueado_hasta=NULL WHERE id=$2', [nuevo, id]);
  await auditLog(req, nuevo ? 'BLOQUEAR_USUARIO' : 'DESBLOQUEAR_USUARIO', 'usuarios', id, null, null);
  req.flash('success', `Usuario ${nuevo ? 'bloqueado' : 'desbloqueado'} exitosamente.`);
  res.redirect('/usuarios');
};

exports.delete = async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.session.userId) {
    req.flash('error', 'No puede eliminar su propia cuenta.');
    return res.redirect('/usuarios');
  }
  await pool.query('UPDATE usuarios SET activo = false WHERE id = $1', [id]);
  await auditLog(req, 'DESACTIVAR_USUARIO', 'usuarios', id, null, null);
  req.flash('success', 'Usuario desactivado.');
  res.redirect('/usuarios');
};

exports.getPerfil = async (req, res) => {
  const result = await pool.query('SELECT id, nombre, apellido, email, rol FROM usuarios WHERE id = $1', [req.session.userId]);
  res.render('usuarios/perfil', {
    title: 'Mi Perfil',
    perfil: result.rows[0],
    errors: req.flash('error')
  });
};

exports.updatePerfil = async (req, res) => {
  const { nombre, apellido } = req.body;
  try {
    await pool.query('UPDATE usuarios SET nombre=$1, apellido=$2 WHERE id=$3', [nombre, apellido, req.session.userId]);
    req.session.userName = `${nombre} ${apellido}`;
    await auditLog(req, 'EDITAR_PERFIL', 'usuarios', req.session.userId, null, { nombre, apellido });
    req.flash('success', 'Perfil actualizado.');
    res.redirect('/perfil');
  } catch (err) {
    req.flash('error', 'Error al actualizar perfil.');
    res.redirect('/perfil');
  }
};

exports.updatePerfilPassword = async (req, res) => {
  const { password_actual, password, password_confirm } = req.body;
  try {
    const result = await pool.query('SELECT password_hash FROM usuarios WHERE id=$1', [req.session.userId]);
    const ok = await bcrypt.compare(password_actual || '', result.rows[0]?.password_hash || '');
    if (!ok) {
      req.flash('error', 'La contrasena actual no es correcta.');
      return res.redirect('/perfil');
    }
    if (!password || password.length < 8 || password !== password_confirm) {
      req.flash('error', 'La nueva contrasena debe tener al menos 8 caracteres y coincidir en ambos campos.');
      return res.redirect('/perfil');
    }

    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await pool.query('UPDATE usuarios SET password_hash=$1 WHERE id=$2', [hash, req.session.userId]);
    await auditLog(req, 'CAMBIAR_PASSWORD_PERFIL', 'usuarios', req.session.userId, null, null);
    req.flash('success', 'Contrasena actualizada.');
    res.redirect('/perfil');
  } catch (err) {
    req.flash('error', 'Error al cambiar contrasena.');
    res.redirect('/perfil');
  }
};
