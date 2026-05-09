require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const flash = require('./middleware/flash');
const methodOverride = require('method-override');
const path = require('path');
const pool = require('../config/database');
const { loadUser } = require('./middleware/auth');
const csrfProtection = require('./middleware/csrf');
const { formatearFecha, formatearNumero, formatearCantidad, tipoMovimientoLabel, tipoDepositoLabel, estadoVencimiento } = require('./utils/helpers');
const { logSystemEvent } = require('./utils/systemLogger');
const moment = require('moment');

function parsePort(value) {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT invalido: ${value}. Usa un numero entre 1 y 65535.`);
  }

  return port;
}

function parseAppUrl(value, fallbackPort) {
  const fallbackUrl = `http://localhost:${fallbackPort}`;

  if (!value) return new URL(fallbackUrl);

  try {
    return new URL(value);
  } catch (_) {
    console.warn(`APP_URL invalido (${value}). Se usara ${fallbackUrl}.`);
    return new URL(fallbackUrl);
  }
}

const app = express();
const PORT = parsePort(process.env.PORT || '3000');
const HOST = (process.env.HOST || '0.0.0.0').trim();
const SESSION_IDLE_MINUTES = parseInt(process.env.SESSION_IDLE_MINUTES, 10) || 15;
const GLOBAL_RATE_WINDOW_MINUTES = parseInt(process.env.GLOBAL_RATE_WINDOW_MINUTES, 10) || 1;
const GLOBAL_RATE_LIMIT_MAX = parseInt(process.env.GLOBAL_RATE_LIMIT_MAX, 10) || 300;
const appUrl = parseAppUrl(process.env.APP_URL, PORT);

const isLocalAppUrl = ['localhost', '127.0.0.1', '::1'].includes(appUrl.hostname);
const useSecureCookies = process.env.SESSION_COOKIE_SECURE
  ? process.env.SESSION_COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production' && appUrl.protocol === 'https:' && !isLocalAppUrl;

if (useSecureCookies) {
  app.set('trust proxy', 1);
}

const sessionStore = process.env.SESSION_STORE === 'memory'
  ? undefined
  : new pgSession({
      pool,
      tableName: process.env.SESSION_TABLE || 'session',
      createTableIfMissing: false
    });

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],

      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.jsdelivr.net",
        "https://fonts.googleapis.com"
      ],

      styleSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.jsdelivr.net",
        "https://fonts.googleapis.com"
      ],

      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.jsdelivr.net"
      ],

      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.jsdelivr.net"
      ],

      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net"
      ],

      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
    }
  }
}));

// Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('view cache');

// Static
app.use(express.static(path.join(__dirname, '../public')));
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/images/favicon.ico'));
});

app.use(rateLimit({
  windowMs: GLOBAL_RATE_WINDOW_MINUTES * 60 * 1000,
  limit: GLOBAL_RATE_LIMIT_MAX,
  message: 'Demasiadas solicitudes desde esta IP. Intente nuevamente en unos minutos.',
  standardHeaders: true,
  legacyHeaders: false
}));

// Body parsing
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));

// Session
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'sicis-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: useSecureCookies,
    httpOnly: true,
    maxAge: SESSION_IDLE_MINUTES * 60 * 1000,
    sameSite: 'strict'
  }
}));

app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.userRol = null;
  res.locals.currentPath = req.path;
  next();
});

// Flash
app.use(flash());
app.use(csrfProtection);

// Load user
app.use(loadUser);

// Global locals
app.use((req, res, next) => {
  res.locals.appName = 'SICIS';
  res.locals.appFullName = 'Sistema Informático de Control de Insecticida del SENEPA';
  res.locals.currentPath = req.path;
  res.locals.moment = moment;
  res.locals.formatearFecha = formatearFecha;
  res.locals.formatearNumero = formatearNumero;
  res.locals.formatearCantidad = formatearCantidad;
  res.locals.tipoMovimientoLabel = tipoMovimientoLabel;
  res.locals.tipoDepositoLabel = tipoDepositoLabel;
  res.locals.estadoVencimiento = estadoVencimiento;
  res.locals.sessionIdleMs = SESSION_IDLE_MINUTES * 60 * 1000;
  res.locals.safeJson = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029'
  }[char]));
  next();
});

// EJS layout helper
app.use((req, res, next) => {
  const originalRender = res.render.bind(res);
  res.render = function(view, options = {}, callback) {
    const layout = options.layout !== undefined ? options.layout : 'layouts/main';
    if (!layout) return originalRender(view, options, callback);

    originalRender(view, options, (err, html) => {
      if (err) return callback ? callback(err) : next(err);
      options.body = html;
      if (options.flash === undefined) {
        options.flash = { success: req.flash('success'), error: req.flash('error') };
      }
      originalRender(layout, options, callback);
    });
  };
  next();
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/index'));

// 404
app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Página no encontrada', layout: 'layouts/main' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  logSystemEvent('error', 'express', err.message || 'Error interno del servidor', {
    stack: err.stack,
    path: req.originalUrl,
    method: req.method
  }, req);
  res.status(500).render('errors/500', { title: 'Error interno', layout: 'layouts/main', error: process.env.NODE_ENV !== 'production' ? err.message : null });
});

process.on('unhandledRejection', (reason) => {
  console.error('ERROR: Promesa rechazada no controlada.');
  console.error(reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('ERROR: Excepcion no controlada.');
  console.error(err);
  process.exit(1);
});

const server = app.listen(PORT, HOST, () => {
  const localUrl = `http://localhost:${PORT}`;
  const bindUrl = `http://${HOST}:${PORT}`;

  console.log(`\n🦟 SICIS - Sistema Informático de Control de Insecticida del SENEPA`);
  console.log(`🚀 Servidor escuchando en ${bindUrl}`);
  console.log(`💻 Acceso local: ${localUrl}`);
  console.log(`📡 URL publica configurada por APP_URL: ${appUrl.href}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);

  if (HOST === '0.0.0.0') {
    console.log('📶 HOST=0.0.0.0 acepta conexiones por localhost y por la IP LAN del servidor.');
  }

  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nERROR: El puerto ${PORT} ya esta en uso.`);
    console.error('Cierra la otra instancia de SICIS, detiene nodemon duplicado o cambia PORT en el archivo .env.\n');
    process.exit(1);
  }

  console.error(err);
  process.exit(1);
});

module.exports = app;
