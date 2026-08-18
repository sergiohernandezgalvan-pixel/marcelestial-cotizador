-- 1) Cotización rápida por número de paneles: no parte de un recibo, así que no hay
--    de dónde sacar el precio por kWh. Se usa $3.50 por default, editable desde la app
--    (Más → Cotizador rápido), para poder mostrarle un retorno de inversión al cliente.
UPDATE config
SET valor = valor || '{ "precio_kwh_default": 3.5 }'::jsonb
WHERE clave = 'rapido_fotovoltaico';

-- 2) La alarma del precio por kWh sube su techo a $5.50: hay clientes reales que pagan
--    $5 el kWh (tiendas y casas), y con el tope en $5.00 exactos se disparaban alarmas
--    falsas en cotizaciones legítimas.
UPDATE config
SET valor = valor || '{ "precio_kwh_max": 5.5 }'::jsonb
WHERE clave = 'dimensionamiento';
