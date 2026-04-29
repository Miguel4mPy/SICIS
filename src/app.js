require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const pool = require('../config/database');
const { loadUser } = require('./middleware/auth');
const { formatearFecha, formatearCantidad, tipoMovimientoLabel, tipoDepositoLabel, estadoVencimiento } = require('./utils/helpers');
const moment = require('moment');

const app = express();
const PORT = process.env.PORT || 3000;

let appUrl;
try {
  appUrl = new URL(process.env.APP_URL || `http://localhost:${PORT}`);
} catch (_) {
  appUrl = new URL(`http://localhost:${PORT}`);
}

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

// Static
app.use(express.static(path.join(__dirname, '../public')));
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/images/favicon.ico'));
});

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
    maxAge: 8 * 60 * 60 * 1000, // 8 horas
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

// Load user
app.use(loadUser);

// Global locals
app.use((req, res, next) => {
  res.locals.appName = 'SICIS';
  res.locals.appFullName = 'Sistema Informático de Control de Insecticida del SENEPA';
  res.locals.currentPath = req.path;
  res.locals.moment = moment;
  res.locals.formatearFecha = formatearFecha;
  res.locals.formatearCantidad = formatearCantidad;
  res.locals.tipoMovimientoLabel = tipoMovimientoLabel;
  res.locals.tipoDepositoLabel = tipoDepositoLabel;
  res.locals.estadoVencimiento = estadoVencimiento;
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
  res.status(500).render('errors/500', { title: 'Error interno', layout: 'layouts/main', error: process.env.NODE_ENV !== 'production' ? err.message : null });
});

app.listen(PORT, () => {
  console.log(`\n🦟 SICIS - Sistema Informático de Control de Insecticida del SENEPA`);
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
