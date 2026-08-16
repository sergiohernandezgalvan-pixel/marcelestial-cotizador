-- 1) Foto del recibo: se guarda con la cotización como respaldo interno.
--    NUNCA se imprime en el PDF que ve el cliente; sólo se ve dentro de la app.
--    La imagen se comprime en el teléfono antes de subirse, así que pesa poco.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS recibo_foto TEXT;

-- 2) Tarifas domésticas 01 y 02:
--    · el precio de $13,000 aplica de 0 a 100 paneles (antes no tenía tope)
--    · incluyen gestión ante CFE
--    · incluyen estructura ligera de piso de aluminio anodizado
--    Se conserva el precio que ya estuviera capturado, por si el dueño ya lo cambió.
UPDATE config
SET valor = jsonb_set(
      jsonb_set(valor, '{lista,2}', (valor->'lista'->2) || jsonb_build_object(
        'gestion', true,
        'incluye', jsonb_build_array(
          'Estructura ligera de piso de aluminio anodizado',
          'Gestión ante CFE'),
        'escalones', jsonb_build_array(jsonb_build_object(
          'tension', '*', 'hasta', 100,
          'precio', COALESCE(valor->'lista'->2->'escalones'->0->'precio', to_jsonb(13000)))))),
      '{lista,3}', (valor->'lista'->3) || jsonb_build_object(
        'gestion', true,
        'incluye', jsonb_build_array(
          'Estructura ligera de piso de aluminio anodizado',
          'Gestión ante CFE'),
        'escalones', jsonb_build_array(jsonb_build_object(
          'tension', '*', 'hasta', 100,
          'precio', COALESCE(valor->'lista'->3->'escalones'->0->'precio', to_jsonb(13000))))))
WHERE clave = 'tarifas'
  AND valor->'lista'->2->>'clave' = '01'
  AND valor->'lista'->3->>'clave' = '02';
