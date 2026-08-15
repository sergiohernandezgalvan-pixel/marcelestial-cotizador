-- Líneas de negocio, cotización rápida y bitácora de seguimiento

/* ---- línea de negocio en el catálogo ---- */
ALTER TABLE catalogo     ADD COLUMN IF NOT EXISTS linea TEXT NOT NULL DEFAULT 'fotovoltaico';
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS linea TEXT NOT NULL DEFAULT 'fotovoltaico';
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS tipo  TEXT NOT NULL DEFAULT 'formal';

UPDATE catalogo SET linea = 'perfiles'  WHERE categoria IN ('perfil','herraje');
UPDATE catalogo SET linea = 'electrico' WHERE clave IN ('GESTCFE','LIMPIEZA','MANTTO');

/* ---- parámetros del cotizador rápido (solo los edita el administrador) ---- */
CREATE TABLE IF NOT EXISTS config (
  clave          TEXT PRIMARY KEY,
  valor          JSONB NOT NULL DEFAULT '{}'::jsonb,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO config (clave, valor) VALUES
  ('rapido_fotovoltaico', '{
     "panel_precio": 0,
     "inversor_precio": 0,
     "estructura_por_panel": 0,
     "electrico_por_kwp": 0,
     "manobra_por_kwp": 0,
     "produccion_kwh_kwp_bim": 150,
     "paneles_por_inversor": 20
   }'::jsonb)
ON CONFLICT (clave) DO NOTHING;

/* ---- bitácora de seguimiento por cotización ---- */
CREATE TABLE IF NOT EXISTS seguimiento (
  id            SERIAL PRIMARY KEY,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  usuario_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  estatus       TEXT,
  nota          TEXT NOT NULL,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seg_cot ON seguimiento(cotizacion_id);

/* ---- entregas de inventario ligadas a cliente y fecha ---- */
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL;
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS fecha_entrega  DATE;
