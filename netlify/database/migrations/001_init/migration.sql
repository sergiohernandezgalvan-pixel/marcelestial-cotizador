-- Mar Celestial · Cotizador — esquema inicial

CREATE TABLE IF NOT EXISTS usuarios (
  id             SERIAL PRIMARY KEY,
  correo         TEXT UNIQUE NOT NULL,
  nombre         TEXT NOT NULL,
  rol            TEXT NOT NULL DEFAULT 'vendedor',
  password_hash  TEXT NOT NULL,
  telefono       TEXT,
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clientes (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  contacto    TEXT,
  telefono    TEXT,
  correo      TEXT,
  direccion   TEXT,
  referencia  TEXT,
  notas       TEXT,
  creado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalogo (
  id                   SERIAL PRIMARY KEY,
  clave                TEXT UNIQUE NOT NULL,
  categoria            TEXT NOT NULL,
  descripcion          TEXT NOT NULL,
  unidad               TEXT NOT NULL DEFAULT 'PZA',
  precio               NUMERIC(12,2) NOT NULL DEFAULT 0,
  controla_inventario  BOOLEAN NOT NULL DEFAULT FALSE,
  existencia           NUMERIC(12,2) NOT NULL DEFAULT 0,
  minimo               NUMERIC(12,2) NOT NULL DEFAULT 0,
  activo               BOOLEAN NOT NULL DEFAULT TRUE,
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movimientos (
  id            SERIAL PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES catalogo(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,
  cantidad      NUMERIC(12,2) NOT NULL,
  saldo         NUMERIC(12,2) NOT NULL,
  motivo        TEXT,
  usuario_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id             SERIAL PRIMARY KEY,
  folio          TEXT UNIQUE NOT NULL,
  cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  vendedor_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  estatus        TEXT NOT NULL DEFAULT 'borrador',
  tecnico        JSONB NOT NULL DEFAULT '{}'::jsonb,
  partidas       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ahorro         JSONB NOT NULL DEFAULT '{}'::jsonb,
  comentarios    TEXT,
  total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cot_vendedor ON cotizaciones(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_cot_estatus  ON cotizaciones(estatus);
CREATE INDEX IF NOT EXISTS idx_mov_item     ON movimientos(item_id);

-- Catálogo base (precios en 0: el dueño los captura desde el panel)
INSERT INTO catalogo (clave, categoria, descripcion, unidad, precio, controla_inventario, minimo) VALUES
  ('001',      'perfil',       'RIEL MINI · AL6005-T5 anodizado · 380 mm',                'PZA',  0, TRUE,  50),
  ('002',      'perfil',       'RIEL CORTO MINI · AL6005-T5 anodizado · 190 mm',          'PZA',  0, TRUE,  50),
  ('ABZ-INT',  'herraje',      'Abrazadera intermedia M8x50 · aluminio anodizado',        'PZA',  0, TRUE, 100),
  ('ABZ-FIN',  'herraje',      'Abrazadera final ajustable 30/35/40 mm',                  'PZA',  0, TRUE, 100),
  ('PER-T8',   'herraje',      'Perno T M8 con tuerca de brida',                          'PZA',  0, TRUE, 100),
  ('EPDM',     'herraje',      'Empaque EPDM 90x70 mm',                                   'PZA',  0, TRUE, 100),
  ('TOR-25',   'herraje',      'Tornillo autorroscante Dacromet ST6.3x25',                'PZA',  0, TRUE, 200),
  ('TOR-75',   'herraje',      'Tornillo autoperforante SUS410 ST6.3x75',                 'PZA',  0, TRUE, 200),
  ('PANEL',    'panel',        'Panel fotovoltaico TIER-1',                               'PZA',  0, FALSE,  0),
  ('INVERSOR', 'inversor',     'Inversor interconectado a red',                           'PZA',  0, FALSE,  0),
  ('ESTRUCT',  'estructura',   'Estructura de montaje (suministro e instalacion)',        'LOTE', 0, FALSE,  0),
  ('MATELEC',  'electrico',    'Material electrico y fotovoltaico',                       'LOTE', 0, FALSE,  0),
  ('MANOBRA',  'mano_obra',    'Mano de obra calificada y certificada',                   'LOTE', 0, FALSE,  0),
  ('GESTCFE',  'servicio',     'Gestion e interconexion ante CFE',                        'SERV', 0, FALSE,  0),
  ('LIMPIEZA', 'servicio',     'Limpieza profesional de paneles',                         'SERV', 0, FALSE,  0),
  ('MANTTO',   'servicio',     'Mantenimiento preventivo FV',                             'SERV', 0, FALSE,  0)
ON CONFLICT (clave) DO NOTHING;
