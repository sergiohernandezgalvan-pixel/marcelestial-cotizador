-- Guía de selección de inversores Growatt (módulos de 710 W, de 2 a 1,000 paneles).
-- La búsqueda es estrictamente por número de paneles.
-- Arriba de 1,000 paneles no hay dato: la app pide revisión de ingeniería.
-- Hoy el inversor va incluido en el precio por panel (inversor_se_cobra = false).
-- El día que cambie de marca o suban los precios, se prende ese interruptor y se
-- capturan los precios por renglón, sin tocar código.

UPDATE config
SET valor = valor || '{
  "guia_inversores": [
    { "desde": 2,   "hasta": 4,    "kwp_min": 1.42,   "kwp_max": 2.84,   "inversores": 1, "capacidad_ac": "2 kW",           "modelo": "NEO 2000M-X", "nota": "Microinversor; validar corriente del módulo", "precio": 0 },
    { "desde": 5,   "hasta": 7,    "kwp_min": 3.55,   "kwp_max": 4.97,   "inversores": 1, "capacidad_ac": "4-5 kW",         "modelo": "MIN",         "nota": "Residencial", "precio": 0 },
    { "desde": 8,   "hasta": 10,   "kwp_min": 5.68,   "kwp_max": 7.10,   "inversores": 1, "capacidad_ac": "6 kW",           "modelo": "MIN",         "nota": "Residencial", "precio": 0 },
    { "desde": 11,  "hasta": 14,   "kwp_min": 7.81,   "kwp_max": 9.94,   "inversores": 1, "capacidad_ac": "7-10 kW",        "modelo": "MIN",         "nota": "Residencial", "precio": 0 },
    { "desde": 15,  "hasta": 18,   "kwp_min": 10.65,  "kwp_max": 12.78,  "inversores": 1, "capacidad_ac": "10-12 kW",       "modelo": "MID",         "nota": "Trifásico según red", "precio": 0 },
    { "desde": 19,  "hasta": 25,   "kwp_min": 13.49,  "kwp_max": 17.75,  "inversores": 1, "capacidad_ac": "15 kW",          "modelo": "MID",         "nota": "Trifásico", "precio": 0 },
    { "desde": 26,  "hasta": 35,   "kwp_min": 18.46,  "kwp_max": 24.85,  "inversores": 1, "capacidad_ac": "20-25 kW",       "modelo": "MID",         "nota": "Trifásico", "precio": 0 },
    { "desde": 36,  "hasta": 45,   "kwp_min": 25.56,  "kwp_max": 31.95,  "inversores": 1, "capacidad_ac": "25-30 kW",       "modelo": "MID / MAC",   "nota": "Comercial", "precio": 0 },
    { "desde": 46,  "hasta": 55,   "kwp_min": 32.66,  "kwp_max": 39.05,  "inversores": 1, "capacidad_ac": "30-36 kW",       "modelo": "MAC",         "nota": "Comercial", "precio": 0 },
    { "desde": 56,  "hasta": 70,   "kwp_min": 39.76,  "kwp_max": 49.70,  "inversores": 1, "capacidad_ac": "40-50 kW",       "modelo": "MAC / MAX",   "nota": "Comercial", "precio": 0 },
    { "desde": 71,  "hasta": 85,   "kwp_min": 50.41,  "kwp_max": 60.35,  "inversores": 1, "capacidad_ac": "50 kW",          "modelo": "MAX",         "nota": "Comercial", "precio": 0 },
    { "desde": 86,  "hasta": 100,  "kwp_min": 61.06,  "kwp_max": 71.00,  "inversores": 1, "capacidad_ac": "60 kW",          "modelo": "MAX",         "nota": "Comercial", "precio": 0 },
    { "desde": 101, "hasta": 120,  "kwp_min": 71.71,  "kwp_max": 85.20,  "inversores": 1, "capacidad_ac": "70-75 kW",       "modelo": "MAX",         "nota": "Comercial", "precio": 0 },
    { "desde": 121, "hasta": 150,  "kwp_min": 85.91,  "kwp_max": 106.50, "inversores": 1, "capacidad_ac": "80-100 kW",      "modelo": "MAX",         "nota": "Comercial / industrial", "precio": 0 },
    { "desde": 151, "hasta": 175,  "kwp_min": 107.21, "kwp_max": 124.25, "inversores": 1, "capacidad_ac": "100 kW",         "modelo": "MAX 100K",    "nota": "Industrial", "precio": 0 },
    { "desde": 176, "hasta": 210,  "kwp_min": 124.96, "kwp_max": 149.10, "inversores": 1, "capacidad_ac": "125 kW",         "modelo": "MAX 125K",    "nota": "Industrial", "precio": 0 },
    { "desde": 211, "hasta": 250,  "kwp_min": 149.81, "kwp_max": 177.50, "inversores": 2, "capacidad_ac": "2 x 75 kW",      "modelo": "MAX",         "nota": "Industrial", "precio": 0 },
    { "desde": 251, "hasta": 300,  "kwp_min": 178.21, "kwp_max": 213.00, "inversores": 2, "capacidad_ac": "2 x 100 kW",     "modelo": "MAX 100K",    "nota": "Industrial", "precio": 0 },
    { "desde": 301, "hasta": 350,  "kwp_min": 213.71, "kwp_max": 248.50, "inversores": 2, "capacidad_ac": "2 x 100-125 kW", "modelo": "MAX",         "nota": "Industrial", "precio": 0 },
    { "desde": 351, "hasta": 400,  "kwp_min": 249.21, "kwp_max": 284.00, "inversores": 2, "capacidad_ac": "2 x 125 kW",     "modelo": "MAX 125K",    "nota": "Industrial", "precio": 0 },
    { "desde": 401, "hasta": 450,  "kwp_min": 284.71, "kwp_max": 319.50, "inversores": 3, "capacidad_ac": "3 x 100 kW",     "modelo": "MAX 100K",    "nota": "Industrial", "precio": 0 },
    { "desde": 451, "hasta": 500,  "kwp_min": 320.21, "kwp_max": 355.00, "inversores": 3, "capacidad_ac": "3 x 100 kW",     "modelo": "MAX 100K",    "nota": "Industrial", "precio": 0 },
    { "desde": 501, "hasta": 550,  "kwp_min": 355.71, "kwp_max": 390.50, "inversores": 3, "capacidad_ac": "3 x 125 kW",     "modelo": "MAX 125K",    "nota": "Industrial", "precio": 0 },
    { "desde": 551, "hasta": 600,  "kwp_min": 391.21, "kwp_max": 426.00, "inversores": 4, "capacidad_ac": "4 x 100 kW",     "modelo": "MAX 100K",    "nota": "Industrial", "precio": 0 },
    { "desde": 601, "hasta": 650,  "kwp_min": 426.71, "kwp_max": 461.50, "inversores": 4, "capacidad_ac": "4 x 100 kW",     "modelo": "MAX 100K",    "nota": "Industrial", "precio": 0 },
    { "desde": 651, "hasta": 700,  "kwp_min": 462.21, "kwp_max": 497.00, "inversores": 4, "capacidad_ac": "4 x 125 kW",     "modelo": "MAX 125K",    "nota": "Industrial", "precio": 0 },
    { "desde": 701, "hasta": 750,  "kwp_min": 497.71, "kwp_max": 532.50, "inversores": 5, "capacidad_ac": "5 x 100 kW",     "modelo": "MAX 100K",    "nota": "Industrial", "precio": 0 },
    { "desde": 751, "hasta": 800,  "kwp_min": 533.21, "kwp_max": 568.00, "inversores": 5, "capacidad_ac": "5 x 100 kW",     "modelo": "MAX 100K",    "nota": "Industrial", "precio": 0 },
    { "desde": 801, "hasta": 850,  "kwp_min": 568.71, "kwp_max": 603.50, "inversores": 5, "capacidad_ac": "5 x 125 kW",     "modelo": "MAX 125K",    "nota": "Industrial", "precio": 0 },
    { "desde": 851, "hasta": 900,  "kwp_min": 604.21, "kwp_max": 639.00, "inversores": 6, "capacidad_ac": "6 x 100 kW",     "modelo": "MAX 100K",    "nota": "Industrial", "precio": 0 },
    { "desde": 901, "hasta": 950,  "kwp_min": 639.71, "kwp_max": 674.50, "inversores": 6, "capacidad_ac": "6 x 100 kW",     "modelo": "MAX 100K",    "nota": "Industrial", "precio": 0 },
    { "desde": 951, "hasta": 1000, "kwp_min": 675.21, "kwp_max": 710.00, "inversores": 6, "capacidad_ac": "6 x 100-125 kW", "modelo": "MAX",         "nota": "Industrial", "precio": 0 }
  ],
  "guia_marca": "Growatt",
  "guia_base_w": 710,
  "inversor_se_cobra": false
}'::jsonb
WHERE clave = 'tarifas';
