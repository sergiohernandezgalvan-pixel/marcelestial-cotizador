-- El aviso de "revisa la captura" usaba un solo rango de precio por kWh para
-- todas las tarifas ($3.00 a $5.50). En media tensión industrial el kWh sale
-- más barato --GDMTH real de Dinamismo en Plástico: $2.5971-- y el aviso salía
-- en cotizaciones bien capturadas.
--
-- A partir de aquí cada tarifa puede traer su propio rango. Las que se quedan
-- en cero siguen usando el rango general del dimensionamiento.
-- Editable desde Más -> Configurar tarifas.

UPDATE config
   SET valor = jsonb_set(
         valor,
         '{lista}',
         (SELECT jsonb_agg(
                   CASE
                     WHEN t->>'grupo' = 'media'
                       THEN t || '{"precio_kwh_min": 2.0, "precio_kwh_max": 4.5}'::jsonb
                     ELSE t
                   END)
            FROM jsonb_array_elements(valor->'lista') AS t))
 WHERE clave = 'tarifas'
   AND valor ? 'lista'
   AND jsonb_typeof(valor->'lista') = 'array';
