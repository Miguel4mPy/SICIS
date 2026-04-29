# SICIS — Sistema Informático de Control de Insecticida del SENEPA

Sistema web de gestión y control de stock de insecticidas para los depósitos del SENEPA.

---

## Requisitos previos

| Herramienta | Versión mínima |
|-------------|---------------|
| Node.js     | 18.x o superior |
| npm         | 9.x o superior  |
| PostgreSQL   | 14 o superior  |

---

## Instalación rápida

### 1. Clonar / descomprimir el proyecto

```bash
cd /ruta/donde/instalar
# Si es zip: unzip sicis.zip
cd sicis
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con los datos reales:

```dotenv
# Aplicación
NODE_ENV=production
PORT=3000
APP_URL=http://localhost:3000

# Base de datos PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sicis_db
DB_USER=sicis_user
DB_PASSWORD=TuContraseñaSegura

# Sesión (generar string aleatorio largo)
SESSION_SECRET=cambiar_por_string_aleatorio_largo_minimo_64_chars

# SMTP — correo para OTP y notificaciones
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@senepa.gov.py
SMTP_PASS=contraseña_smtp
EMAIL_FROM="SICIS SENEPA <noreply@senepa.gov.py>"

# Seguridad
BCRYPT_ROUNDS=12
OTP_VALIDITY_MINUTES=10
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=30
```

### 4. Crear la base de datos PostgreSQL

```bash
# Conectar como superusuario de PostgreSQL
psql -U postgres

# Dentro de psql:
CREATE USER sicis_user WITH PASSWORD 'TuContraseñaSegura';
CREATE DATABASE sicis_db OWNER sicis_user;
GRANT ALL PRIVILEGES ON DATABASE sicis_db TO sicis_user;
\q
```

### 5. Ejecutar migraciones (crear tablas)

```bash
npm run migrate
```

### 6. Cargar datos iniciales (semilla)

```bash
npm run seed
```

Esto crea:
- Estructura de depósitos (1 Oficina Central + 19 Zonas + 5 Sectores de ejemplo)
- 8 insecticidas de muestra con lotes
- 3 usuarios por defecto:

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| admin@senepa.gov.py | Admin@SICIS2025! | Admin |
| gerente@senepa.gov.py | Gerente@SICIS2025! | Gerente |
| operador@senepa.gov.py | Operador@SICIS2025! | Operador |

> ⚠️ **Cambiar las contraseñas inmediatamente en producción.**

### 7. Iniciar el servidor

```bash
# Desarrollo (con reinicio automático)
npm run dev

# Producción
npm start
```

Acceder en: **http://localhost:3000**

---

## Scripts disponibles

```bash
npm start          # Inicia el servidor (producción)
npm run dev        # Inicia con nodemon (desarrollo)
npm run migrate    # Ejecuta las migraciones de base de datos
npm run seed       # Carga datos de prueba iniciales
```

---

## Estructura del proyecto

```
sicis/
├── config/
│   └── database.js          # Pool de conexión PostgreSQL
├── migrations/
│   ├── schema.sql            # DDL completo de la base de datos
│   └── run.js               # Script de migración
├── seeds/
│   └── run.js               # Datos iniciales
├── public/
│   ├── css/sicis.css        # Estilos principales
│   ├── js/sicis.js          # JavaScript del cliente
│   └── images/              # Logos para membrete (ver abajo)
└── src/
    ├── app.js               # Punto de entrada Express
    ├── routes/
    │   ├── auth.js          # Rutas de autenticación
    │   └── index.js         # Rutas principales
    ├── controllers/
    │   ├── authController.js
    │   ├── depositosController.js
    │   ├── insecticidasController.js
    │   ├── movimientosController.js
    │   ├── reportesController.js
    │   └── usuariosController.js
    ├── middleware/
    │   └── auth.js          # requireAuth, requireRole, auditLog
    ├── utils/
    │   ├── email.js         # Envío de emails (nodemailer)
    │   └── helpers.js       # semanaEpidemiologica(), etc.
    └── views/               # Plantillas EJS
        ├── layouts/
        ├── auth/
        ├── dashboard.ejs
        ├── depositos/
        ├── insecticidas/
        ├── lotes/
        ├── movimientos/
        ├── reportes/
        ├── usuarios/
        └── errors/
```

---

## Logos para el membrete de reportes

Colocar en `public/images/`:
- `logo-senepa.png` — Logo del SENEPA (recomendado: fondo transparente, ~200px altura)
- `logo-mspbs.png`  — Logo del MSPBS (recomendado: fondo transparente, ~200px altura)

Si no se colocan las imágenes, el membrete de los reportes las omite automáticamente.

---

## Roles y permisos

### Admin
- Gestión completa de usuarios (crear, editar, eliminar, resetear contraseña, bloquear/desbloquear)
- Acceso a todos los módulos
- Puede anular movimientos

### Gerente
- Acceso de solo lectura a todos los depósitos
- Generación de reportes globales: movimientos, stock, gráficos
- Filtros por semana epidemiológica y rangos de fechas
- No puede crear/editar usuarios ni depósitos

### Operador
- Registro de movimientos en los depósitos asignados y sus dependientes
- Reportes limitados a su ámbito de responsabilidad
- No puede gestionar usuarios

---

## Módulos del sistema

### Depósitos
- Jerarquía de 3 niveles: Oficina Central → Zona (19) → Sector
- Vista árbol interactiva
- Stock y movimientos por depósito

### Insecticidas y Lotes
- Catálogo de insecticidas con tipos de uso: Focal, Espacial, Residual, Larvicida
- Lotes con código, fecha de fabricación, vencimiento y cantidad inicial
- Alertas de vencimiento con colores

### Movimientos
- Tipos: Entrada, Salida, Transferencia, Ajuste
- Categorías operativas: Interno, Espacial, Focal, Residual, Larvicida
- Validación de stock antes de salidas/transferencias
- Cálculo automático de semana epidemiológica
- Anulación con reversión de stock (Admin/Gerente)
- Número de movimiento auto-generado: `MOV-YYYYMMDD-NNNNN`

### Reportes
- **Movimientos**: filtros por fecha, semana epi, depósito, insecticida, lote, tipo
- **Stock**: saldos por depósito, alertas de vencimiento
- **Gráficos**: distribución por tipo, stock por insecticida, tendencia por semana epi
- Todos los reportes tienen formato de impresión con membrete y espacio para firmas

### Seguridad
- Contraseñas con bcrypt (12 rounds)
- 2FA por email (OTP de 6 dígitos, válido 10 min)
- Bloqueo de cuenta tras N intentos fallidos
- Protección contra CSRF con csurf
- Cabeceras de seguridad con Helmet
- Sesiones seguras con connect-pg-simple
- Rate limiting en endpoints de auth
- Registro de auditoría completo

---

## Producción con PM2

```bash
npm install -g pm2

# Iniciar
pm2 start src/app.js --name sicis

# Auto-inicio al reiniciar el servidor
pm2 startup
pm2 save
```

## Nginx (proxy inverso)

```nginx
server {
    listen 80;
    server_name sicis.senepa.gov.py;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Soporte

Sistema desarrollado para el SENEPA — Ministerio de Salud Pública y Bienestar Social del Paraguay.

Para reportar errores o solicitar mejoras, contactar al equipo de TI del SENEPA.
