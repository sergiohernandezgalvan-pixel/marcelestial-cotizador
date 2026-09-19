-- Dimensionamiento a partir del recibo de CFE
-- Réplica de la lógica de la hoja de cálculo "PLANTILLA PAGO DE CONTADO".
-- Todos los parámetros son editables por el administrador desde la app.

INSERT INTO config (clave, valor) VALUES
  ('dimensionamiento', '{
     "paneles": [
       { "clave": "625 W", "kw": 0.625, "eficiencia": 0.8, "horas_solares": 5.6 },
       { "clave": "710 W", "kw": 0.710, "eficiencia": 0.8, "horas_solares": 5.6 },
       { "clave": "725 W", "kw": 0.725, "eficiencia": 0.8, "horas_solares": 5.6 }
     ],
     "precio_por_panel": 12500,
     "m2_por_panel": 3.1,
     "dias_periodo": 30,
     "enganche_pct": 30,
     "plazo_meses": 120,
     "iva_incluido": true
   }'::jsonb)
ON CONFLICT (clave) DO NOTHING;

-- Guarda el detalle del recibo junto con la cotización
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS recibo JSONB NOT NULL DEFAULT '{}'::jsonb;
