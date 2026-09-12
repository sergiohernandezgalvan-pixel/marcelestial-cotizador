-- Catálogo de paneles que sí maneja Mar Celestial: 710, 715 y 720 W.
-- Se retiran 625 W y 725 W (el 725 no existe en almacén y estaba saliendo
-- en cotizaciones). Eficiencia y horas solares se conservan tal como estén
-- capturadas hoy en el renglón de 710 W; si no existe, 0.8 y 5.6.
-- Idempotente: correrla dos veces deja lo mismo.

UPDATE config
SET valor = jsonb_set(valor, '{paneles}', (
  SELECT jsonb_agg(jsonb_build_object(
           'clave',         w || ' W',
           'kw',            round(w::numeric / 1000, 3),
           'eficiencia',    COALESCE((SELECT (p->>'eficiencia')::numeric
                                        FROM jsonb_array_elements(valor->'paneles') p
                                       WHERE p->>'clave' = '710 W' LIMIT 1), 0.8),
           'horas_solares', COALESCE((SELECT (p->>'horas_solares')::numeric
                                        FROM jsonb_array_elements(valor->'paneles') p
                                       WHERE p->>'clave' = '710 W' LIMIT 1), 5.6)
         ) ORDER BY w)
  FROM (VALUES (710), (715), (720)) AS t(w)
))
WHERE clave = 'dimensionamiento';
