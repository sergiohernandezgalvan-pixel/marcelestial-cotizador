-- Vales en UNA sola transacción.
--
-- Antes el vale se guardaba por partes: primero la cabecera, luego renglón por
-- renglón, y si uno fallaba se deshacían los anteriores con actualizaciones
-- compensatorias. Cada renglón era atómico, pero el conjunto no: si la función
-- moría a la mitad —tiempo agotado, corte— los renglones ya aplicados quedaban
-- y el almacén se quedaba con existencias movidas y un vale incompleto.
--
-- Con estas dos funciones el trabajo entero ocurre dentro de Postgres, en una
-- transacción: o queda todo, o no queda nada. Además, un vale no se puede
-- cancelar dos veces aunque dos administradores toquen el botón al mismo
-- tiempo: la fila del vale se bloquea (FOR UPDATE) mientras se cancela.

CREATE OR REPLACE FUNCTION registrar_vale(
  p_folio        TEXT,
  p_tipo         TEXT,
  p_fecha        DATE,
  p_cliente_id   INTEGER,
  p_cotizacion_id INTEGER,
  p_obra         TEXT,
  p_referencia   TEXT,
  p_usuario_id   INTEGER,
  p_entrego      TEXT,
  p_recibio      TEXT,
  p_recibio_tel  TEXT,
  p_firma        TEXT,
  p_origen_id    INTEGER,
  p_notas        TEXT,
  p_partidas     JSONB          -- [{ "item_id": 12, "cantidad": 40 }, ...]
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_id      INTEGER;
  v_motivo  TEXT;
  r         RECORD;
  v_saldo   NUMERIC;
  v_clave   TEXT;
  v_unidad  TEXT;
  v_hay     NUMERIC;
BEGIN
  IF p_tipo NOT IN ('salida', 'entrada', 'devolucion') THEN
    RAISE EXCEPTION 'TIPO|Tipo de vale no válido';
  END IF;

  INSERT INTO vales (folio, tipo, fecha, cliente_id, cotizacion_id, obra, referencia, usuario_id,
                     entrego_nombre, recibio_nombre, recibio_tel, recibio_firma, vale_origen_id, notas)
  VALUES (p_folio, p_tipo, p_fecha, p_cliente_id, p_cotizacion_id, p_obra, p_referencia, p_usuario_id,
          p_entrego, p_recibio, p_recibio_tel, p_firma, p_origen_id, p_notas)
  RETURNING id INTO v_id;

  v_motivo := left('Vale ' || p_folio || ' · ' || COALESCE(p_obra, ''), 200);

  -- Los renglones se procesan en orden de item_id: si dos vales tocan los
  -- mismos conceptos al mismo tiempo, ambos los bloquean en el mismo orden y
  -- no se pueden quedar esperándose uno al otro.
  FOR r IN
    SELECT (x->>'item_id')::int AS item_id, (x->>'cantidad')::numeric AS cantidad
      FROM jsonb_array_elements(p_partidas) x
     WHERE (x->>'item_id')::int IS NOT NULL AND (x->>'cantidad')::numeric > 0
     ORDER BY 1
  LOOP
    IF p_tipo = 'salida' THEN
      UPDATE catalogo SET existencia = existencia - r.cantidad, actualizado_en = NOW()
       WHERE id = r.item_id AND controla_inventario AND existencia >= r.cantidad
       RETURNING existencia INTO v_saldo;
      IF NOT FOUND THEN
        SELECT clave, unidad, existencia INTO v_clave, v_unidad, v_hay FROM catalogo WHERE id = r.item_id;
        -- El mensaje lleva un prefijo fijo para que la API lo reconozca y
        -- conteste 409 con texto claro, en lugar de un error genérico.
        RAISE EXCEPTION 'EXISTENCIA|%|%|%|%', COALESCE(v_clave, r.item_id::text), r.cantidad,
                        COALESCE(v_hay, 0), COALESCE(v_unidad, '');
      END IF;
    ELSE
      UPDATE catalogo SET existencia = existencia + r.cantidad, actualizado_en = NOW()
       WHERE id = r.item_id AND controla_inventario
       RETURNING existencia INTO v_saldo;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'CONCEPTO|%', r.item_id;
      END IF;
    END IF;

    INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, cliente_id, fecha_entrega, vale_id)
    VALUES (r.item_id, p_tipo, r.cantidad, v_saldo, v_motivo, p_usuario_id, p_cliente_id, p_fecha, v_id);
  END LOOP;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION cancelar_vale(
  p_vale_id     INTEGER,
  p_usuario_id  INTEGER,
  p_motivo      TEXT
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v         RECORD;
  l         RECORD;
  v_saldo   NUMERIC;
  v_rev     TEXT;
BEGIN
  -- Se bloquea la fila: una segunda cancelación simultánea espera y luego ve
  -- que ya está cancelado.
  SELECT id, folio, tipo, cliente_id, cancelado_en INTO v FROM vales WHERE id = p_vale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOEXISTE|%', p_vale_id; END IF;
  IF v.cancelado_en IS NOT NULL THEN RAISE EXCEPTION 'YACANCELADO|%', v.folio; END IF;

  v_rev := left('Cancelación de ' || v.folio || ': ' || p_motivo, 200);

  FOR l IN
    SELECT m.item_id, m.cantidad, c.clave, c.unidad
      FROM movimientos m JOIN catalogo c ON c.id = m.item_id
     WHERE m.vale_id = p_vale_id AND m.tipo = v.tipo
     ORDER BY m.item_id
  LOOP
    IF v.tipo = 'salida' THEN
      -- cancelar una salida regresa el material
      UPDATE catalogo SET existencia = existencia + l.cantidad, actualizado_en = NOW()
       WHERE id = l.item_id RETURNING existencia INTO v_saldo;
      INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, cliente_id, vale_id)
      VALUES (l.item_id, 'entrada', l.cantidad, v_saldo, v_rev, p_usuario_id, v.cliente_id, p_vale_id);
    ELSE
      -- cancelar una entrada o devolución saca el material: tiene que haber
      UPDATE catalogo SET existencia = existencia - l.cantidad, actualizado_en = NOW()
       WHERE id = l.item_id AND existencia >= l.cantidad RETURNING existencia INTO v_saldo;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'EXISTENCIA|%|%|%|%', l.clave, l.cantidad,
          (SELECT existencia FROM catalogo WHERE id = l.item_id), l.unidad;
      END IF;
      INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, cliente_id, vale_id)
      VALUES (l.item_id, 'salida', l.cantidad, v_saldo, v_rev, p_usuario_id, v.cliente_id, p_vale_id);
    END IF;
  END LOOP;

  UPDATE vales SET cancelado_en = NOW(), cancelado_por = p_usuario_id, motivo_cancelacion = p_motivo
   WHERE id = p_vale_id;
END $$;
