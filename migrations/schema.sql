-- SICIS Database Schema
-- Sistema Informático de Control de Insecticida del SENEPA

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- DEPOSITOS
-- ============================================================
CREATE TABLE IF NOT EXISTS depositos (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(20) UNIQUE NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('oficina_central', 'zona', 'sector')),
  nivel INTEGER NOT NULL CHECK (nivel IN (1, 2, 3)),
  deposito_padre_id INTEGER REFERENCES depositos(id),
  zona VARCHAR(100),
  departamento VARCHAR(100),
  direccion TEXT,
  responsable_nombre VARCHAR(150),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- USUARIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
  nombre VARCHAR(100) NOT NULL,
  apellido VARCHAR(100) NOT NULL,
  email VARCHAR(200) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(20) NOT NULL CHECK (rol IN ('admin', 'operador', 'gerente', 'encargado', 'encargado_principal')),
  activo BOOLEAN DEFAULT TRUE,
  bloqueado BOOLEAN DEFAULT FALSE,
  intentos_fallidos INTEGER DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  otp_secret VARCHAR(255),
  otp_habilitado BOOLEAN DEFAULT FALSE,
  ultimo_acceso TIMESTAMPTZ,
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('admin', 'operador', 'gerente', 'encargado', 'encargado_principal'));

-- Relación usuario-depósito (un operador puede tener varios depósitos)
CREATE TABLE IF NOT EXISTS usuario_depositos (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  deposito_id INTEGER NOT NULL REFERENCES depositos(id) ON DELETE CASCADE,
  es_responsable BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(usuario_id, deposito_id)
);

