import {
  db, json, err, hashPassword, verifyPassword, signToken,
  sesion, esDueno, num, limpio, siguienteFolio, totalDePartidas, fotoValida,
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


    if (ruta === "cambiar-correo" && metodo === "POST") {
      const nuevo = limpio(cuerpo.correo, 120)?.toLowerCase();
      if (!nuevo || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nuevo))
        return err("Escribe un correo válido.");
      const [u] = await db.sql`SELECT password_hash FROM usuarios WHERE id = ${yo.id}`;
      if (!verifyPassword(cuerpo.password || "", u.password_hash))
        return err("La contraseña no es correcta.", 403);
      const ocupado = await db.sql`SELECT id FROM usuarios WHERE correo = ${nuevo} AND id <> ${yo.id}`;
      if (ocupado.length) return err("Ese correo ya lo usa otra cuenta.", 409);
      await db.sql`UPDATE usuarios SET correo = ${nuevo} WHERE id = ${yo.id}`;
      return json({ ok: true, correo: nuevo });
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
        const correoNuevo = limpio(cuerpo.correo, 120)?.toLowerCase();
        if (correoNuevo) {
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correoNuevo))
            return err("Escribe un correo válido.");
          const ocupado = await db.sql`SELECT id FROM usuarios WHERE correo = ${correoNuevo} AND id <> ${id}`;
          if (ocupado.length) return err("Ese correo ya lo usa otra cuenta.", 409);
          await db.sql`UPDATE usuarios SET correo = ${correoNuevo} WHERE id = ${id}`;
        }
        await db.sql`
          UPDATE usuarios SET
            nombre   = COALESCE(${limpio(cuerpo.nombre, 120)}, nombre),
            telefono = COALESCE(${limpio(cuerpo.telefono, 40)}, telefono),
            activo   = COALESCE(${typeof cuerpo.activo === "boolean" ? cuerpo.activo : null}, activo)
          WHERE id = ${id}`;
        return json({ ok: true });
      }
      if (metodo === "DELETE") {
        const id = num(url.searchParams.get("id"));
        const transferir = num(url.searchParams.get("transferir"));
        if (!id) return err("Falta indicar el vendedor.");
        if (id === yo.id) return err("No puedes eliminar tu propia cuenta.");

        const [u] = await db.sql`SELECT id, nombre, rol FROM usuarios WHERE id = ${id}`;
        if (!u) return err("Ese vendedor ya no existe.", 404);

        if (u.rol === "owner") {
          const [q] = await db.sql`SELECT COUNT(*)::int AS n FROM usuarios WHERE rol = 'owner' AND activo`;
          if ((q?.n || 0) <= 1)
            return err("No puedes eliminar al único administrador. Nombra otro administrador primero.");
        }

        if (transferir) {
          if (transferir === id) return err("No puedes transferir el trabajo a la misma cuenta.");
          const [destino] = await db.sql`SELECT id FROM usuarios WHERE id = ${transferir}`;
          if (!destino) return err("La cuenta a la que quieres transferir no existe.", 404);
          await db.sql`UPDATE cotizaciones SET vendedor_id = ${transferir} WHERE vendedor_id = ${id}`;
          await db.sql`UPDATE clientes     SET creado_por  = ${transferir} WHERE creado_por  = ${id}`;
        }

        await db.sql`DELETE FROM usuarios WHERE id = ${id}`;
        return json({ ok: true, mensaje: transferir
          ? `${u.nombre} fue eliminado y su trabajo quedó a nombre de otra cuenta.`
          : `${u.nombre} fue eliminado.` });
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
          INSERT INTO cotizaciones (folio, cliente_id, vendedor_id, estatus, linea, tipo, tecnico, partidas, ahorro, recibo, recibo_foto, comentarios, total)
          VALUES (${await siguienteFolio()}, ${num(cuerpo.cliente_id) || null}, ${yo.id},
                  ${limpio(cuerpo.estatus, 20) || "borrador"},
                  ${limpio(cuerpo.linea, 20) || "fotovoltaico"}, ${limpio(cuerpo.tipo, 10) || "formal"},
                  ${JSON.stringify(cuerpo.tecnico || {})}::jsonb,
                  ${JSON.stringify(partidas)}::jsonb,
                  ${JSON.stringify(cuerpo.ahorro || {})}::jsonb,
                  ${JSON.stringify(cuerpo.recibo || {})}::jsonb,
                  ${fotoValida(cuerpo.recibo_foto)},
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
            recibo         = COALESCE(${cuerpo.recibo ? JSON.stringify(cuerpo.recibo) : null}::jsonb, recibo),
            recibo_foto    = CASE WHEN ${cuerpo.recibo_foto === "" ? true : false} THEN NULL
                                  ELSE COALESCE(${fotoValida(cuerpo.recibo_foto)}, recibo_foto) END,
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


    /* ============ DATOS DE EJEMPLO (solo dueño) ============ */
    if (ruta === "demo" && metodo === "POST") {
      if (!esDueno(yo)) return err("Solo el administrador puede cargar datos de ejemplo.", 403);

      if (cuerpo.accion === "borrar") {
        await db.sql`DELETE FROM cotizaciones WHERE demo`;
        await db.sql`DELETE FROM movimientos  WHERE demo`;
        await db.sql`DELETE FROM clientes     WHERE demo`;
        return json({ ok: true, mensaje: "Datos de ejemplo eliminados." });
      }

      const [ya] = await db.sql`SELECT COUNT(*)::int AS n FROM clientes WHERE demo`;
      if ((ya?.n || 0) > 0) return err("Los datos de ejemplo ya están cargados.", 409);

      const CLIENTES = [
        ["DIST. DE CARNES FRÍAS ATLICPAC", "Ing. Ramírez", "5544120088", "compras@atlicpac.mx", "Los Reyes La Paz, Edo. Méx.", "513150303467"],
        ["PLÁSTICOS ALICA, S.A. DE C.V.",   "Lic. Fuentes", "5533914455", "compras@alica.com.mx", "Tlalnepantla, Edo. Méx.", "147911202086"],
        ["MEXICANA DE EMPAQUES ROHOVI",     "C.P. Vargas",  "5588220134", "admin@rohovi.mx",      "Iztapalapa, CDMX",        "513250503544"],
        ["INTERALUM",                       "Rafael Chiang","9982114477", "compras@interalum.com","Cancún, Q. Roo",          null],
        ["HOTEL HYDE",                      "Arq. Beltrán", "5512009988", "mantenimiento@hyde.mx","Polanco, CDMX",           "228140100722"],
        ["LOBATO JUÁREZ LUCÍA",             null,           "5599881100", null,                   "Nezahualcóyotl, Edo. Méx.","D741860"],
      ];
      const ids = [];
      for (const [nombre, contacto, tel, correo, dir, ref] of CLIENTES) {
        const [c] = await db.sql`
          INSERT INTO clientes (nombre, contacto, telefono, correo, direccion, referencia, notas, creado_por, demo)
          VALUES (${nombre}, ${contacto}, ${tel}, ${correo}, ${dir}, ${ref},
                  'Cliente de ejemplo para demostración.', ${yo.id}, TRUE)
          RETURNING id`;
        ids.push(c.id);
      }

      const anio = new Date().getFullYear();
      const [r] = await db.sql`SELECT COUNT(*)::int AS n FROM cotizaciones`;
      let consecutivo = (r?.n || 0);
      const folio = () => `MC-${anio}-${String(++consecutivo).padStart(4, "0")}`;

      const COTS = [
        { cli: 0, linea: "fotovoltaico", tipo: "rapida", estatus: "negociacion",
          partidas: [{ clave: "SISTEMA-FV", descripcion: "Sistema fotovoltaico interconectado · 300 módulos de 710 W · 213.00 kWp", unidad: "MOD", cantidad: 300, precio: 12500 }],
          tecnico: { kwp: "213.00", paneles: "300", wpanel: "710", produccion: "57254", tension: "440", marcainversor: "Sungrow" },
          ahorro: { actual: 294252, nuevo: 206000, roi: 4.3, anual: 1059450 } },

        { cli: 1, linea: "fotovoltaico", tipo: "formal", estatus: "enviada",
          partidas: [
            { clave: "PANEL",    descripcion: "Panel fotovoltaico 710 W TIER-1",           unidad: "PZA",  cantidad: 420, precio: 4200 },
            { clave: "INVERSOR", descripcion: "Inversor Sungrow 110 kW · 440 V",            unidad: "PZA",  cantidad: 3,   precio: 138000 },
            { clave: "ESTRUCT",  descripcion: "Estructura de aluminio anodizado en cubierta",unidad: "PZA", cantidad: 420, precio: 950 },
            { clave: "MATELEC",  descripcion: "Material eléctrico y fotovoltaico",           unidad: "kWp", cantidad: 298, precio: 1800 },
            { clave: "MANOBRA",  descripcion: "Mano de obra calificada y certificada",       unidad: "kWp", cantidad: 298, precio: 2600 }],
          tecnico: { kwp: "298.20", paneles: "420", wpanel: "710", produccion: "80155", tension: "440", marcainversor: "Sungrow", cubierta: "Lámina", ubicacion: "Tlalnepantla, Edo. Méx." },
          ahorro: { actual: 747489, nuevo: 512000, roi: 5.1, anual: 2825868 } },

        { cli: 2, linea: "fotovoltaico", tipo: "formal", estatus: "ganada",
          partidas: [
            { clave: "PANEL",    descripcion: "Panel fotovoltaico 725 W TIER-1",  unidad: "PZA", cantidad: 957, precio: 4200 },
            { clave: "INVERSOR", descripcion: "Inversor Huawei 125 kW · 440 V",   unidad: "PZA", cantidad: 6,   precio: 142000 },
            { clave: "ESTRUCT",  descripcion: "Estructura de aluminio anodizado", unidad: "PZA", cantidad: 957, precio: 950 },
            { clave: "MANOBRA",  descripcion: "Mano de obra e ingeniería",        unidad: "kWp", cantidad: 693, precio: 2600 }],
          tecnico: { kwp: "693.83", paneles: "957", wpanel: "725", produccion: "186500", tension: "440", marcainversor: "Huawei", cubierta: "Lámina" },
          ahorro: { actual: 372342, nuevo: 74000, roi: 4.8, anual: 3580104 } },

        { cli: 3, linea: "perfiles", tipo: "rapida", estatus: "ganada",
          partidas: [
            { clave: "001",     descripcion: "RIEL MINI · AL6005-T5 anodizado · 380 mm",     unidad: "PZA", cantidad: 1200, precio: 185 },
            { clave: "ABZ-INT", descripcion: "Abrazadera intermedia M8x50 · aluminio",       unidad: "PZA", cantidad: 2400, precio: 42 },
            { clave: "PER-T8",  descripcion: "Perno T M8 con tuerca de brida",               unidad: "PZA", cantidad: 2400, precio: 18 },
            { clave: "EPDM",    descripcion: "Empaque EPDM 90x70 mm",                        unidad: "PZA", cantidad: 2400, precio: 12 }] },

        { cli: 4, linea: "electrico", tipo: "rapida", estatus: "enviada",
          partidas: [
            { clave: "MANTTO",   descripcion: "Mantenimiento preventivo FV", unidad: "SERV", cantidad: 2, precio: 4500 },
            { clave: "LIMPIEZA", descripcion: "Limpieza profesional de paneles", unidad: "SERV", cantidad: 2, precio: 3800 }] },

        { cli: 5, linea: "fotovoltaico", tipo: "rapida", estatus: "perdida",
          partidas: [{ clave: "SISTEMA-FV", descripcion: "Sistema fotovoltaico residencial · 9 módulos de 625 W · 5.63 kWp", unidad: "MOD", cantidad: 9, precio: 11500 }],
          tecnico: { kwp: "5.63", paneles: "9", wpanel: "625", produccion: "1512", tension: "220", marcainversor: "Solis" },
          ahorro: { actual: 2584, nuevo: 420, roi: 4.0, anual: 25968 } },

        { cli: 0, linea: "perfiles", tipo: "rapida", estatus: "borrador",
          partidas: [
            { clave: "002",     descripcion: "RIEL CORTO MINI · AL6005-T5 anodizado · 190 mm", unidad: "PZA", cantidad: 600, precio: 110 },
            { clave: "ABZ-FIN", descripcion: "Abrazadera final ajustable 30/35/40 mm",         unidad: "PZA", cantidad: 240, precio: 46 }] },
      ];

      const creadas = [];
      for (const c of COTS) {
        const total = c.partidas.reduce((a, p) => a + p.cantidad * p.precio, 0);
        const [nueva] = await db.sql`
          INSERT INTO cotizaciones (folio, cliente_id, vendedor_id, estatus, linea, tipo,
                                    tecnico, partidas, ahorro, comentarios, total, demo)
          VALUES (${folio()}, ${ids[c.cli]}, ${yo.id}, ${c.estatus}, ${c.linea}, ${c.tipo},
                  ${JSON.stringify(c.tecnico || {})}::jsonb,
                  ${JSON.stringify(c.partidas)}::jsonb,
                  ${JSON.stringify(c.ahorro || {})}::jsonb,
                  'Cotización de ejemplo para demostración.', ${total}, TRUE)
          RETURNING id`;
        creadas.push(nueva.id);
      }

      const NOTAS = [
        [0, "negociacion", "Visita técnica realizada. El techo solo admite 300 módulos de los 1,002 que pide el cálculo."],
        [0, null,          "Enviada la propuesta ajustada. Quedaron de contestar el viernes."],
        [1, "enviada",     "Se envió por correo a compras. Pidieron desglose de estructura."],
        [2, "ganada",      "Firmaron contrato. Anticipo depositado."],
        [5, "perdida",     "Se fue con otro proveedor por precio. Diferencia de 8%."],
      ];
      for (const [i, estatus, nota] of NOTAS) {
        await db.sql`
          INSERT INTO seguimiento (cotizacion_id, usuario_id, estatus, nota)
          VALUES (${creadas[i]}, ${yo.id}, ${estatus}, ${nota})`;
      }

      const MOVS = [
        ["001",     "entrada", 2000, "Producción recibida del proveedor"],
        ["001",     "salida",   800, "Obra Rohovi"],
        ["ABZ-INT", "entrada", 3000, "Compra a proveedor"],
        ["ABZ-INT", "salida",  2400, "Obra Interalum"],
        ["002",     "entrada",  900, "Producción recibida"],
        ["EPDM",    "entrada", 5000, "Compra a proveedor"],
        ["EPDM",    "salida",  2400, "Obra Interalum"],
      ];
      for (const [clave, tipo, cant, motivo] of MOVS) {
        const [it] = await db.sql`SELECT id, existencia FROM catalogo WHERE clave = ${clave}`;
        if (!it) continue;
        const saldo = tipo === "entrada"
          ? Number(it.existencia) + cant
          : Math.max(0, Number(it.existencia) - cant);
        await db.sql`UPDATE catalogo SET existencia = ${saldo}, actualizado_en = NOW() WHERE id = ${it.id}`;
        await db.sql`
          INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, demo)
          VALUES (${it.id}, ${tipo}, ${cant}, ${saldo}, ${motivo}, ${yo.id}, TRUE)`;
      }

      return json({ ok: true, mensaje: `Se cargaron ${CLIENTES.length} clientes y ${COTS.length} cotizaciones de ejemplo.` });
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
