-- Cargo fijo aproximado que CFE sigue facturando aunque el sistema cubra el 100%
-- del consumo. Cuando el análisis de ahorro da "pagará $0.00", la cotización imprime
-- una nota con este importe, para no prometerle al cliente un recibo en ceros.
-- Editable por tarifa desde Más → Configurar tarifas.
--   Tarifa 01 (casa)     $60
--   Tarifa 02 (negocio)  $250
--   GDMTO y GDMTH        $650

UPDATE config
SET valor = jsonb_set(valor, '{lista}', (
  SELECT jsonb_agg(
    CASE t->>'clave'
      WHEN 'GDMTH' THEN t || '{"cargo_fijo": 650}'::jsonb
      WHEN 'GDMTO' THEN t || '{"cargo_fijo": 650}'::jsonb
      WHEN '01'    THEN t || '{"cargo_fijo": 60}'::jsonb
      WHEN '02'    THEN t || '{"cargo_fijo": 250}'::jsonb
      ELSE t
    END ORDER BY orden)
  FROM jsonb_array_elements(valor->'lista') WITH ORDINALITY AS a(t, orden)
))
WHERE clave = 'tarifas';