-- Sesiones OTP pendientes
CREATE TABLE IF NOT EXISTS otp_tokens (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token VARCHAR(10) NOT NULL,
  usado BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INSECTICIDAS
-- ============================================================
CREATE TABLE IF NOT EXISTS unidades_medida (
  codigo VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  abreviatura VARCHAR(20) NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO unidades_medida (codigo, nombre, abreviatura, orden)
VALUES
  ('litro', 'Litro', 'litro', 1),
  ('kg', 'Kilogramo', 'kg', 2),
  ('ml', 'Mililitro', 'ml', 3),
  ('gr', 'Gramo', 'gr', 4),
  ('unidad', 'Unidad', 'unidad', 5)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS insecticidas (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(30) UNIQUE NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  tipo_uso VARCHAR(30) NOT NULL CHECK (tipo_uso IN ('focal', 'espacial', 'residual', 'larvicida')),
  tipo_usos TEXT[] NOT NULL DEFAULT ARRAY['focal']::TEXT[],
  unidad_medida VARCHAR(20) NOT NULL DEFAULT 'litro',
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE insecticidas DROP CONSTRAINT IF EXISTS insecticidas_unidad_medida_check;

ALTER TABLE insecticidas ADD COLUMN IF NOT EXISTS tipo_usos TEXT[];
UPDATE insecticidas
SET tipo_usos = ARRAY[tipo_uso::TEXT]
WHERE tipo_usos IS NULL OR cardinality(tipo_usos) = 0;
ALTER TABLE insecticidas ALTER COLUMN tipo_usos SET DEFAULT ARRAY['focal']::TEXT[];
ALTER TABLE insecticidas ALTER COLUMN tipo_usos SET NOT NULL;
ALTER TABLE insecticidas DROP CONSTRAINT IF EXISTS insecticidas_tipo_usos_check;
ALTER TABLE insecticidas ADD CONSTRAINT insecticidas_tipo_usos_check
  CHECK (
    cardinality(tipo_usos) > 0
    AND tipo_usos <@ ARRAY['focal', 'espacial', 'residual', 'larvicida']::TEXT[]
  );

CREATE TABLE IF NOT EXISTS tipos_uso_insecticida (
  codigo VARCHAR(30) PRIMARY KEY CHECK (codigo IN ('focal', 'espacial', 'residual', 'larvicida')),
  nombre VARCHAR(80) NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  orden INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO tipos_uso_insecticida (codigo, nombre, orden)
VALUES
  ('focal', 'Focal', 1),
  ('espacial', 'Espacial', 2),
  ('residual', 'Residual', 3),
  ('larvicida', 'Larvicida', 4)
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================
-- LOTES DE INSECTICIDAS
-- ============================================================
CREATE TABLE IF NOT EXISTS lotes (
  id SERIAL PRIMARY KEY,
  codigo_lote VARCHAR(50) UNIQUE NOT NULL,
  insecticida_id INTEGER NOT NULL REFERENCES insecticidas(id),
  fecha_fabricacion DATE,
  fecha_vencimiento DATE NOT NULL,
  cantidad_inicial DECIMAL(12,3) NOT NULL,
  observaciones TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STOCK POR DEPOSITO Y LOTE
-- ============================================================
CREATE TABLE IF NOT EXISTS stock (
  id SERIAL PRIMARY KEY,
  deposito_id INTEGER NOT NULL REFERENCES depositos(id),
  lote_id INTEGER NOT NULL REFERENCES lotes(id),
  cantidad DECIMAL(12,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deposito_id, lote_id)
);

-- ============================================================
-- MOVIMIENTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS movimientos (
  id SERIAL PRIMARY KEY,
  numero_mov VARCHAR(30) UNIQUE NOT NULL,
  tipo_movimiento VARCHAR(20) NOT NULL CHECK (tipo_movimiento IN ('interno', 'espacial', 'focal', 'residual', 'larvicida')),
  categoria VARCHAR(20) NOT NULL CHECK (categoria IN ('entrada', 'salida', 'transferencia', 'ajuste')),
  deposito_origen_id INTEGER REFERENCES depositos(id),
  deposito_destino_id INTEGER REFERENCES depositos(id),
  lote_id INTEGER NOT NULL REFERENCES lotes(id),
  insecticida_id INTEGER NOT NULL REFERENCES insecticidas(id),
  cantidad DECIMAL(12,3) NOT NULL,
  fecha_movimiento DATE NOT NULL,
  semana_epidemiologica INTEGER,
  año_epidemiologico INTEGER,
  descripcion TEXT,
  observaciones TEXT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  aprobado_por INTEGER REFERENCES usuarios(id),
  estado VARCHAR(20) DEFAULT 'confirmado' CHECK (estado IN ('pendiente', 'confirmado', 'anulado')),
  confirmado_at TIMESTAMPTZ,
  anulado_por INTEGER REFERENCES usuarios(id),
  motivo_anulacion TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS confirmado_at TIMESTAMPTZ;

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  accion VARCHAR(100) NOT NULL,
  tabla VARCHAR(50),
  registro_id INTEGER,
  datos_anteriores JSONB,
  datos_nuevos JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SYSTEM / SERVER LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS system_logs (
  id SERIAL PRIMARY KEY,
  nivel VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (nivel IN ('debug', 'info', 'warning', 'error', 'critical')),
  origen VARCHAR(80) NOT NULL DEFAULT 'server',
  mensaje TEXT NOT NULL,
  metadata JSONB,
  usuario_id INTEGER REFERENCES usuarios(id),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_usuario ON audit_log(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_accion ON audit_log(accion);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_nivel ON system_logs(nivel);

-- ============================================================
-- SESIONES (connect-pg-simple)
-- ============================================================
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

-- ============================================================
-- FUNCIONES Y TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_depositos_updated ON depositos;
DROP TRIGGER IF EXISTS trg_usuarios_updated ON usuarios;
DROP TRIGGER IF EXISTS trg_insecticidas_updated ON insecticidas;
DROP TRIGGER IF EXISTS trg_lotes_updated ON lotes;
DROP TRIGGER IF EXISTS trg_movimientos_updated ON movimientos;

CREATE TRIGGER trg_depositos_updated BEFORE UPDATE ON depositos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_usuarios_updated BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_insecticidas_updated BEFORE UPDATE ON insecticidas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_lotes_updated BEFORE UPDATE ON lotes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_movimientos_updated BEFORE UPDATE ON movimientos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_tipos_uso_insecticida_updated ON tipos_uso_insecticida;
CREATE TRIGGER trg_tipos_uso_insecticida_updated BEFORE UPDATE ON tipos_uso_insecticida FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Función para calcular semana epidemiológica (semana del año comenzando en domingo)
CREATE OR REPLACE FUNCTION semana_epidemiologica(fecha DATE)
RETURNS INTEGER AS $$
BEGIN
  RETURN EXTRACT(WEEK FROM fecha)::INTEGER;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos(fecha_movimiento);
CREATE INDEX IF NOT EXISTS idx_movimientos_deposito_origen ON movimientos(deposito_origen_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_deposito_destino ON movimientos(deposito_destino_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_lote ON movimientos(lote_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_insecticida ON movimientos(insecticida_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_tipo ON movimientos(tipo_movimiento);
CREATE INDEX IF NOT EXISTS idx_movimientos_semana ON movimientos(semana_epidemiologica, año_epidemiologico);
CREATE INDEX IF NOT EXISTS idx_stock_deposito ON stock(deposito_id);
CREATE INDEX IF NOT EXISTS idx_stock_lote ON stock(lote_id);
CREATE INDEX IF NOT EXISTS idx_lotes_insecticida ON lotes(insecticida_id);
CREATE INDEX IF NOT EXISTS idx_lotes_vencimiento ON lotes(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_depositos_padre ON depositos(deposito_padre_id);
CREATE INDEX IF NOT EXISTS idx_depositos_nivel ON depositos(nivel);
CREATE INDEX IF NOT EXISTS idx_audit_usuario ON audit_log(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
