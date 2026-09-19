-- Datos de la empresa que firma las cotizaciones.
-- Estaban escritos dentro del código, así que cualquier instalación nueva
-- sacaba las propuestas con el nombre y el logo de Marcelestial. Ahora viven
-- en config y se editan desde la app, sin tocar el código. El valor por
-- omisión son los datos actuales de Marcelestial, para que la instalación que
-- ya está en producción no cambie de un día para otro.
INSERT INTO config (clave, valor) VALUES ('empresa', jsonb_build_object(
  'razon_social', 'Comercializadora Marcelestial S.A.S.',
  'giro',         'Perfiles de aluminio · Sistemas fotovoltaicos · Soluciones eléctricas',
  'whatsapp',     '55 7657 4769',
  'correo',       'contacto@marcelestial.net',
  'web',          'www.marcelestial.net',
  'cobertura',    'CDMX y Estado de México',
  'logo',         '/icons/logo.png'
)) ON CONFLICT (clave) DO NOTHING;
