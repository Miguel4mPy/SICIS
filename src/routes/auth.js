const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Demasiados intentos. Intente en 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/login', authController.getLogin);
router.post('/login', loginLimiter, authController.postLogin);
router.get('/logout', authController.logout);
router.get('/forgot-password', authController.getForgotPassword);
router.post('/forgot-password', authController.postForgotPassword);
router.get('/reset-password/:token', authController.getResetPassword);
router.post('/reset-password/:token', authController.postResetPassword);

module.exports = router;
