-- Marca para poder cargar y borrar datos de ejemplo sin tocar los reales

ALTER TABLE clientes     ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE movimientos  ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_cli_demo ON clientes(demo);
CREATE INDEX IF NOT EXISTS idx_cot_demo ON cotizaciones(demo);
