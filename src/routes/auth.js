const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');

const AUTH_RATE_WINDOW_MINUTES = parseInt(process.env.AUTH_RATE_WINDOW_MINUTES, 10) || 15;
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 10;
const PASSWORD_RESET_RATE_LIMIT_MAX = parseInt(process.env.PASSWORD_RESET_RATE_LIMIT_MAX, 10) || 5;

const loginLimiter = rateLimit({
  windowMs: AUTH_RATE_WINDOW_MINUTES * 60 * 1000,
  limit: LOGIN_RATE_LIMIT_MAX,
  message: 'Demasiados intentos de inicio de sesion desde esta IP. Intente nuevamente mas tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: PASSWORD_RESET_RATE_LIMIT_MAX,
  message: 'Demasiadas solicitudes de recuperacion desde esta IP. Intente nuevamente mas tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/login', authController.getLogin);
router.post('/login', loginLimiter, authController.postLogin);
router.get('/logout', authController.logout);
router.get('/forgot-password', authController.getForgotPassword);
router.post('/forgot-password', passwordResetLimiter, authController.postForgotPassword);
router.get('/reset-password/:token', authController.getResetPassword);
router.post('/reset-password/:token', passwordResetLimiter, authController.postResetPassword);

module.exports = router;
