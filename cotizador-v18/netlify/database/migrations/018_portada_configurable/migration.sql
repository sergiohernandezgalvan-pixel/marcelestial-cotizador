-- Portada configurable: misión, visión y foto de portada.
-- El texto de misión y visión que traía la portada es el de Marcelestial y
-- habla de eólica y almacenamiento; una empresa que sólo hace solar no puede
-- firmar eso, y copiarlo tal cual sería usar el discurso de otro. Igual la foto
-- de portada. Ahora los tres viven en config y se editan desde la app.
-- La instalación de Marcelestial conserva lo que ya tenía.
UPDATE config SET valor = valor || jsonb_build_object(
  'mision_titulo', 'Energía bien administrada',
  'mision_texto',  'Ser una solución integral, en México y el mundo, para la administración eficiente de la energía: integramos tecnología fotovoltaica, eólica y sistemas avanzados de almacenamiento para generar ahorros sostenibles, optimizar el uso de los recursos energéticos de nuestros clientes y contribuir activamente al cuidado del medio ambiente, impulsando el desarrollo de una sociedad más próspera, responsable y sustentable.',
  'vision_titulo', 'Transformar el consumo de energía',
  'vision_texto',  'Transformar la manera en que las personas, empresas e industrias consumen energía, con estrategias innovadoras que permitan un rápido retorno de inversión y la creación de activos energéticos perdurables. A través de modelos de ahorro compartido y soluciones tecnológicas de última generación, brindamos beneficios económicos inmediatos con una inversión accesible, generando valor sostenible para nuestros clientes.',
  'portada', '/img/portada.jpg'
) WHERE clave = 'empresa' AND NOT (valor ? 'mision_texto');
