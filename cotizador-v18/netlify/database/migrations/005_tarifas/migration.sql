-- Tarifas de CFE con su tabla de precios por panel.
-- Todo es editable por el administrador desde la app.

INSERT INTO config (clave, valor) VALUES
  ('tarifas', '{
     "paneles_por_inversor": 140,
     "lista": [
       {
         "clave": "GDMTH",
         "nombre": "GDMTH · Gran demanda en media tensión horaria",
         "grupo": "media",
         "horaria": true,
         "uvie": true,
         "gestion": true,
         "tensiones": ["220", "440"],
         "escalones": [
           { "tension": "220", "hasta": 99,   "precio": 12000 },
           { "tension": "220", "hasta": 1000, "precio": 11500 },
           { "tension": "440", "hasta": 99,   "precio": 11500 },
           { "tension": "440", "hasta": 1000, "precio": 11000 }
         ]
       },
       {
         "clave": "GDMTO",
         "nombre": "GDMTO · Gran demanda en media tensión ordinaria",
         "grupo": "media",
         "horaria": false,
         "uvie": true,
         "gestion": true,
         "tensiones": ["220", "440"],
         "escalones": [
           { "tension": "220", "hasta": 99,   "precio": 12000 },
           { "tension": "220", "hasta": 1000, "precio": 11500 },
           { "tension": "440", "hasta": 99,   "precio": 11500 },
           { "tension": "440", "hasta": 1000, "precio": 11000 }
         ]
       },
       {
         "clave": "01",
         "nombre": "Tarifa 01 · Casa",
         "grupo": "domestica",
         "horaria": false,
         "uvie": false,
         "gestion": false,
         "tensiones": ["127", "220"],
         "escalones": [ { "tension": "*", "hasta": 99999, "precio": 13000 } ]
       },
       {
         "clave": "02",
         "nombre": "Tarifa 02 · Negocio",
         "grupo": "domestica",
         "horaria": false,
         "uvie": false,
         "gestion": false,
         "tensiones": ["127", "220"],
         "escalones": [ { "tension": "*", "hasta": 99999, "precio": 13000 } ]
       }
     ],
     "hilos": [
       { "hilos": 1, "tension": "127", "descripcion": "1 hilo · 127 V" },
       { "hilos": 2, "tension": "220", "descripcion": "2 hilos · 220 V" },
       { "hilos": 3, "tension": "220", "descripcion": "3 hilos · 220 V" }
     ]
   }'::jsonb)
ON CONFLICT (clave) DO NOTHING;
