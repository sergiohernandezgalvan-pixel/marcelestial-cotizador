import {
  db, json, err, hashPassword, verifyPassword, signToken,
  sesion, esDueno, num, limpio, siguienteFolio, totalDePartidas,
} from "../lib/core.mjs";

export const config = { path: "/api/*" };

export default async (req) => {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const metodo = req.method.toUpperCase();
  const cuerpo = ["POST", "PATCH", "PUT"].includes(metodo)
    ? await req.json().catch(() => ({}))
    : {};

  try {
    /* ============ ARRANQUE / SESIÓN ============ */
    if (ruta === "estado" && metodo === "GET") {
      const [r] = await db.sql`SELECT COUNT(*)::int AS n FROM usuarios`;
      return json({ instalado: (r?.n || 0) > 0 });
    }

    if (ruta === "setup" && metodo === "POST") {
      const [r] = await db.sql`SELECT COUNT(*)::int AS n FROM usuarios`;
      if ((r?.n || 0) > 0) return err("La aplicación ya está configurada.", 409);
      const correo = limpio(cuerpo.correo, 120)?.toLowerCase();
      const nombre = limpio(cuerpo.nombre, 120);
      const pass = String(cuerpo.password || "");
      if (!correo || !nombre || pass.length < 8)
        return err("Correo, nombre y contraseña de al menos 8 caracteres son obligatorios.");
      const [u] = await db.sql`
        INSERT INTO usuarios (correo, nombre, rol, password_hash)
        VALUES (${correo}, ${nombre}, 'owner', ${hashPassword(pass)})
        RETURNING id, correo, nombre, rol`;
      return json({ token: signToken({ uid: u.id }), usuario: u });
    }

    if (ruta === "login" && metodo === "POST") {
      const correo = limpio(cuerpo.correo, 120)?.toLowerCase();
      const [u] = await db.sql`SELECT * FROM usuarios WHERE correo = ${correo} LIMIT 1`;
      if (!u || !u.activo || !verifyPassword(cuerpo.password || "", u.password_hash))
        return err("Correo o contraseña incorrectos.", 401);
      return json({
        token: signToken({ uid: u.id }),
        usuario: { id: u.id, correo: u.correo, nombre: u.nombre, rol: u.rol },
      });
    }

    /* ============ A PARTIR DE AQUÍ SE REQUIERE SESIÓN ============ */
    const yo = await sesion(req);
    if (!yo) return err("Sesión no válida. Vuelve a iniciar sesión.", 401);

    if (ruta === "yo" && metodo === "GET") return json({ usuario: yo });

    if (ruta === "cambiar-password" && metodo === "POST") {
      const nueva = String(cuerpo.nueva || "");
      if (nueva.length < 8) return err("La contraseña debe tener al menos 8 caracteres.");
      const [u] = await db.sql`SELECT password_hash FROM usuarios WHERE id = ${yo.id}`;
      if (!verifyPassword(cuerpo.actual || "", u.password_hash))
        return err("La contraseña actual no es correcta.", 403);
      await db.sql`UPDATE usuarios SET password_hash = ${hashPassword(nueva)} WHERE id = ${yo.id}`;
      return json({ ok: true });
    }

    /* ============ VENDEDORES (solo dueño) ============ */
    if (ruta === "usuarios") {
      if (!esDueno(yo)) return err("Solo el administrador puede gestionar vendedores.", 403);
      if (metodo === "GET") {
        const filas = await db.sql`
          SELECT u.id, u.correo, u.nombre, u.rol, u.telefono, u.activo, u.creado_en,
                 (SELECT COUNT(*)::int FROM cotizaciones c WHERE c.vendedor_id = u.id) AS cotizaciones
          FROM usuarios u ORDER BY u.rol DESC, u.nombre`;
        return json({ usuarios: filas });
      }
      if (metodo === "POST") {
        const correo = limpio(cuerpo.correo, 120)?.toLowerCase();
        const nombre = limpio(cuerpo.nombre, 120);
        const pass = String(cuerpo.password || "");
        if (!correo || !nombre || pass.length < 8)
          return err("Correo, nombre y contraseña de al menos 8 caracteres son obligatorios.");
        const existe = await db.sql`SELECT id FROM usuarios WHERE correo = ${correo}`;
        if (existe.length) return err("Ya existe un usuario con ese correo.", 409);
        const [u] = await db.sql`
          INSERT INTO usuarios (correo, nombre, rol, telefono, password_hash)
          VALUES (${correo}, ${nombre}, ${cuerpo.rol === "owner" ? "owner" : "vendedor"},
                  ${limpio(cuerpo.telefono, 40)}, ${hashPassword(pass)})
          RETURNING id, correo, nombre, rol, telefono, activo`;
        return json({ usuario: u }, 201);
      }
      if (metodo === "PATCH") {
        const id = num(cuerpo.id);
        if (id === yo.id && cuerpo.activo === false)
          return err("No puedes desactivar tu propia cuenta.");
        if (cuerpo.password) {
          if (String(cuerpo.password).length < 8) return err("Contraseña demasiado corta.");
          await db.sql`UPDATE usuarios SET password_hash = ${hashPassword(cuerpo.password)} WHERE id = ${id}`;
        }
        await db.sql`
          UPDATE usuarios SET
            nombre   = COALESCE(${limpio(cuerpo.nombre, 120)}, nombre),
            telefono = COALESCE(${limpio(cuerpo.telefono, 40)}, telefono),
            activo   = COALESCE(${typeof cuerpo.activo === "boolean" ? cuerpo.activo : null}, activo)
          WHERE id = ${id}`;
        return json({ ok: true });
      }
    }

    /* ============ CLIENTES ============ */
    if (ruta === "clientes") {
      if (metodo === "GET") {
        const filas = esDueno(yo)
          ? await db.sql`SELECT c.*, u.nombre AS creador FROM clientes c
                         LEFT JOIN usuarios u ON u.id = c.creado_por ORDER BY c.nombre`
          : await db.sql`SELECT c.*, NULL AS creador FROM clientes c
                         WHERE c.creado_por = ${yo.id} ORDER BY c.nombre`;
        return json({ clientes: filas });
      }
      if (metodo === "POST") {
        const nombre = limpio(cuerpo.nombre, 160);
        if (!nombre) return err("El nombre del cliente es obligatorio.");
        const [c] = await db.sql`
          INSERT INTO clientes (nombre, contacto, telefono, correo, direccion, referencia, notas, creado_por)
          VALUES (${nombre}, ${limpio(cuerpo.contacto, 120)}, ${limpio(cuerpo.telefono, 40)},
                  ${limpio(cuerpo.correo, 120)}, ${limpio(cuerpo.direccion, 300)},
                  ${limpio(cuerpo.referencia, 80)}, ${limpio(cuerpo.notas, 1000)}, ${yo.id})
          RETURNING *`;
        return json({ cliente: c }, 201);
      }
      if (metodo === "PATCH") {
        const id = num(cuerpo.id);
        const [c] = await db.sql`SELECT * FROM clientes WHERE id = ${id}`;
        if (!c) return err("Cliente no encontrado.", 404);
        if (!esDueno(yo) && c.creado_por !== yo.id) return err("No puedes editar este cliente.", 403);
        await db.sql`
          UPDATE clientes SET
            nombre     = COALESCE(${limpio(cuerpo.nombre, 160)}, nombre),
            contacto   = ${limpio(cuerpo.contacto, 120)},
            telefono   = ${limpio(cuerpo.telefono, 40)},
            correo     = ${limpio(cuerpo.correo, 120)},
            direccion  = ${limpio(cuerpo.direccion, 300)},
            referencia = ${limpio(cuerpo.referencia, 80)},
            notas      = ${limpio(cuerpo.notas, 1000)}
          WHERE id = ${id}`;
        return json({ ok: true });
      }
    }

    /* ============ CATÁLOGO E INVENTARIO ============ */
    if (ruta === "catalogo") {
      if (metodo === "GET") {
        const filas = await db.sql`SELECT * FROM catalogo ORDER BY categoria, clave`;
        return json({ catalogo: filas });
      }
      if (!esDueno(yo)) return err("Solo el administrador modifica el catálogo.", 403);
      if (metodo === "POST") {
        const clave = limpio(cuerpo.clave, 40)?.toUpperCase();
        const descripcion = limpio(cuerpo.descripcion, 300);
        if (!clave || !descripcion) return err("Clave y descripción son obligatorias.");
        const existe = await db.sql`SELECT id FROM catalogo WHERE clave = ${clave}`;
        if (existe.length) return err("Ya existe un concepto con esa clave.", 409);
        const [it] = await db.sql`
          INSERT INTO catalogo (clave, categoria, linea, descripcion, unidad, precio, controla_inventario, existencia, minimo)
          VALUES (${clave}, ${limpio(cuerpo.categoria, 40) || "servicio"},
                  ${limpio(cuerpo.linea, 20) || "fotovoltaico"}, ${descripcion},
                  ${limpio(cuerpo.unidad, 12) || "PZA"}, ${num(cuerpo.precio)},
                  ${!!cuerpo.controla_inventario}, ${num(cuerpo.existencia)}, ${num(cuerpo.minimo)})
          RETURNING *`;
        return json({ item: it }, 201);
      }
      if (metodo === "PATCH") {
        await db.sql`
          UPDATE catalogo SET
            descripcion         = COALESCE(${limpio(cuerpo.descripcion, 300)}, descripcion),
            categoria           = COALESCE(${limpio(cuerpo.categoria, 40)}, categoria),
            linea               = COALESCE(${limpio(cuerpo.linea, 20)}, linea),
            unidad              = COALESCE(${limpio(cuerpo.unidad, 12)}, unidad),
            precio              = COALESCE(${cuerpo.precio === undefined ? null : num(cuerpo.precio)}, precio),
            minimo              = COALESCE(${cuerpo.minimo === undefined ? null : num(cuerpo.minimo)}, minimo),
            controla_inventario = COALESCE(${typeof cuerpo.controla_inventario === "boolean" ? cuerpo.controla_inventario : null}, controla_inventario),
            activo              = COALESCE(${typeof cuerpo.activo === "boolean" ? cuerpo.activo : null}, activo),
            actualizado_en      = NOW()
          WHERE id = ${num(cuerpo.id)}`;
        return json({ ok: true });
      }
      if (metodo === "DELETE") {
        await db.sql`DELETE FROM catalogo WHERE id = ${num(url.searchParams.get("id"))}`;
        return json({ ok: true });
      }
    }

    if (ruta === "inventario/movimiento" && metodo === "POST") {
      const itemId = num(cuerpo.item_id);
      const cantidad = Math.abs(num(cuerpo.cantidad));
      const tipo = ["entrada", "salida", "ajuste"].includes(cuerpo.tipo) ? cuerpo.tipo : null;
      if (!itemId || !tipo || cantidad <= 0) return err("Datos del movimiento incompletos.");
      const [it] = await db.sql`SELECT * FROM catalogo WHERE id = ${itemId}`;
      if (!it) return err("Concepto no encontrado.", 404);
      const actual = Number(it.existencia);
      const saldo = tipo === "entrada" ? actual + cantidad : tipo === "salida" ? actual - cantidad : cantidad;
      if (saldo < 0) return err(`Existencia insuficiente: solo hay ${actual} ${it.unidad}.`);
      await db.sql`UPDATE catalogo SET existencia = ${saldo}, actualizado_en = NOW() WHERE id = ${itemId}`;
      await db.sql`
        INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, cliente_id, fecha_entrega)
        VALUES (${itemId}, ${tipo}, ${cantidad}, ${saldo}, ${limpio(cuerpo.motivo, 200)}, ${yo.id},
                ${num(cuerpo.cliente_id) || null}, ${limpio(cuerpo.fecha_entrega, 20)}::date)`;
      return json({ ok: true, saldo });
    }

    if (ruta === "inventario/movimientos" && metodo === "GET") {
      const filas = await db.sql`
        SELECT m.*, c.clave, c.descripcion, c.unidad, u.nombre AS usuario, cl.nombre AS cliente
        FROM movimientos m
        JOIN catalogo c ON c.id = m.item_id
        LEFT JOIN usuarios u ON u.id = m.usuario_id
        LEFT JOIN clientes cl ON cl.id = m.cliente_id
        ORDER BY m.fecha DESC LIMIT 200`;
      return json({ movimientos: filas });
    }


    /* ============ PARÁMETROS DEL COTIZADOR RÁPIDO ============ */
    if (ruta === "config") {
      if (metodo === "GET") {
        const filas = await db.sql`SELECT clave, valor FROM config`;
        return json({ config: Object.fromEntries(filas.map((f) => [f.clave, f.valor])) });
      }
      if (!esDueno(yo)) return err("Solo el administrador cambia estos parámetros.", 403);
      if (metodo === "PATCH") {
        const clave = limpio(cuerpo.clave, 60);
        if (!clave) return err("Falta la clave de configuración.");
        await db.sql`
          INSERT INTO config (clave, valor) VALUES (${clave}, ${JSON.stringify(cuerpo.valor || {})}::jsonb)
          ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()`;
        return json({ ok: true });
      }
    }

    /* ============ BITÁCORA DE SEGUIMIENTO ============ */
    if (ruta.startsWith("seguimiento/")) {
      const cotId = num(ruta.split("/")[1]);
      const [c] = await db.sql`SELECT vendedor_id FROM cotizaciones WHERE id = ${cotId}`;
      if (!c) return err("Cotización no encontrada.", 404);
      if (!esDueno(yo) && c.vendedor_id !== yo.id) return err("Sin acceso a esta cotización.", 403);
      if (metodo === "GET") {
        const filas = await db.sql`
          SELECT s.*, u.nombre AS usuario FROM seguimiento s
          LEFT JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.cotizacion_id = ${cotId} ORDER BY s.fecha DESC`;
        return json({ seguimiento: filas });
      }
      if (metodo === "POST") {
        const nota = limpio(cuerpo.nota, 1000);
        if (!nota) return err("Escribe una nota de seguimiento.");
        await db.sql`
          INSERT INTO seguimiento (cotizacion_id, usuario_id, estatus, nota)
          VALUES (${cotId}, ${yo.id}, ${limpio(cuerpo.estatus, 20)}, ${nota})`;
        if (cuerpo.estatus)
          await db.sql`UPDATE cotizaciones SET estatus = ${limpio(cuerpo.estatus, 20)}, actualizado_en = NOW() WHERE id = ${cotId}`;
        return json({ ok: true }, 201);
      }
    }

    /* ============ COTIZACIONES ============ */
    if (ruta === "cotizaciones") {
      if (metodo === "GET") {
        const filas = esDueno(yo)
          ? await db.sql`
              SELECT c.id, c.folio, c.estatus, c.total, c.linea, c.tipo, c.creado_en, c.actualizado_en,
                     cl.nombre AS cliente, u.nombre AS vendedor
              FROM cotizaciones c
              LEFT JOIN clientes cl ON cl.id = c.cliente_id
              LEFT JOIN usuarios u ON u.id = c.vendedor_id
              ORDER BY c.creado_en DESC LIMIT 300`
          : await db.sql`
              SELECT c.id, c.folio, c.estatus, c.total, c.linea, c.tipo, c.creado_en, c.actualizado_en,
                     cl.nombre AS cliente
              FROM cotizaciones c
              LEFT JOIN clientes cl ON cl.id = c.cliente_id
              WHERE c.vendedor_id = ${yo.id}
              ORDER BY c.creado_en DESC LIMIT 300`;
        return json({ cotizaciones: filas.map((f) => ({ ...f, vendedor: f.vendedor ?? yo.nombre })) });
      }
      if (metodo === "POST") {
        const partidas = Array.isArray(cuerpo.partidas) ? cuerpo.partidas : [];
        const [c] = await db.sql`
          INSERT INTO cotizaciones (folio, cliente_id, vendedor_id, estatus, linea, tipo, tecnico, partidas, ahorro, comentarios, total)
          VALUES (${await siguienteFolio()}, ${num(cuerpo.cliente_id) || null}, ${yo.id},
                  ${limpio(cuerpo.estatus, 20) || "borrador"},
                  ${limpio(cuerpo.linea, 20) || "fotovoltaico"}, ${limpio(cuerpo.tipo, 10) || "formal"},
                  ${JSON.stringify(cuerpo.tecnico || {})}::jsonb,
                  ${JSON.stringify(partidas)}::jsonb,
                  ${JSON.stringify(cuerpo.ahorro || {})}::jsonb,
                  ${limpio(cuerpo.comentarios, 2000)}, ${totalDePartidas(partidas)})
          RETURNING *`;
        return json({ cotizacion: c }, 201);
      }
      if (metodo === "PATCH") {
        const id = num(cuerpo.id);
        const [c] = await db.sql`SELECT * FROM cotizaciones WHERE id = ${id}`;
        if (!c) return err("Cotización no encontrada.", 404);
        if (!esDueno(yo) && c.vendedor_id !== yo.id) return err("No puedes editar esta cotización.", 403);
        const partidas = Array.isArray(cuerpo.partidas) ? cuerpo.partidas : c.partidas;
        await db.sql`
          UPDATE cotizaciones SET
            cliente_id     = COALESCE(${num(cuerpo.cliente_id) || null}, cliente_id),
            estatus        = COALESCE(${limpio(cuerpo.estatus, 20)}, estatus),
            tecnico        = COALESCE(${cuerpo.tecnico ? JSON.stringify(cuerpo.tecnico) : null}::jsonb, tecnico),
            partidas       = ${JSON.stringify(partidas)}::jsonb,
            ahorro         = COALESCE(${cuerpo.ahorro ? JSON.stringify(cuerpo.ahorro) : null}::jsonb, ahorro),
            comentarios    = COALESCE(${limpio(cuerpo.comentarios, 2000)}, comentarios),
            total          = ${totalDePartidas(partidas)},
            actualizado_en = NOW()
          WHERE id = ${id}`;
        return json({ ok: true });
      }
      if (metodo === "DELETE") {
        const id = num(url.searchParams.get("id"));
        const [c] = await db.sql`SELECT vendedor_id FROM cotizaciones WHERE id = ${id}`;
        if (!c) return err("Cotización no encontrada.", 404);
        if (!esDueno(yo) && c.vendedor_id !== yo.id) return err("No puedes borrar esta cotización.", 403);
        await db.sql`DELETE FROM cotizaciones WHERE id = ${id}`;
        return json({ ok: true });
      }
    }

    if (ruta.startsWith("cotizacion/") && metodo === "GET") {
      const id = num(ruta.split("/")[1]);
      const [c] = await db.sql`
        SELECT c.*, cl.nombre AS cliente_nombre, cl.direccion AS cliente_direccion,
               cl.referencia AS cliente_referencia, cl.contacto AS cliente_contacto,
               cl.telefono AS cliente_telefono, cl.correo AS cliente_correo,
               u.nombre AS vendedor_nombre, u.correo AS vendedor_correo, u.telefono AS vendedor_telefono
        FROM cotizaciones c
        LEFT JOIN clientes cl ON cl.id = c.cliente_id
        LEFT JOIN usuarios u ON u.id = c.vendedor_id
        WHERE c.id = ${id}`;
      if (!c) return err("Cotización no encontrada.", 404);
      if (!esDueno(yo) && c.vendedor_id !== yo.id) return err("No tienes acceso a esta cotización.", 403);
      return json({ cotizacion: c });
    }

    /* ============ PANEL ============ */
    if (ruta === "panel" && metodo === "GET") {
      const resumen = esDueno(yo)
        ? await db.sql`
            SELECT estatus, COUNT(*)::int AS n, COALESCE(SUM(total),0)::float AS monto
            FROM cotizaciones GROUP BY estatus`
        : await db.sql`
            SELECT estatus, COUNT(*)::int AS n, COALESCE(SUM(total),0)::float AS monto
            FROM cotizaciones WHERE vendedor_id = ${yo.id} GROUP BY estatus`;
      const bajoMinimo = esDueno(yo)
        ? await db.sql`SELECT clave, descripcion, existencia, minimo, unidad FROM catalogo
                       WHERE controla_inventario AND existencia <= minimo ORDER BY clave`
        : [];
      const porVendedor = esDueno(yo)
        ? await db.sql`
            SELECT u.nombre, COUNT(c.id)::int AS n, COALESCE(SUM(c.total),0)::float AS monto,
                   COALESCE(SUM(CASE WHEN c.estatus='ganada' THEN c.total ELSE 0 END),0)::float AS ganado
            FROM usuarios u LEFT JOIN cotizaciones c ON c.vendedor_id = u.id
            WHERE u.activo GROUP BY u.id, u.nombre ORDER BY monto DESC`
        : [];
      return json({ resumen, bajoMinimo, porVendedor });
    }

    return err("Ruta no encontrada.", 404);
  } catch (e) {
    console.error("API error:", e);
    return err("Error del servidor: " + (e?.message || "desconocido"), 500);
  }
};
