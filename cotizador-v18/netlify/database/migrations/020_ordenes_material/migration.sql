-- Órdenes de compra de material a Comercializadora Mar Celestial.
--
-- Cuando el instalador marca una cotización como ganada, la aplicación calcula
-- el material de montaje que lleva ese proyecto y arma una orden de compra al
-- proveedor. Es lo que convierte la aplicación en un canal de venta: cada obra
-- ganada por el cliente se vuelve un pedido.
--
-- El catálogo del proveedor y la regla de consumo viven en config para que se
-- puedan cambiar sin tocar código: el día que entren la estructura, el cable FV
-- o los interruptores de DC, se agregan como renglones más.

INSERT INTO config (clave, valor) VALUES ('material_proveedor', jsonb_build_object(
  'proveedor', jsonb_build_object(
    'razon_social', 'Comercializadora Mar Celestial S.A.S.',
    'giro',     'Perfiles de aluminio · Sistemas fotovoltaicos · Soluciones eléctricas',
    'whatsapp', '55 7657 4769',
    'correo',   'contacto@marcelestial.net',
    'web',      'www.marcelestial.net'
  ),
  'iva', 0.16,
  -- Regla de consumo. Los puntos de sujeción interiores se COMPARTEN entre dos
  -- paneles vecinos: un riel con su clamp detiene el borde de uno y el del
  -- siguiente. Por eso no es "4 por panel" a secas.
  --
  -- Por hilera de n paneles hay dos líneas de riel (arriba y abajo del panel) y
  -- cada línea lleva n+1 posiciones:
  --     piezas = 2 × (n + 1) por hilera
  -- que sumado sobre todo el proyecto queda:
  --     piezas = por_modulo × módulos + por_hilera × hileras
  -- con por_modulo = 2 y por_hilera = 2.
  --
  -- Comprobación: un panel solo = 2 + 2 = 4 piezas. Dos paneles en línea = 6,
  -- no 8, porque comparten el punto de en medio.
  --
  -- Un renglón con por_modulo y por_hilera en 0 no se calcula solo: se captura
  -- a mano en la orden. Ahí entrarán la estructura, el cable FV y los
  -- interruptores de DC cuando estén en catálogo.
  'productos', jsonb_build_array(
    jsonb_build_object(
      'clave', '001', 'nombre', 'Riel Mini',
      'detalle', 'Riel de aluminio AL6005-T5, 380 mm, 0.29 kg',
      'unidad', 'pza', 'por_modulo', 2, 'por_hilera', 2,
      'escalones', jsonb_build_array(
        jsonb_build_object('hasta', 200,  'precio', 58),
        jsonb_build_object('hasta', 600,  'precio', 56),
        jsonb_build_object('hasta', 0,    'precio', 54)
      )
    ),
    jsonb_build_object(
      'clave', '003', 'nombre', 'Clamp abrazadera',
      'detalle', 'Clamp de aluminio anodizado + perno Allen M8×50 SUS304 + roldana de presión SUS304 + tuerca. Módulos de 26 a 44 mm',
      'unidad', 'pza', 'por_modulo', 2, 'por_hilera', 2,
      'escalones', jsonb_build_array(
        jsonb_build_object('hasta', 200,  'precio', 17),
        jsonb_build_object('hasta', 600,  'precio', 16),
        jsonb_build_object('hasta', 0,    'precio', 15)
      )
    )
  )
)) ON CONFLICT (clave) DO NOTHING;

CREATE TABLE IF NOT EXISTS ordenes (
  id             SERIAL PRIMARY KEY,
  folio          TEXT NOT NULL UNIQUE,          -- OC-2026-0001
  cotizacion_id  INTEGER REFERENCES cotizaciones(id) ON DELETE SET NULL,
  cliente_id     INTEGER REFERENCES clientes(id)     ON DELETE SET NULL,
  obra           TEXT,
  modulos        INTEGER NOT NULL DEFAULT 0,
  hileras        INTEGER NOT NULL DEFAULT 1,
  partidas       JSONB   NOT NULL DEFAULT '[]'::jsonb,
  subtotal       NUMERIC(14,2) NOT NULL DEFAULT 0,
  iva            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  notas          TEXT,
  enviada_en     TIMESTAMPTZ,
  usuario_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  cancelado_en   TIMESTAMPTZ,
  cancelado_por  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  cancelado_motivo TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ordenes_cot     ON ordenes(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_creado  ON ordenes(creado_en DESC);
