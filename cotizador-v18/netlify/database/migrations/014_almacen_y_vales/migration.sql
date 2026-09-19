-- 014 · Rol de almacén, vales de entrada/salida y refuerzos de seguridad.
-- Todo es idempotente: se puede volver a correr sin romper nada.

/* ============ 1. Rol «almacen» ============
   Hasta hoy sólo había dueño y vendedor. El almacenista registra entradas y
   salidas de material y ve existencias, pero no cotiza ni ve precios. */
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_chk;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_chk
  CHECK (rol IN ('owner', 'vendedor', 'almacen'));

/* ============ 2. Freno a la fuerza bruta en el login ============
   Sin esto, cualquiera puede probar contraseñas sin límite. Y como las
   contraseñas se cifran con scrypt (lento a propósito), cada intento fallido
   también le cuesta procesador al servidor.
   Regla: 5 fallos seguidos bloquean la cuenta 15 minutos. Un acceso correcto
   pone el contador en cero. Cambiar la contraseña levanta el bloqueo. */
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS intentos_fallidos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado_hasta   TIMESTAMPTZ;

/* ============ 3. El historial de inventario no se borra en cascada ============
   `movimientos.item_id` colgaba de `catalogo` con ON DELETE CASCADE: borrar un
   concepto borraba en silencio todas sus entradas, salidas y ajustes. Ahora la
   base de datos lo impide; la app desactiva el concepto en lugar de borrarlo. */
ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_item_id_fkey;
ALTER TABLE movimientos ADD CONSTRAINT movimientos_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES catalogo(id) ON DELETE RESTRICT;

/* ============ 4. Vales ============
   Un vale agrupa en un solo documento con folio todo lo que salió (o entró)
   en una misma entrega: 20 rieles + 40 ángulos + tornillería son UN vale,
   no tres movimientos sueltos que después nadie relaciona.

   tipo         salida      material que sale a una obra o a un cliente
                entrada     material que llega de un proveedor
                devolucion  sobrante que regresa de una obra (referencia al vale de salida)
   obra         nombre de la obra o destino; en entradas, el proveedor u origen.
                Es texto además de `cotizacion_id` porque hay salidas sin
                cotización de por medio (instalaciones propias, por ejemplo).
   usuario_id   quién lo capturó en el sistema (lo pone el servidor, no se edita)
   entrego      quién entregó físicamente: puede ser un chofer sin cuenta
   recibio      quién lo recibió: instalador, cliente o transportista
   recibio_firma firma trazada en pantalla, PNG chico (~5 KB); opcional
   cancelado_*  un vale no se borra: se cancela y se registran los movimientos
                inversos, para que el kardex cuadre siempre. */
CREATE TABLE IF NOT EXISTS vales (
  id                 SERIAL PRIMARY KEY,
  folio              TEXT UNIQUE NOT NULL,
  tipo               TEXT NOT NULL CHECK (tipo IN ('salida', 'entrada', 'devolucion')),
  fecha              DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id         INTEGER REFERENCES clientes(id)     ON DELETE SET NULL,
  cotizacion_id      INTEGER REFERENCES cotizaciones(id) ON DELETE SET NULL,
  obra               TEXT NOT NULL,
  referencia         TEXT,
  usuario_id         INTEGER REFERENCES usuarios(id)     ON DELETE SET NULL,
  entrego_nombre     TEXT NOT NULL,
  recibio_nombre     TEXT NOT NULL,
  recibio_tel        TEXT,
  recibio_firma      TEXT,
  vale_origen_id     INTEGER REFERENCES vales(id)        ON DELETE SET NULL,
  notas              TEXT,
  cancelado_en       TIMESTAMPTZ,
  cancelado_por      INTEGER REFERENCES usuarios(id)     ON DELETE SET NULL,
  motivo_cancelacion TEXT,
  demo               BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS vale_id INTEGER REFERENCES vales(id) ON DELETE SET NULL;

/* Índices que faltaban. Con pocos registros no se nota; con miles sí. */
CREATE INDEX IF NOT EXISTS idx_cot_cliente   ON cotizaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cli_creador   ON clientes(creado_por);
CREATE INDEX IF NOT EXISTS idx_mov_cliente   ON movimientos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_mov_vale      ON movimientos(vale_id);
CREATE INDEX IF NOT EXISTS idx_mov_fecha     ON movimientos(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_vales_cliente ON vales(cliente_id);
CREATE INDEX IF NOT EXISTS idx_vales_cot     ON vales(cotizacion_id);
CREATE INDEX IF NOT EXISTS idx_vales_fecha   ON vales(fecha DESC, id DESC);

/* ============ 5. Kardex ============
   Una vista que junta cada movimiento con su vale, su cliente, su obra y quién
   entregó y recibió. Sirve tanto a la app como para consultas directas:
     SELECT * FROM kardex WHERE clave = '2442' AND cliente ILIKE '%rohovi%'; */
CREATE OR REPLACE VIEW kardex AS
  SELECT m.id, m.fecha, m.tipo, m.cantidad, m.saldo, m.motivo,
         c.id AS item_id, c.clave, c.descripcion, c.unidad,
         v.id AS vale_id, v.folio AS vale, v.fecha AS fecha_vale, v.tipo AS tipo_vale,
         v.obra, v.referencia, v.entrego_nombre, v.recibio_nombre, v.recibio_tel,
         v.cancelado_en IS NOT NULL AS vale_cancelado,
         COALESCE(v.cliente_id, m.cliente_id) AS cliente_id,
         cl.nombre AS cliente,
         v.cotizacion_id, q.folio AS cotizacion,
         m.usuario_id, u.nombre AS capturo
    FROM movimientos m
    JOIN catalogo c       ON c.id  = m.item_id
    LEFT JOIN vales v     ON v.id  = m.vale_id
    LEFT JOIN clientes cl ON cl.id = COALESCE(v.cliente_id, m.cliente_id)
    LEFT JOIN cotizaciones q ON q.id = v.cotizacion_id
    LEFT JOIN usuarios u  ON u.id  = m.usuario_id;
