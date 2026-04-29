const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false }
});

function passwordEmailHtml(nombre, url, titulo, textoBoton, detalle) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8">
    <style>
      body { font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px; }
      .container { max-width: 520px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
      .header { background: linear-gradient(135deg, #1a3a5c, #2d6a9f); color: white; padding: 30px; text-align: center; }
      .header h1 { margin: 0; font-size: 24px; letter-spacing: 2px; }
      .body { padding: 30px; }
      .btn { display: inline-block; background: #2d6a9f; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
      .note { color:#666; font-size:13px; }
      .footer { background: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #888; border-top: 1px solid #eee; }
    </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>SICIS</h1><p>${titulo}</p></div>
        <div class="body">
          <p>Estimado/a <strong>${nombre}</strong>,</p>
          <p>${detalle}</p>
          <div style="text-align:center"><a class="btn" href="${url}">${textoBoton}</a></div>
          <p class="note">O copie este enlace:<br><a href="${url}">${url}</a></p>
          <p class="note">Este enlace expira en 24 horas. Si no solicito esta accion, ignore este correo e informe al administrador.</p>
        </div>
        <div class="footer">SENEPA - Sistema SICIS</div>
      </div>
    </body>
    </html>
  `;
}

async function sendPasswordSetupEmail(email, nombre, setupUrl) {
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: '[SICIS] Cree su contrasena de acceso',
    html: passwordEmailHtml(
      nombre,
      setupUrl,
      'Creacion de contrasena',
      'Crear contrasena',
      'Se creo una cuenta para usted en SICIS. Para verificar su correo y definir su contrasena, ingrese al siguiente enlace.'
    ),
    text: `Cree su contrasena SICIS ingresando a: ${setupUrl}`
  });
}

async function sendPasswordResetEmail(email, nombre, resetUrl) {
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: '[SICIS] Restablecimiento de contrasena',
    html: passwordEmailHtml(
      nombre,
      resetUrl,
      'Restablecimiento de contrasena',
      'Restablecer contrasena',
      'Se solicito restablecer su contrasena de SICIS. Para verificar su correo y definir una nueva contrasena, ingrese al siguiente enlace.'
    ),
    text: `Restablezca su contrasena SICIS ingresando a: ${resetUrl}`
  });
}

module.exports = { sendPasswordSetupEmail, sendPasswordResetEmail };
