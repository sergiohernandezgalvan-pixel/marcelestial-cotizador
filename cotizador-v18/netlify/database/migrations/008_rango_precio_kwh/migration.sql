-- Rango normal del precio por kWh en los recibos de CFE.
-- Si una cotización sale fuera de este rango, la app avisa que revisen la captura:
-- un consumo o un total mal tecleado descuadra el proyecto entero (precio por kWh,
-- cantidad de paneles, valor y retorno de inversión).
-- Editable desde la app en Más → Configurar parámetros, por si suben las tarifas.

UPDATE config
SET valor = valor || '{ "precio_kwh_min": 3, "precio_kwh_max": 5 }'::jsonb
WHERE clave = 'dimensionamiento';
