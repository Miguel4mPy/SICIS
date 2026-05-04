const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  const token = ensureCsrfToken(req);
  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) return next();

  const submittedToken = req.body?._csrf || req.get('x-csrf-token');
  if (!submittedToken || submittedToken !== token) {
    req.flash?.('error', 'Solicitud no valida. Recargue la pagina e intente nuevamente.');
    return res.status(403).redirect(req.get('referer') || '/dashboard');
  }

  next();
}

module.exports = csrfProtection;
