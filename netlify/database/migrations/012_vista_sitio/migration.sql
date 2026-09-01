-- Vista previa del proyecto sobre la foto de dron del sitio.
--   foto_sitio : la fotografía aérea tal como la tomó el vendedor
--   sitio      : las cuatro esquinas del techo que marcó, sus medidas en
--                metros y el acomodo (filas y columnas) del arreglo
-- La imagen terminada NO se guarda: se vuelve a dibujar cuando se necesita,
-- así siempre coincide con el número de paneles que trae la cotización.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS foto_sitio TEXT;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS sitio      JSONB;
