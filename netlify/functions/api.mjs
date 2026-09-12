import {
  db, json, err, hashPassword, verifyPassword, signToken, problemaDeLlave,
  sesion, esDueno, esAlmacen, esVendedor, mueveAlmacen, ROLES,
  num, limpio, siguienteFolio, ultimoFolio, conFolio, siguienteFolioVale,
  totalDePartidas, fotoValida, firmaValida, claveNombre, claveRpu,
} from "../lib/core.mjs";

/* Busca un cliente que ya exista con el mismo nombre (sin acentos ni signos) o
   con el mismo número de servicio. La comparación se hace en la aplicación y no
   en la consulta, porque la lista de clientes es chica y así se aprovecha la
   misma normalización que usa el buscador. */
/* ¿Este sitio es el de demostración?
   Se enciende con la variable MODO_DEMO = 1 en la configuración de Netlify,
   NO en el código ni en la base de datos. Así el mismo código sirve para el
   sitio de trabajo de Marcelestial y para el de demostración, y el sitio de
   trabajo no puede volverse demostración por accidente. */
const esDemostracion = () => String(process.env.MODO_DEMO || "") === "1";

/* Texto listo para comparar: sin acentos y en minúsculas, igual que hace la
   app en el teléfono, para que buscar «plasticos» encuentre «PLÁSTICOS». */
/* Los datos del techo que marcó el vendedor: cuatro esquinas dentro de la
   foto, las medidas en metros y el acomodo. Se revisa aquí para que no entre
   basura a la base ni números absurdos que luego rompan el dibujo. */
const TOPE_AREAS = 4;

/* Una superficie plana del techo: sus cuatro esquinas dentro de la foto, sus
   medidas en metros y el acomodo. Un techo a dos aguas trae dos de éstas. */
function areaValida(v) {
  if (!v || typeof v !== "object") return null;
  const e = Array.isArray(v.esquinas) ? v.esquinas : [];
  if (e.length !== 4) return null;
  const puntos = e.map((p) => [Number(p[0]), Number(p[1])]);
  if (puntos.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  const entre = (x, min, max) => Number.isFinite(x) && x >= min && x <= max;
  const ancho = Number(v.ancho_m), fondo = Number(v.fondo_m);
  const filas = Math.round(Number(v.filas)), columnas = Math.round(Number(v.columnas));
  if (!entre(ancho, 1, 500) || !entre(fondo, 1, 500)) return null;
  if (!entre(filas, 1, 60) || !entre(columnas, 1, 60)) return null;
  /* Los módulos que el vendedor fijó a mano para esta área. Cero = automático. */
  const paneles = Math.round(Number(v.paneles));
  /* El acomodo a mano: cuánto se corrió el arreglo dentro del área y qué
     casillas se quitaron porque ahí hay un domo, un extractor o una tubería.
     Se limita a lo que puede caber para que no entre basura al dibujo. */
  const corr = (x) => (Number.isFinite(Number(x)) && Math.abs(Number(x)) <= 500 ? Number(x) : 0);
  const quitados = (Array.isArray(v.quitados) ? v.quitados : [])
    .filter((k) => typeof k === "string" && /^\d{1,3},\d{1,3}$/.test(k))
    .slice(0, 3600);
  return {
    esquinas: puntos, ancho_m: ancho, fondo_m: fondo, filas, columnas,
    giro: v.giro === true,
    paneles: entre(paneles, 1, 3000) ? paneles : 0,
    mano: v.mano === true,
    off_x: corr(v.off_x), off_y: corr(v.off_y),
    quitados: [...new Set(quitados)],
  };
}

function sitioValido(v) {
  if (!v || typeof v !== "object") return null;
  /* Se acepta la forma vieja —un área suelta— y la nueva, con lista de áreas. */
  const crudas = Array.isArray(v.areas) && v.areas.length ? v.areas : [v];
  if (crudas.length > TOPE_AREAS) return null;
  const areas = crudas.map(areaValida);
  if (!areas.length || areas.some((a) => a === null)) return null;
  /* De dónde salió la imagen: de un dron o de una captura de Google Maps.
     Con satélite el montaje deja libre la franja del crédito de Google. */
  const fuente = v.fuente === "satelite" ? "satelite" : "dron";
  return JSON.stringify({
    areas, fuente,
    ancho_foto: Number(v.ancho_foto) || 0, alto_foto: Number(v.alto_foto) || 0,
  });
}

const sinAcentos = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const soloAlfaNum = (v) => String(v || "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase();

/* Precios del sitio de demostración. Deliberadamente distintos de los de
   Marcelestial: cifras redondas de referencia del mercado. Nunca copiar aquí
   la tabla real de nadie. */
const CATALOGO_DEMO = {
  "001": 85, "002": 55, "ABZ-INT": 38, "ABZ-FIN": 42, "PER-T8": 12,
  "EPDM": 9, "TOR-25": 6, "TOR-75": 11,
  PANEL: 4200, INVERSOR: 32000, ESTRUCT: 45000, MATELEC: 38000,
  MANOBRA: 60000, GESTCFE: 18000, LIMPIEZA: 3500, MANTTO: 6500,
};

const TARIFAS_DEMO = [
  { clave: "GDMTH", nombre: "GDMTH · Gran demanda en media tensión horaria",
    grupo: "media", horaria: true, uvie: true, gestion: true, tensiones: ["220", "440"],
    escalones: [
      { tension: "220", hasta: 99, precio: 14000 }, { tension: "220", hasta: 1000, precio: 13500 },
      { tension: "440", hasta: 99, precio: 13500 }, { tension: "440", hasta: 1000, precio: 13000 }] },
  { clave: "GDMTO", nombre: "GDMTO · Gran demanda en media tensión ordinaria",
    grupo: "media", horaria: false, uvie: true, gestion: true, tensiones: ["220", "440"],
    escalones: [
      { tension: "220", hasta: 99, precio: 14000 }, { tension: "220", hasta: 1000, precio: 13500 },
      { tension: "440", hasta: 99, precio: 13500 }, { tension: "440", hasta: 1000, precio: 13000 }] },
  { clave: "01", nombre: "Tarifa 01 · Casa",
    grupo: "domestica", horaria: false, uvie: false, gestion: false, tensiones: ["127", "220"],
    escalones: [{ tension: "*", hasta: 99999, precio: 15000 }] },
  { clave: "02", nombre: "Tarifa 02 · Negocio",
    grupo: "domestica", horaria: false, uvie: false, gestion: false, tensiones: ["127", "220"],
    escalones: [{ tension: "*", hasta: 99999, precio: 15000 }] },
];

async function clienteRepetido(nombre, referencia, excluirId = 0) {
  const clave = claveNombre(nombre);
  const rpu = claveRpu(referencia);
  if (!clave && !rpu) return null;
  const filas = await db.sql`SELECT id, nombre, referencia, creado_por FROM clientes`;
  return filas.find((c) =>
    c.id !== excluirId &&
    ((clave && claveNombre(c.nombre) === clave) ||
     (rpu && rpu.length >= 5 && claveRpu(c.referencia) === rpu))) || null;
}

/* Mapa clave → concepto, para casar las partidas de una cotización con el
   catálogo de inventario. */
const porClaveInv = (filas) => filas.map((i) => [String(i.clave).toUpperCase(), i]);

/* Un vale con sus renglones, su cliente, su cotización y quién lo capturó:
   lo que la app pinta en la ficha y en el documento imprimible. */
async function valeCompleto(id) {
  const [v] = await db.sql`
    SELECT v.*, v.fecha::text AS fecha, cl.nombre AS cliente, cl.telefono AS cliente_telefono, cl.direccion AS cliente_direccion,
           cl.contacto AS cliente_contacto,
           q.folio AS cotizacion, q.tecnico->>'ubicacion' AS cotizacion_ubicacion,
           u.nombre AS capturo, cu.nombre AS cancelo, o.folio AS vale_origen
      FROM vales v
      LEFT JOIN clientes cl ON cl.id = v.cliente_id
      LEFT JOIN cotizaciones q ON q.id = v.cotizacion_id
      LEFT JOIN usuarios u ON u.id = v.usuario_id
      LEFT JOIN usuarios cu ON cu.id = v.cancelado_por
      LEFT JOIN vales o ON o.id = v.vale_origen_id
     WHERE v.id = ${id}`;
  if (!v) return null;
  /* Sólo los renglones del vale en sí, no los de su cancelación (que también
     apuntan al vale, pero con el tipo contrario). */
  const partidas = await db.sql`
    SELECT m.id, m.item_id, m.tipo, m.cantidad, m.saldo, c.clave, c.descripcion, c.unidad
      FROM movimientos m JOIN catalogo c ON c.id = m.item_id
     WHERE m.vale_id = ${id} AND m.tipo = ${v.tipo}
     ORDER BY CASE c.categoria WHEN 'perfil' THEN 0 ELSE 1 END, c.clave`;
  return { ...v, partidas };
}

export const config = { path: "/api/*" };

export default async (req) => {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const metodo = req.method.toUpperCase();
  /* Tope al tamaño de la petición. Cada foto ya viene limitada a 4 MB por
     separado (fotoValida), pero una cotización lleva tres —recibo, dron y
     equipo— y nada impedía mandar un cuerpo de decenas de megas para inflar
     la base o tumbar la función. 14 MB deja pasar el caso real más pesado. */
  const TOPE_CUERPO = 14 * 1024 * 1024;
  const largo = Number(req.headers.get("content-length") || 0);
  if (largo > TOPE_CUERPO)
    return err("El envío es demasiado grande. Vuelve a tomar las fotos con menos calidad.", 413);
  let cuerpo = {};
  if (["POST", "PATCH", "PUT"].includes(metodo)) {
    const texto = await req.text().catch(() => "");
    if (texto.length > TOPE_CUERPO)
      return err("El envío es demasiado grande. Vuelve a tomar las fotos con menos calidad.", 413);
    try { cuerpo = JSON.parse(texto || "{}"); } catch { cuerpo = {}; }
    if (cuerpo === null || typeof cuerpo !== "object" || Array.isArray(cuerpo)) cuerpo = {};
  }

  try {
    /* Sin llave de sesiones no se trabaja. Mejor un aviso claro que una app
       que parece funcionar con una llave que cualquiera conoce. */
    const sinLlave = problemaDeLlave();
    if (sinLlave) return err(sinLlave, 500);

    /* ============ ARRANQUE / SESIÓN ============ */
    if (ruta === "estado" && metodo === "GET") {
      const [r] = await db.sql`SELECT COUNT(*)::int AS n FROM usuarios`;
      return json({ instalado: (r?.n || 0) > 0, demo: esDemostracion() });
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
        RETURNING id, correo, nombre, rol, token_version`;
      return json({ token: signToken({ uid: u.id, tv: u.token_version }), usuario: u });
    }

    /* Freno a la fuerza bruta: 5 fallos seguidos bloquean la cuenta 15 minutos.
       El mensaje de credenciales incorrectas es el MISMO exista o no el correo,
       para no confirmarle a nadie qué cuentas están dadas de alta. */
    if (ruta === "login" && metodo === "POST") {
      const MAX_INTENTOS = 5, MINUTOS_BLOQUEO = 15;
      const correo = limpio(cuerpo.correo, 120)?.toLowerCase();
      const [u] = await db.sql`SELECT * FROM usuarios WHERE correo = ${correo} LIMIT 1`;

      if (u?.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
        const faltan = Math.max(1, Math.ceil((new Date(u.bloqueado_hasta) - new Date()) / 60000));
        return err(
          `Demasiados intentos fallidos. Vuelve a intentar en ${faltan} ` +
          `${faltan === 1 ? "minuto" : "minutos"}, o pídele al administrador que te cambie la contraseña.`,
          429
        );
      }

      if (!u || !u.activo || !verifyPassword(cuerpo.password || "", u.password_hash)) {
        if (u) {
          const fallos = Number(u.intentos_fallidos || 0) + 1;
          await db.sql`
            UPDATE usuarios SET
              intentos_fallidos = ${fallos},
              bloqueado_hasta   = ${fallos >= MAX_INTENTOS
                                     ? new Date(Date.now() + MINUTOS_BLOQUEO * 60000).toISOString()
                                     : null}
            WHERE id = ${u.id}`;
        }
        return err("Correo o contraseña incorrectos.", 401);
      }

      if (Number(u.intentos_fallidos) > 0 || u.bloqueado_hasta)
        await db.sql`UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ${u.id}`;

      return json({
        token: signToken({ uid: u.id, tv: u.token_version }),
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
      /* Cambiar la contraseña cierra las demás sesiones de esta cuenta: el
         teléfono perdido deja de servir. A quien la cambió se le devuelve un
         token nuevo para que no se le caiga la sesión donde está trabajando. */
      const [act] = await db.sql`
        UPDATE usuarios SET password_hash = ${hashPassword(nueva)},
                            intentos_fallidos = 0, bloqueado_hasta = NULL,
                            token_version = token_version + 1
        WHERE id = ${yo.id} RETURNING token_version`;
      return json({ ok: true, token: signToken({ uid: yo.id, tv: act.token_version }) });
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

    /* ============ USUARIOS (solo dueño) ============ */
    if (ruta === "usuarios") {
      if (!esDueno(yo)) return err("Solo el administrador puede gestionar usuarios.", 403);
      if (metodo === "GET") {
        const filas = await db.sql`
          SELECT u.id, u.correo, u.nombre, u.rol, u.telefono, u.activo, u.creado_en,
                 (SELECT COUNT(*)::int FROM cotizaciones c WHERE c.vendedor_id = u.id) AS cotizaciones,
                 (SELECT COUNT(*)::int FROM vales v WHERE v.usuario_id = u.id) AS vales
          FROM usuarios u
          ORDER BY CASE u.rol WHEN 'owner' THEN 0 WHEN 'vendedor' THEN 1 ELSE 2 END, u.nombre`;
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
        const rol = ROLES.includes(cuerpo.rol) ? cuerpo.rol : "vendedor";
        const [u] = await db.sql`
          INSERT INTO usuarios (correo, nombre, rol, telefono, password_hash)
          VALUES (${correo}, ${nombre}, ${rol},
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
          /* Cambiar la contraseña también levanta el bloqueo por intentos fallidos. */
          await db.sql`UPDATE usuarios SET password_hash = ${hashPassword(cuerpo.password)},
                                           intentos_fallidos = 0, bloqueado_hasta = NULL,
                                           token_version = token_version + 1 WHERE id = ${id}`;
        }
        /* Cambio de rol: ahora sí se puede promover o cambiar de puesto a una
           cuenta existente. El único candado: nunca quedarse sin administrador. */
        if (cuerpo.rol !== undefined) {
          if (!ROLES.includes(cuerpo.rol)) return err("Ese rol no existe.");
          const [act] = await db.sql`SELECT rol FROM usuarios WHERE id = ${id}`;
          if (!act) return err("Ese usuario ya no existe.", 404);
          if (act.rol === "owner" && cuerpo.rol !== "owner") {
            const [q] = await db.sql`SELECT COUNT(*)::int AS n FROM usuarios WHERE rol = 'owner' AND activo AND id <> ${id}`;
            if ((q?.n || 0) < 1) return err("No puedes quitarle el rol al único administrador. Nombra otro primero.");
          }
          await db.sql`UPDATE usuarios SET rol = ${cuerpo.rol},
                                           token_version = token_version + 1 WHERE id = ${id}`;
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
            activo   = COALESCE(${typeof cuerpo.activo === "boolean" ? cuerpo.activo : null}, activo),
            /* Dar de baja una cuenta cierra la sesión que traiga abierta. */
            token_version = token_version + ${cuerpo.activo === false ? 1 : 0}
          WHERE id = ${id}`;
        return json({ ok: true });
      }
      if (metodo === "DELETE") {
        const id = num(url.searchParams.get("id"));
        const transferir = num(url.searchParams.get("transferir"));
        if (!id) return err("Falta indicar el usuario.");
        if (id === yo.id) return err("No puedes eliminar tu propia cuenta.");

        const [u] = await db.sql`SELECT id, nombre, rol FROM usuarios WHERE id = ${id}`;
        if (!u) return err("Ese usuario ya no existe.", 404);

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

    /* ============ CLIENTES REPETIDOS (solo dueño) ============
       Los que se dieron de alta antes de que existiera el aviso de duplicados.
       Se agrupan por nombre y por número de servicio; el administrador decide
       cuál se queda y a ése se le pasan las cotizaciones de los demás. */
    if (ruta === "clientes/duplicados") {
      if (!esDueno(yo)) return err("Solo el administrador puede unir clientes repetidos.", 403);
      if (metodo !== "GET") return err("Método no permitido.", 405);

      const filas = await db.sql`
        SELECT c.id, c.nombre, c.contacto, c.telefono, c.correo, c.direccion,
               c.referencia, c.notas, c.creado_en, u.nombre AS creador,
               (SELECT COUNT(*)::int FROM cotizaciones q WHERE q.cliente_id = c.id) AS cotizaciones,
               (SELECT COUNT(*)::int FROM movimientos m WHERE m.cliente_id = c.id) AS movimientos
        FROM clientes c
        LEFT JOIN usuarios u ON u.id = c.creado_por
        ORDER BY c.creado_en, c.id`;

      /* Cada cliente empieza en su propio grupo; si dos comparten nombre o
         número de servicio, los grupos se juntan (así A-B por nombre y B-C
         por RPU terminan los tres en el mismo grupo). */
      const jefe = new Map(filas.map((c) => [c.id, c.id]));
      const raiz = (id) => { while (jefe.get(id) !== id) id = jefe.get(id); return id; };
      const unir = (a, b) => { const ra = raiz(a), rb = raiz(b); if (ra !== rb) jefe.set(rb, ra); };

      const porNombre = new Map(), porRpu = new Map();
      for (const c of filas) {
        const kn = claveNombre(c.nombre);
        if (kn) { if (porNombre.has(kn)) unir(porNombre.get(kn), c.id); else porNombre.set(kn, c.id); }
        const kr = claveRpu(c.referencia);
        if (kr && kr.length >= 5) { if (porRpu.has(kr)) unir(porRpu.get(kr), c.id); else porRpu.set(kr, c.id); }
      }

      const grupos = new Map();
      for (const c of filas) {
        const r = raiz(c.id);
        if (!grupos.has(r)) grupos.set(r, []);
        grupos.get(r).push(c);
      }

      const repetidos = [...grupos.values()]
        .filter((g) => g.length > 1)
        .map((g) => ({
          motivo: new Set(g.map((c) => claveNombre(c.nombre))).size === 1 ? "nombre" : "referencia",
          clientes: g.sort((a, b) =>
            (b.cotizaciones + b.movimientos) - (a.cotizaciones + a.movimientos) || a.id - b.id),
        }))
        .sort((a, b) => b.clientes.length - a.clientes.length);

      return json({ grupos: repetidos, total: filas.length });
    }

    if (ruta === "clientes/fusionar") {
      if (!esDueno(yo)) return err("Solo el administrador puede unir clientes repetidos.", 403);
      if (metodo !== "POST") return err("Método no permitido.", 405);

      const conservar = num(cuerpo.conservar);
      const quitar = (Array.isArray(cuerpo.quitar) ? cuerpo.quitar : [])
        .map(num).filter((n) => n > 0 && n !== conservar);
      if (!conservar || !quitar.length)
        return err("Elige cuál cliente se queda y cuáles se unen a él.");

      const [base] = await db.sql`SELECT * FROM clientes WHERE id = ${conservar}`;
      if (!base) return err("El cliente que quieres conservar ya no existe.", 404);

      let movidas = 0, movimientos = 0, borrados = 0;
      const relleno = { contacto: base.contacto, telefono: base.telefono, correo: base.correo,
                        direccion: base.direccion, referencia: base.referencia };
      const notas = [base.notas].filter(Boolean);

      for (const id of quitar) {
        const [otro] = await db.sql`SELECT * FROM clientes WHERE id = ${id}`;
        if (!otro) continue;

        /* Primero se mueve el trabajo y hasta el final se borra el registro:
           si algo falla a medio camino, no se pierde ninguna cotización. */
        const [q] = await db.sql`
          WITH m AS (UPDATE cotizaciones SET cliente_id = ${conservar} WHERE cliente_id = ${id} RETURNING 1)
          SELECT COUNT(*)::int AS n FROM m`;
        movidas += Number(q?.n || 0);

        const [mv] = await db.sql`
          WITH m AS (UPDATE movimientos SET cliente_id = ${conservar} WHERE cliente_id = ${id} RETURNING 1)
          SELECT COUNT(*)::int AS n FROM m`;
        movimientos += Number(mv?.n || 0);

        /* Lo que el conservado tenga vacío se completa con el del repetido. */
        for (const k of Object.keys(relleno))
          if (!relleno[k] && otro[k]) relleno[k] = otro[k];
        if (otro.notas && !notas.includes(otro.notas)) notas.push(otro.notas);

        await db.sql`DELETE FROM clientes WHERE id = ${id}`;
        borrados++;
      }

      const [cliente] = await db.sql`
        UPDATE clientes SET
          contacto   = ${relleno.contacto},
          telefono   = ${relleno.telefono},
          correo     = ${relleno.correo},
          direccion  = ${relleno.direccion},
          referencia = ${relleno.referencia},
          notas      = ${notas.join(" · ").slice(0, 1000) || null}
        WHERE id = ${conservar}
        RETURNING *`;

      return json({ ok: true, cliente, movidas, movimientos, borrados });
    }

    /* ============ CLIENTES ============ */
    if (ruta === "clientes") {
      if (metodo === "GET") {
        /* El conteo de cotizaciones lo cuenta la base de datos. Antes se
           deducía de la lista ya descargada, que viene recortada, y un cliente
           con 40 cotizaciones podía aparecer con 0. */
        /* El almacenista ve el directorio completo —necesita elegir a quién se
           le entrega el material— pero no da de alta ni edita clientes. */
        const filas = mueveAlmacen(yo)
          ? await db.sql`
              SELECT c.*, u.nombre AS creador,
                     (SELECT COUNT(*)::int FROM cotizaciones q WHERE q.cliente_id = c.id) AS cotizaciones,
                     (SELECT COUNT(*)::int FROM vales v WHERE v.cliente_id = c.id AND v.cancelado_en IS NULL) AS vales
              FROM clientes c
              LEFT JOIN usuarios u ON u.id = c.creado_por
              ORDER BY c.nombre`
          : await db.sql`
              SELECT c.*, NULL AS creador,
                     (SELECT COUNT(*)::int FROM cotizaciones q
                       WHERE q.cliente_id = c.id AND q.vendedor_id = ${yo.id}) AS cotizaciones
              FROM clientes c
              WHERE c.creado_por = ${yo.id}
              ORDER BY c.nombre`;
        return json({ clientes: filas });
      }
      if (esAlmacen(yo)) return err("El usuario de almacén consulta clientes, no los edita.", 403);
      if (metodo === "POST") {
        const nombre = limpio(cuerpo.nombre, 160);
        if (!nombre) return err("El nombre del cliente es obligatorio.");

        const ya = await clienteRepetido(nombre, cuerpo.referencia);
        if (ya) {
          const mio = esDueno(yo) || ya.creado_por === yo.id;
          const porRpu = claveRpu(cuerpo.referencia) &&
                         claveRpu(ya.referencia) === claveRpu(cuerpo.referencia);
          /* Muchas razones sociales terminan en punto; se recorta para no
             escribir dos puntos seguidos en el aviso. */
          const suNombre = String(ya.nombre).replace(/[.\s]+$/, "");
          return json({
            error: porRpu
              ? `Ya existe un cliente con el número de servicio ${ya.referencia}: ${suNombre}.`
              : `Ya existe un cliente con ese nombre: ${suNombre}.`,
            cliente: mio ? { id: ya.id, nombre: ya.nombre } : null,
            mensaje_extra: mio
              ? "Ábrelo y edítalo en lugar de crear otro."
              : "Está registrado por otro vendedor. Pídele al administrador que te lo asigne.",
          }, 409);
        }

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

        const ya = await clienteRepetido(cuerpo.nombre ?? c.nombre, cuerpo.referencia, id);
        if (ya) {
          const mio = esDueno(yo) || ya.creado_por === yo.id;
          return json({
            error: `Ese nombre o número de servicio ya lo tiene otro cliente: ${String(ya.nombre).replace(/[.\s]+$/, "")}.`,
            cliente: mio ? { id: ya.id, nombre: ya.nombre } : null,
          }, 409);
        }

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
        /* El almacenista trabaja con claves, descripciones y existencias; los
           precios no son de su incumbencia y no salen del servidor. */
        return json({ catalogo: esAlmacen(yo) ? filas.map(({ precio: _p, ...f }) => f) : filas });
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
        /* Si el concepto nunca se movió, se borra de verdad; si ya tiene
           historial, se desactiva y deja de aparecer, pero los movimientos se
           conservan: es el registro de a quién se le entregó qué y cuándo. */
        const id = num(url.searchParams.get("id"));
        if (!id) return err("Falta indicar el concepto.");
        const [it] = await db.sql`SELECT id, clave FROM catalogo WHERE id = ${id}`;
        if (!it) return err("Ese concepto ya no existe.", 404);
        const [m] = await db.sql`SELECT COUNT(*)::int AS n FROM movimientos WHERE item_id = ${id}`;
        if ((m?.n || 0) > 0) {
          await db.sql`UPDATE catalogo SET activo = FALSE, actualizado_en = NOW() WHERE id = ${id}`;
          return json({
            ok: true, desactivado: true,
            mensaje: `${it.clave} tiene ${m.n} ${m.n === 1 ? "movimiento" : "movimientos"} de inventario, ` +
                     `así que se desactivó en lugar de borrarse. El historial se conserva.`,
          });
        }
        await db.sql`DELETE FROM catalogo WHERE id = ${id}`;
        return json({ ok: true, desactivado: false, mensaje: `${it.clave} fue eliminado.` });
      }
    }

    /* ---- Movimiento suelto: entrada rápida o ajuste de conteo ----
       Las SALIDAS ya no pasan por aquí: van en un vale, que es lo que dice a
       qué cliente y obra se fue el material y quién lo entregó y recibió. */
    if (ruta === "inventario/movimiento" && metodo === "POST") {
      if (!mueveAlmacen(yo)) return err("Solo el administrador o el almacén mueven inventario.", 403);
      const itemId = num(cuerpo.item_id);
      const cantidad = Math.abs(num(cuerpo.cantidad));
      const tipo = ["entrada", "ajuste"].includes(cuerpo.tipo) ? cuerpo.tipo : null;
      if (cuerpo.tipo === "salida") return err("Las salidas se registran con un vale de salida.");
      if (!itemId || !tipo || (tipo === "entrada" && cantidad <= 0)) return err("Datos del movimiento incompletos.");
      const motivo = limpio(cuerpo.motivo, 200);
      /* El ajuste corrige la existencia a lo que se contó físicamente. Como
         puede subir o bajar sin documento de por medio, el motivo es
         obligatorio para el almacenista; el administrador puede omitirlo. */
      if (tipo === "ajuste" && esAlmacen(yo) && !motivo)
        return err("Para un ajuste escribe el motivo (conteo físico, merma, error de captura…).");

      const [it] = await db.sql`SELECT id, unidad FROM catalogo WHERE id = ${itemId}`;
      if (!it) return err("Concepto no encontrado.", 404);

      /* La suma se hace en la base de datos, en una sola instrucción: dos
         movimientos al mismo tiempo ya no se pisan. */
      const [fila] = tipo === "entrada"
        ? await db.sql`
            UPDATE catalogo SET existencia = existencia + ${cantidad}, actualizado_en = NOW()
             WHERE id = ${itemId} RETURNING existencia AS saldo`
        : await db.sql`
            UPDATE catalogo SET existencia = ${cantidad}, actualizado_en = NOW()
             WHERE id = ${itemId} RETURNING existencia AS saldo`;
      const saldo = Number(fila.saldo);
      await db.sql`
        INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, cliente_id, fecha_entrega)
        VALUES (${itemId}, ${tipo}, ${cantidad}, ${saldo}, ${motivo}, ${yo.id}, NULL, NULL)`;
      return json({ ok: true, saldo });
    }

    /* ---- Kardex: los movimientos con su vale, cliente, obra y personas ----
       Filtros: item, cliente, cotizacion, vale, desde, hasta, tipo, q. */
    if (ruta === "inventario/movimientos" && metodo === "GET") {
      if (!mueveAlmacen(yo)) return err("Solo el administrador o el almacén consultan el kardex.", 403);
      const p = url.searchParams;
      const item = num(p.get("item")), cliente = num(p.get("cliente")),
            cotizacion = num(p.get("cotizacion")), vale = num(p.get("vale"));
      const tipo = ["entrada", "salida", "ajuste", "devolucion"].includes(p.get("tipo")) ? p.get("tipo") : "";
      const desde = /^\d{4}-\d{2}-\d{2}$/.test(p.get("desde") || "") ? p.get("desde") : null;
      const hasta = /^\d{4}-\d{2}-\d{2}$/.test(p.get("hasta") || "") ? p.get("hasta") : null;
      const q = sinAcentos(p.get("q") || "");
      const like = "%" + q + "%";
      const tope = Math.min(Math.max(num(p.get("tope")) || 300, 1), 1000);
      const filas = await db.sql`
        SELECT k.*, COUNT(*) OVER()::int AS encontradas
          FROM kardex k
         WHERE (${item} = 0 OR k.item_id = ${item})
           AND (${cliente} = 0 OR k.cliente_id = ${cliente})
           AND (${cotizacion} = 0 OR k.cotizacion_id = ${cotizacion})
           AND (${vale} = 0 OR k.vale_id = ${vale})
           AND (${tipo} = '' OR k.tipo = ${tipo})
           AND (${desde}::date IS NULL OR k.fecha >= ${desde}::date)
           AND (${hasta}::date IS NULL OR k.fecha < (${hasta}::date + 1))
           AND (${q} = ''
             OR lower(translate(coalesce(k.obra,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
             OR lower(translate(coalesce(k.cliente,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
             OR lower(translate(coalesce(k.recibio_nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
             OR lower(translate(coalesce(k.motivo,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
             OR lower(coalesce(k.vale,'')) LIKE ${like}
             OR lower(k.clave) LIKE ${like})
         ORDER BY k.fecha DESC, k.id DESC LIMIT ${tope}`;
      const encontradas = filas.length ? Number(filas[0].encontradas) : 0;

      /* Totales por concepto de lo que cumple el filtro: «¿cuánto 2442 se ha
         ido a la obra X?» se contesta aquí sin sumar a mano. */
      const totales = {};
      for (const m of filas) {
        const t = totales[m.clave] ||= { clave: m.clave, descripcion: m.descripcion, unidad: m.unidad, entradas: 0, salidas: 0 };
        if (m.tipo === "salida") t.salidas += Number(m.cantidad);
        else if (m.tipo === "entrada" || m.tipo === "devolucion") t.entradas += Number(m.cantidad);
      }
      return json({
        movimientos: filas.map(({ encontradas: _e, ...f }) => f),
        totales: Object.values(totales).sort((a, b) => a.clave.localeCompare(b.clave)),
        encontradas, tope, recortada: encontradas > filas.length,
      });
    }

    /* ---- Obras (cotizaciones) de un cliente, para elegir destino del vale ----
       Sin precios: sólo folio, estatus y las partidas que llevan inventario,
       para precargar cantidades. El vendedor sólo ve las suyas. */
    if (ruta === "obras" && metodo === "GET") {
      const idCliente = num(url.searchParams.get("cliente"));
      if (!idCliente) return json({ obras: [] });
      const filas = await db.sql`
        SELECT c.id, c.folio, c.estatus, c.linea, c.tipo, c.creado_en, c.partidas, c.vendedor_id,
               c.tecnico->>'ubicacion' AS ubicacion
          FROM cotizaciones c
         WHERE c.cliente_id = ${idCliente}
           AND (${mueveAlmacen(yo)} OR c.vendedor_id = ${yo.id})
         ORDER BY c.creado_en DESC LIMIT 100`;
      const porClave = new Map(porClaveInv(await db.sql`
        SELECT id, clave, descripcion, unidad, existencia FROM catalogo WHERE controla_inventario AND activo`));
      const obras = filas.map((c) => ({
        id: c.id, folio: c.folio, estatus: c.estatus, linea: c.linea, tipo: c.tipo,
        creado_en: c.creado_en, ubicacion: c.ubicacion,
        partidas: (Array.isArray(c.partidas) ? c.partidas : [])
          .filter((p) => porClave.has(String(p.clave || "").toUpperCase()))
          .map((p) => {
            const it = porClave.get(String(p.clave).toUpperCase());
            return { item_id: it.id, clave: it.clave, descripcion: it.descripcion, unidad: it.unidad,
                     cantidad: num(p.cantidad), existencia: Number(it.existencia) };
          }),
      }));
      return json({ obras });
    }

    /* ============ VALES DE ALMACÉN ============ */
    if (ruta === "vales" && metodo === "GET") {
      if (!mueveAlmacen(yo)) return err("Solo el administrador o el almacén consultan los vales.", 403);
      const p = url.searchParams;
      const q = sinAcentos(p.get("q") || ""), like = "%" + q + "%";
      const tipo = ["salida", "entrada", "devolucion"].includes(p.get("tipo")) ? p.get("tipo") : "";
      const cliente = num(p.get("cliente")), cotizacion = num(p.get("cotizacion"));
      const tope = Math.min(Math.max(num(p.get("tope")) || 100, 1), 500);
      const filas = await db.sql`
        SELECT v.id, v.folio, v.tipo, v.fecha::text AS fecha, v.obra, v.referencia, v.cliente_id, v.cotizacion_id,
               v.entrego_nombre, v.recibio_nombre, v.recibio_tel, v.notas, v.creado_en,
               v.cancelado_en, v.motivo_cancelacion, v.vale_origen_id,
               (v.recibio_firma IS NOT NULL) AS firmado,
               cl.nombre AS cliente, q.folio AS cotizacion, u.nombre AS capturo, o.folio AS vale_origen,
               (SELECT COUNT(*)::int FROM movimientos m WHERE m.vale_id = v.id) AS renglones,
               (SELECT COALESCE(SUM(m.cantidad),0)::float FROM movimientos m WHERE m.vale_id = v.id) AS piezas,
               COUNT(*) OVER()::int AS encontradas
          FROM vales v
          LEFT JOIN clientes cl ON cl.id = v.cliente_id
          LEFT JOIN cotizaciones q ON q.id = v.cotizacion_id
          LEFT JOIN usuarios u ON u.id = v.usuario_id
          LEFT JOIN vales o ON o.id = v.vale_origen_id
         WHERE (${tipo} = '' OR v.tipo = ${tipo})
           AND (${cliente} = 0 OR v.cliente_id = ${cliente})
           AND (${cotizacion} = 0 OR v.cotizacion_id = ${cotizacion})
           AND (${q} = ''
             OR lower(v.folio) LIKE ${like}
             OR lower(translate(v.obra,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
             OR lower(translate(coalesce(cl.nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
             OR lower(translate(coalesce(v.recibio_nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
             OR lower(translate(coalesce(v.entrego_nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
             OR lower(coalesce(q.folio,'')) LIKE ${like})
         ORDER BY v.fecha DESC, v.id DESC LIMIT ${tope}`;
      const encontradas = filas.length ? Number(filas[0].encontradas) : 0;
      return json({ vales: filas.map(({ encontradas: _e, ...f }) => f), encontradas, tope, recortada: encontradas > filas.length });
    }

    if (ruta === "vales" && metodo === "POST") {
      if (!mueveAlmacen(yo)) return err("Solo el administrador o el almacén registran vales.", 403);
      const tipo = ["salida", "entrada", "devolucion"].includes(cuerpo.tipo) ? cuerpo.tipo : null;
      if (!tipo) return err("Indica si es salida, entrada o devolución.");
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha || "") ? cuerpo.fecha : new Date().toISOString().slice(0, 10);
      const obra = limpio(cuerpo.obra, 200);
      const entrego = limpio(cuerpo.entrego_nombre, 120) || yo.nombre;
      const recibio = limpio(cuerpo.recibio_nombre, 120);
      const clienteId = num(cuerpo.cliente_id) || null;
      const cotId = num(cuerpo.cotizacion_id) || null;
      const origenId = tipo === "devolucion" ? (num(cuerpo.vale_origen_id) || null) : null;

      if (!obra) return err(tipo === "entrada" ? "Escribe el proveedor u origen del material." : "Escribe la obra o el destino del material.");
      if (!recibio) return err("Escribe quién recibe el material.");
      if (clienteId) {
        const [cl] = await db.sql`SELECT id FROM clientes WHERE id = ${clienteId}`;
        if (!cl) return err("Ese cliente ya no existe.", 404);
      }
      if (cotId) {
        const [q] = await db.sql`SELECT id, cliente_id FROM cotizaciones WHERE id = ${cotId}`;
        if (!q) return err("Esa cotización ya no existe.", 404);
        if (clienteId && q.cliente_id && q.cliente_id !== clienteId) return err("La cotización elegida es de otro cliente.");
      }
      if (origenId) {
        const [o] = await db.sql`SELECT id, tipo FROM vales WHERE id = ${origenId}`;
        if (!o || o.tipo !== "salida") return err("El vale de origen de la devolución no es un vale de salida.");
      }

      /* Partidas: se juntan las repetidas y se descartan las vacías. */
      const juntas = new Map();
      for (const p of (Array.isArray(cuerpo.partidas) ? cuerpo.partidas : [])) {
        const id = num(p.item_id), c = Math.abs(num(p.cantidad));
        if (!id || c <= 0) continue;
        juntas.set(id, (juntas.get(id) || 0) + c);
      }
      if (!juntas.size) return err("Agrega al menos un concepto con cantidad.");
      if (juntas.size > 60) return err("Un vale admite hasta 60 conceptos distintos.");

      const ids = [...juntas.keys()];
      const items = await db.sql`
        SELECT id, clave, descripcion, unidad, existencia, controla_inventario, activo
          FROM catalogo WHERE id = ANY(${ids}::int[])`;
      const porId = new Map(items.map((i) => [i.id, i]));
      for (const id of ids) {
        const it = porId.get(id);
        if (!it) return err(`El concepto #${id} ya no existe.`, 404);
        if (!it.controla_inventario) return err(`${it.clave} no lleva control de inventario.`);
      }
      if (tipo === "salida") {
        const faltan = ids.filter((id) => Number(porId.get(id).existencia) < juntas.get(id))
          .map((id) => { const it = porId.get(id); return `${it.clave}: pides ${juntas.get(id)} y hay ${Number(it.existencia)} ${it.unidad}`; });
        if (faltan.length) return err("Existencia insuficiente. " + faltan.join(" · "));
      }

      /* Cabecera con folio; si dos almacenistas guardan al mismo tiempo y el
         folio choca, se reintenta con el siguiente. */
      const vale = await conFolio(async (folio) => {
        const [v] = await db.sql`
          INSERT INTO vales (folio, tipo, fecha, cliente_id, cotizacion_id, obra, referencia, usuario_id,
                             entrego_nombre, recibio_nombre, recibio_tel, recibio_firma, vale_origen_id, notas)
          VALUES (${folio}, ${tipo}, ${fecha}::date, ${clienteId}, ${cotId}, ${obra}, ${limpio(cuerpo.referencia, 120)},
                  ${yo.id}, ${entrego}, ${recibio}, ${limpio(cuerpo.recibio_tel, 40)}, ${firmaValida(cuerpo.recibio_firma)},
                  ${origenId}, ${limpio(cuerpo.notas, 1000)})
          RETURNING *`;
        return v;
      }, 8, () => siguienteFolioVale(tipo));

      /* Cada renglón se descuenta (o suma) y se registra en UNA sola instrucción:
         si dos vales del mismo concepto se guardan al mismo tiempo, la base de
         datos los pone en fila y ninguno deja la existencia negativa. */
      const motivo = `Vale ${vale.folio} · ${obra}`.slice(0, 200);
      const tipoMov = tipo;                  /* salida | entrada | devolucion */
      const aplicadas = [];
      for (const id of ids) {
        const c = juntas.get(id);
        const [fila] = tipo === "salida"
          ? await db.sql`
              WITH u AS (UPDATE catalogo SET existencia = existencia - ${c}, actualizado_en = NOW()
                          WHERE id = ${id} AND existencia >= ${c} RETURNING existencia)
              INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, cliente_id, fecha_entrega, vale_id)
              SELECT ${id}, ${tipoMov}, ${c}, u.existencia, ${motivo}, ${yo.id}, ${clienteId}, ${fecha}::date, ${vale.id} FROM u
              RETURNING saldo`
          : await db.sql`
              WITH u AS (UPDATE catalogo SET existencia = existencia + ${c}, actualizado_en = NOW()
                          WHERE id = ${id} RETURNING existencia)
              INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, cliente_id, fecha_entrega, vale_id)
              SELECT ${id}, ${tipoMov}, ${c}, u.existencia, ${motivo}, ${yo.id}, ${clienteId}, ${fecha}::date, ${vale.id} FROM u
              RETURNING saldo`;
        if (!fila) {
          /* Alguien se llevó ese material un instante antes. Se regresa lo
             que ya se había descontado y el vale completo se rechaza. */
          for (const idOk of aplicadas)
            await db.sql`UPDATE catalogo SET existencia = existencia + ${juntas.get(idOk)} WHERE id = ${idOk}`;
          await db.sql`DELETE FROM movimientos WHERE vale_id = ${vale.id}`;
          await db.sql`DELETE FROM vales WHERE id = ${vale.id}`;
          const it = porId.get(id);
          const [ahora] = await db.sql`SELECT existencia FROM catalogo WHERE id = ${id}`;
          return err(`Existencia insuficiente de ${it.clave}: pides ${c} y hay ${Number(ahora?.existencia ?? 0)} ${it.unidad}. El vale no se guardó.`, 409);
        }
        aplicadas.push(id);
      }
      return json({ vale: await valeCompleto(vale.id) }, 201);
    }

    if (ruta.startsWith("vale/")) {
      if (!mueveAlmacen(yo)) return err("Solo el administrador o el almacén consultan los vales.", 403);
      const [_, idTxt, accion] = ruta.split("/");
      const id = num(idTxt);
      const [v] = await db.sql`SELECT * FROM vales WHERE id = ${id}`;
      if (!v) return err("Ese vale no existe.", 404);

      if (metodo === "GET" && !accion) return json({ vale: await valeCompleto(id) });

      /* Se pueden corregir las personas, el teléfono, la firma y las notas.
         Las cantidades NO: para eso se cancela el vale y se hace otro, así el
         kardex siempre cuadra con lo que pasó. */
      if (metodo === "PATCH" && !accion) {
        if (v.cancelado_en) return err("Este vale está cancelado y ya no se edita.");
        await db.sql`
          UPDATE vales SET
            entrego_nombre = COALESCE(${limpio(cuerpo.entrego_nombre, 120)}, entrego_nombre),
            recibio_nombre = COALESCE(${limpio(cuerpo.recibio_nombre, 120)}, recibio_nombre),
            recibio_tel    = CASE WHEN ${cuerpo.recibio_tel === undefined} THEN recibio_tel ELSE ${limpio(cuerpo.recibio_tel, 40)} END,
            recibio_firma  = CASE WHEN ${cuerpo.recibio_firma === ""} THEN NULL
                                  ELSE COALESCE(${firmaValida(cuerpo.recibio_firma)}, recibio_firma) END,
            referencia     = CASE WHEN ${cuerpo.referencia === undefined} THEN referencia ELSE ${limpio(cuerpo.referencia, 120)} END,
            notas          = CASE WHEN ${cuerpo.notas === undefined} THEN notas ELSE ${limpio(cuerpo.notas, 1000)} END
          WHERE id = ${id}`;
        return json({ vale: await valeCompleto(id) });
      }

      /* Cancelar: sólo el administrador. No se borra nada: se registran los
         movimientos contrarios y el vale queda marcado, con el motivo. */
      if (metodo === "POST" && accion === "cancelar") {
        if (!esDueno(yo)) return err("Solo el administrador cancela vales.", 403);
        if (v.cancelado_en) return err("Ese vale ya estaba cancelado.");
        const motivoCan = limpio(cuerpo.motivo, 300);
        if (!motivoCan) return err("Escribe el motivo de la cancelación.");
        const lineas = await db.sql`
          SELECT m.item_id, m.cantidad, c.clave, c.unidad, c.existencia
            FROM movimientos m JOIN catalogo c ON c.id = m.item_id WHERE m.vale_id = ${id}`;
        /* Cancelar una entrada saca material: tiene que haber de dónde. */
        if (v.tipo !== "salida") {
          const faltan = lineas.filter((l) => Number(l.existencia) < Number(l.cantidad))
            .map((l) => `${l.clave}: hay ${Number(l.existencia)} ${l.unidad} y el vale trajo ${Number(l.cantidad)}`);
          if (faltan.length) return err("No se puede cancelar: ese material ya salió. " + faltan.join(" · "));
        }
        const motivoRev = `Cancelación de ${v.folio}: ${motivoCan}`.slice(0, 200);
        for (const l of lineas) {
          const c = Number(l.cantidad);
          const [fila] = v.tipo === "salida"
            ? await db.sql`
                WITH u AS (UPDATE catalogo SET existencia = existencia + ${c}, actualizado_en = NOW()
                            WHERE id = ${l.item_id} RETURNING existencia)
                INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, cliente_id, vale_id)
                SELECT ${l.item_id}, 'entrada', ${c}, u.existencia, ${motivoRev}, ${yo.id}, ${v.cliente_id}, ${id} FROM u
                RETURNING saldo`
            : await db.sql`
                WITH u AS (UPDATE catalogo SET existencia = existencia - ${c}, actualizado_en = NOW()
                            WHERE id = ${l.item_id} AND existencia >= ${c} RETURNING existencia)
                INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, cliente_id, vale_id)
                SELECT ${l.item_id}, 'salida', ${c}, u.existencia, ${motivoRev}, ${yo.id}, ${v.cliente_id}, ${id} FROM u
                RETURNING saldo`;
          if (!fila) return err(`No se pudo revertir ${l.clave}: ya no hay existencia suficiente.`, 409);
        }
        await db.sql`
          UPDATE vales SET cancelado_en = NOW(), cancelado_por = ${yo.id}, motivo_cancelacion = ${motivoCan}
           WHERE id = ${id}`;
        return json({ vale: await valeCompleto(id) });
      }
      return err("Método no permitido.", 405);
    }


    /* ============ PARÁMETROS DEL COTIZADOR RÁPIDO ============ */
    if (ruta === "config") {
      if (metodo === "GET") {
        if (esAlmacen(yo)) return json({ config: {} });     /* son parámetros de precio */
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
        /* La búsqueda se hace aquí, en la base de datos, no en el teléfono:
           antes el buscador sólo miraba las 300 cotizaciones ya descargadas y
           las más viejas eran invisibles. */
        const busca = sinAcentos(url.searchParams.get("q") || "");
        const idCliente = num(url.searchParams.get("cliente"));
        const tope = Math.min(Math.max(num(url.searchParams.get("tope")) || 300, 1), 500);
        const like = "%" + busca + "%";
        const buscaNum = soloAlfaNum(busca);
        const likeNum = "%" + buscaNum + "%";

        const filas = esDueno(yo)
          ? await db.sql`
              SELECT c.id, c.folio, c.estatus, c.total, c.linea, c.tipo, c.creado_en, c.actualizado_en,
                     c.cliente_id, cl.nombre AS cliente, cl.referencia AS cliente_rpu,
                     c.recibo->>'no_servicio' AS recibo_rpu, u.nombre AS vendedor,
                     COUNT(*) OVER()::int AS encontradas
              FROM cotizaciones c
              LEFT JOIN clientes cl ON cl.id = c.cliente_id
              LEFT JOIN usuarios u ON u.id = c.vendedor_id
              WHERE (${idCliente} = 0 OR c.cliente_id = ${idCliente})
                AND (${busca} = ''
                  OR lower(translate(coalesce(cl.nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
                  OR lower(c.folio) LIKE ${like}
                  OR lower(translate(coalesce(u.nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
                  OR (length(${buscaNum}) >= 3 AND (
                        lower(regexp_replace(coalesce(cl.referencia,''),'[^0-9A-Za-z]','','g')) LIKE ${likeNum}
                     OR lower(regexp_replace(coalesce(c.recibo->>'no_servicio',''),'[^0-9A-Za-z]','','g')) LIKE ${likeNum}
                     OR lower(regexp_replace(c.folio,'[^0-9A-Za-z]','','g')) LIKE ${likeNum})))
              ORDER BY c.creado_en DESC LIMIT ${tope}`
          : await db.sql`
              SELECT c.id, c.folio, c.estatus, c.total, c.linea, c.tipo, c.creado_en, c.actualizado_en,
                     c.cliente_id, cl.nombre AS cliente, cl.referencia AS cliente_rpu,
                     c.recibo->>'no_servicio' AS recibo_rpu, NULL AS vendedor,
                     COUNT(*) OVER()::int AS encontradas
              FROM cotizaciones c
              LEFT JOIN clientes cl ON cl.id = c.cliente_id
              LEFT JOIN usuarios u ON u.id = c.vendedor_id
              WHERE c.vendedor_id = ${yo.id}
                AND (${idCliente} = 0 OR c.cliente_id = ${idCliente})
                AND (${busca} = ''
                  OR lower(translate(coalesce(cl.nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
                  OR lower(c.folio) LIKE ${like}
                  OR lower(translate(coalesce(u.nombre,''),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) LIKE ${like}
                  OR (length(${buscaNum}) >= 3 AND (
                        lower(regexp_replace(coalesce(cl.referencia,''),'[^0-9A-Za-z]','','g')) LIKE ${likeNum}
                     OR lower(regexp_replace(coalesce(c.recibo->>'no_servicio',''),'[^0-9A-Za-z]','','g')) LIKE ${likeNum}
                     OR lower(regexp_replace(c.folio,'[^0-9A-Za-z]','','g')) LIKE ${likeNum})))
              ORDER BY c.creado_en DESC LIMIT ${tope}`;

        /* «encontradas» es cuántas cumplen la búsqueda en TODA la base, no
           cuántas cabían en el tope. Sin ese dato, el contador de la pantalla
           mentía: decía «5 de 300» cuando en realidad había 350. */
        const encontradas = filas.length ? Number(filas[0].encontradas) : 0;
        return json({
          cotizaciones: filas.map(({ encontradas: _, ...f }) => ({ ...f, vendedor: f.vendedor ?? yo.nombre })),
          encontradas,
          tope,
          recortada: encontradas > filas.length,
        });
      }
      if (metodo === "POST") {
        const partidas = Array.isArray(cuerpo.partidas) ? cuerpo.partidas : [];
        const c = await conFolio(async (folio) => {
          const [fila] = await db.sql`
            INSERT INTO cotizaciones (folio, cliente_id, vendedor_id, estatus, linea, tipo, tecnico, partidas, ahorro, recibo, recibo_foto, foto_producto, foto_sitio, sitio, comentarios, total)
            VALUES (${folio}, ${num(cuerpo.cliente_id) || null}, ${yo.id},
                    ${limpio(cuerpo.estatus, 20) || "borrador"},
                    ${limpio(cuerpo.linea, 20) || "fotovoltaico"}, ${limpio(cuerpo.tipo, 10) || "formal"},
                    ${JSON.stringify(cuerpo.tecnico || {})}::jsonb,
                    ${JSON.stringify(partidas)}::jsonb,
                    ${JSON.stringify(cuerpo.ahorro || {})}::jsonb,
                    ${JSON.stringify(cuerpo.recibo || {})}::jsonb,
                    ${fotoValida(cuerpo.recibo_foto)},
                    ${fotoValida(cuerpo.foto_producto)},
                    ${fotoValida(cuerpo.foto_sitio)},
                    ${sitioValido(cuerpo.sitio)}::jsonb,
                    ${limpio(cuerpo.comentarios, 2000)}, ${totalDePartidas(partidas)})
            RETURNING *`;
          return fila;
        });
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
            foto_producto  = CASE WHEN ${cuerpo.foto_producto === "" ? true : false} THEN NULL
                                  ELSE COALESCE(${fotoValida(cuerpo.foto_producto)}, foto_producto) END,
            foto_sitio     = CASE WHEN ${cuerpo.foto_sitio === "" ? true : false} THEN NULL
                                  ELSE COALESCE(${fotoValida(cuerpo.foto_sitio)}, foto_sitio) END,
            sitio          = CASE WHEN ${cuerpo.sitio === null || cuerpo.foto_sitio === "" ? true : false} THEN NULL
                                  ELSE COALESCE(${sitioValido(cuerpo.sitio)}::jsonb, sitio) END,
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
        await db.sql`DELETE FROM vales        WHERE demo`;
        await db.sql`DELETE FROM clientes     WHERE demo`;
        return json({ ok: true, mensaje: "Datos de ejemplo eliminados." });
      }

      /* ---------- Reiniciar la demostración ----------
         Deja el sitio como recién instalado: borra TODO lo capturado —no sólo
         lo marcado como ejemplo— y devuelve los precios a los de demostración.
         Tres candados, porque este botón borra de verdad:
           1. sólo si MODO_DEMO = 1 (el sitio de trabajo nunca lo tiene),
           2. sólo el administrador,
           3. hay que mandar la palabra REINICIAR.
         El primero es el que importa: sin él, ni siquiera existe la ruta. */
      if (cuerpo.accion === "reiniciar") {
        if (!esDemostracion())
          return err("Este botón sólo existe en el sitio de demostración.", 403);
        if (String(cuerpo.confirmar || "") !== "REINICIAR")
          return err("Falta la confirmación.", 400);

        await db.sql`DELETE FROM cotizaciones`;
        await db.sql`DELETE FROM movimientos`;
        await db.sql`DELETE FROM vales`;
        await db.sql`DELETE FROM clientes`;
        await db.sql`DELETE FROM seguimiento`;

        /* Precios de demostración: NO son los de Marcelestial.
           Son cifras redondas y verosímiles, para que un instalador que ve la
           demostración no se lleve la estructura de márgenes de nadie. */
        await db.sql`
          UPDATE config
             SET valor = jsonb_set(valor, '{lista}', ${JSON.stringify(TARIFAS_DEMO)}::jsonb)
           WHERE clave = 'tarifas'`;
        /* Precios de catálogo de demostración: sin ellos, la cotización por
           catálogo sale en ceros y la demostración se ve rota. También son
           cifras de referencia, no las de nadie. */
        for (const [clave, precio] of Object.entries(CATALOGO_DEMO))
          await db.sql`UPDATE catalogo SET precio = ${precio} WHERE clave = ${clave}`;

        cuerpo.accion = "cargar";   /* y en seguida se vuelven a sembrar los ejemplos */
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

      /* Los ejemplos por tarifa se asignan a Sergio Hernández si existe ese
         usuario; si no, se quedan con quien cargó los datos de ejemplo. */
      const [sergio] = await db.sql`
        SELECT id FROM usuarios
         WHERE activo AND nombre ILIKE ${"%sergio%"} AND nombre ILIKE ${"%hern%"}
         ORDER BY id LIMIT 1`;
      const idSergio = sergio?.id || yo.id;

      const anio = new Date().getFullYear();
      let consecutivo = await ultimoFolio(anio);
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

        /* ---- Ejemplos hechos desde el recibo de CFE, uno por tarifa ----
           Sirven para revisar cómo queda la propuesta con las últimas
           actualizaciones: cobertura, nota del cargo fijo, guía de inversores
           y la hoja de recuperación mes a mes. Van a nombre de Sergio. */
        /* GDMTH · media tensión horaria · sistema parcial (300 de 891 módulos) */
        { cli: 1, linea: "fotovoltaico", tipo: "rapida", estatus: "negociacion", sergio: true,
          partidas: [{"clave":"SISTEMA-FV","descripcion":"Sistema fotovoltaico interconectado · 300 módulos de 710 W · 213.00 kWp · tarifa GDMTH en 220 V","unidad":"MOD","cantidad":300,"precio":11500}],
          tecnico: {"kwp":"213.00","paneles":"300","wpanel":"710","inversores":"2","tension":"220","capinversor":"2 x 100 kW","marcainversor":"Growatt MAX 100K","produccion":"57254"},
          ahorro: {"actual":263500,"nuevo":174756,"cobertura":34,"cargo_fijo":650,"roi":3.2,"anual":1064932,"precio_kwh":3.1},
          recibo: {"tarifa":"GDMTH","tarifa_nombre":"GDMTH · Gran demanda en media tensión horaria","grupo":"media","tension":"220","hilos":3,"demanda_contratada":"180","base":30000,"intermedia":45000,"punta":10000,"consumo_total":85000,"dias":30,"pago":263500,"no_servicio":"147911202086","periodo":"1 jun 2026 al 1 jul 2026","periodo_del":"2026-06-01","periodo_al":"2026-07-01","uvie":true,"gestion":true,"inversores":2,"inversor_modelo":"MAX 100K","inversor_capacidad":"2 x 100 kW","inversor_aplicacion":"Industrial","inversor_cobrado":false,"revision_ingenieria":false,"precio_kwh":3.1,"consumo_dia":2833,"superficie_m2":930,"produccion_mes":28627,"ahorro_mes":88744,"ahorro_30":31947955,"enganche":1035000,"mensualidad":20125,"plazo":120},
          comentarios: "El techo y el presupuesto sólo permiten 300 de los módulos que pide el cálculo. Sistema ampliable. Cotización preliminar. No tendrá validez definitiva hasta la visita técnica del área de ingeniería, en la que se inspeccionará el sitio, se tomarán medidas y se analizarán las condiciones de instalación. Con base en esa evaluación se determinará la cantidad final de paneles que pueden instalarse de forma segura y eficiente, por lo que el alcance y el importe podrán ajustarse." },

        /* GDMTO · media tensión ordinaria */
        { cli: 2, linea: "fotovoltaico", tipo: "rapida", estatus: "enviada", sergio: true,
          partidas: [{"clave":"SISTEMA-FV","descripcion":"Sistema fotovoltaico interconectado · 189 módulos de 710 W · 134.19 kWp · tarifa GDMTO en 440 V","unidad":"MOD","cantidad":189,"precio":11000}],
          tecnico: {"kwp":"134.19","paneles":"189","wpanel":"710","inversores":"1","tension":"440","capinversor":"125 kW","marcainversor":"Growatt MAX 125K","produccion":"36070"},
          ahorro: {"actual":63000,"nuevo":0,"cobertura":100,"cargo_fijo":650,"roi":2.8,"anual":731613,"precio_kwh":3.3871},
          recibo: {"tarifa":"GDMTO","tarifa_nombre":"GDMTO · Gran demanda en media tensión ordinaria","grupo":"media","tension":"440","hilos":3,"demanda_contratada":"95","base":0,"intermedia":0,"punta":0,"consumo_total":18600,"dias":31,"pago":63000,"no_servicio":"513250503544","periodo":"5 jun 2026 al 6 jul 2026","periodo_del":"2026-06-05","periodo_al":"2026-07-06","uvie":true,"gestion":true,"inversores":1,"inversor_modelo":"MAX 125K","inversor_capacidad":"125 kW","inversor_aplicacion":"Industrial","inversor_cobrado":false,"revision_ingenieria":false,"precio_kwh":3.3871,"consumo_dia":600,"superficie_m2":586,"produccion_mes":18035,"ahorro_mes":60968,"ahorro_30":21948387,"enganche":623700,"mensualidad":12128,"plazo":120},
          comentarios: "Cotización preliminar. No tendrá validez definitiva hasta la visita técnica del área de ingeniería, en la que se inspeccionará el sitio, se tomarán medidas y se analizarán las condiciones de instalación. Con base en esa evaluación se determinará la cantidad final de paneles que pueden instalarse de forma segura y eficiente, por lo que el alcance y el importe podrán ajustarse." },

        /* Tarifa 01 · casa */
        { cli: 5, linea: "fotovoltaico", tipo: "rapida", estatus: "borrador", sergio: true,
          partidas: [{"clave":"SISTEMA-FV","descripcion":"Sistema fotovoltaico interconectado · 10 módulos de 710 W · 7.10 kWp · tarifa 01 en 127 V · Incluye estructura ligera de piso de aluminio anodizado y gestión ante CFE","unidad":"MOD","cantidad":10,"precio":13000}],
          tecnico: {"kwp":"7.10","paneles":"10","wpanel":"710","inversores":"1","tension":"127","capinversor":"6 kW","marcainversor":"Growatt MIN","produccion":"1908"},
          ahorro: {"actual":6300,"nuevo":0,"cobertura":100,"cargo_fijo":60,"roi":3.5,"anual":37180,"precio_kwh":3.5},
          recibo: {"tarifa":"01","tarifa_nombre":"Tarifa 01 · Casa","grupo":"domestica","tension":"127","hilos":1,"demanda_contratada":null,"base":0,"intermedia":0,"punta":0,"consumo_total":1800,"dias":61,"pago":6300,"no_servicio":"D741860","periodo":"28 may 2026 al 28 jul 2026","periodo_del":"2026-05-28","periodo_al":"2026-07-28","uvie":false,"gestion":true,"inversores":1,"inversor_modelo":"MIN","inversor_capacidad":"6 kW","inversor_aplicacion":"Residencial","inversor_cobrado":false,"revision_ingenieria":false,"precio_kwh":3.5,"consumo_dia":30,"superficie_m2":31,"produccion_mes":954,"ahorro_mes":3098,"ahorro_30":1115410,"enganche":39000,"mensualidad":758,"plazo":120},
          comentarios: "Cotización preliminar. No tendrá validez definitiva hasta la visita técnica del área de ingeniería, en la que se inspeccionará el sitio, se tomarán medidas y se analizarán las condiciones de instalación. Con base en esa evaluación se determinará la cantidad final de paneles que pueden instalarse de forma segura y eficiente, por lo que el alcance y el importe podrán ajustarse." },

        /* Tarifa 02 · negocio */
        { cli: 4, linea: "fotovoltaico", tipo: "rapida", estatus: "enviada", sergio: true,
          partidas: [{"clave":"SISTEMA-FV","descripcion":"Sistema fotovoltaico interconectado · 24 módulos de 710 W · 17.04 kWp · tarifa 02 en 127 V · Incluye estructura ligera de piso de aluminio anodizado y gestión ante CFE","unidad":"MOD","cantidad":24,"precio":13000}],
          tecnico: {"kwp":"17.04","paneles":"24","wpanel":"710","inversores":"1","tension":"127","capinversor":"15 kW","marcainversor":"Growatt MID","produccion":"4580"},
          ahorro: {"actual":19119,"nuevo":0,"cobertura":100,"cargo_fijo":250,"roi":2.1,"anual":146443,"precio_kwh":5.3465},
          recibo: {"tarifa":"02","tarifa_nombre":"Tarifa 02 · Negocio","grupo":"domestica","tension":"127","hilos":1,"demanda_contratada":null,"base":0,"intermedia":0,"punta":0,"consumo_total":3576,"dias":47,"pago":19119,"no_servicio":"228140100722","periodo":"20 jun 2026 al 6 ago 2026","periodo_del":"2026-06-20","periodo_al":"2026-08-06","uvie":false,"gestion":true,"inversores":1,"inversor_modelo":"MID","inversor_capacidad":"15 kW","inversor_aplicacion":"Trifásico","inversor_cobrado":false,"revision_ingenieria":false,"precio_kwh":5.3465,"consumo_dia":76,"superficie_m2":74,"produccion_mes":2290,"ahorro_mes":12204,"ahorro_30":4393302,"enganche":93600,"mensualidad":1820,"plazo":120},
          comentarios: "Cotización preliminar. No tendrá validez definitiva hasta la visita técnica del área de ingeniería, en la que se inspeccionará el sitio, se tomarán medidas y se analizarán las condiciones de instalación. Con base en esa evaluación se determinará la cantidad final de paneles que pueden instalarse de forma segura y eficiente, por lo que el alcance y el importe podrán ajustarse." }
      ];

      const creadas = [];
      for (const c of COTS) {
        const total = c.partidas.reduce((a, p) => a + p.cantidad * p.precio, 0);
        const [nueva] = await db.sql`
          INSERT INTO cotizaciones (folio, cliente_id, vendedor_id, estatus, linea, tipo,
                                    tecnico, partidas, ahorro, recibo, comentarios, total, demo)
          VALUES (${folio()}, ${ids[c.cli]}, ${c.sergio ? idSergio : yo.id},
                  ${c.estatus}, ${c.linea}, ${c.tipo},
                  ${JSON.stringify(c.tecnico || {})}::jsonb,
                  ${JSON.stringify(c.partidas)}::jsonb,
                  ${JSON.stringify(c.ahorro || {})}::jsonb,
                  ${JSON.stringify(c.recibo || {})}::jsonb,
                  ${c.comentarios || "Cotización de ejemplo para demostración."},
                  ${total}, TRUE)
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

      /* Movimientos de ejemplo, ya en forma de vales: una entrada del
         proveedor y dos salidas a obra, con quién entregó y quién recibió. */
      const VALES = [
        { tipo: "entrada", obra: "Alyex · extrusión de perfiles", referencia: "Remisión AX-4471",
          entrego: "Transportes Alyex", recibio: "Almacén Marcelestial",
          partidas: [["001", 2000], ["002", 900], ["ABZ-INT", 3000], ["EPDM", 5000]] },
        { tipo: "salida", cli: 2, cot: 0, obra: "Nave Iztapalapa · techo lámina",
          entrego: "Juan Pérez (almacén)", recibio: "Ing. Torres (instalador)", tel: "5588220134",
          partidas: [["001", 800], ["ABZ-INT", 1600], ["EPDM", 1600]] },
        { tipo: "salida", cli: 3, cot: 1, obra: "Interalum · planta Cancún",
          entrego: "Juan Pérez (almacén)", recibio: "Rafael Chiang", tel: "9982114477",
          partidas: [["ABZ-INT", 800], ["EPDM", 800]] },
      ];
      for (const v of VALES) {
        const folioV = await siguienteFolioVale(v.tipo);
        const [vale] = await db.sql`
          INSERT INTO vales (folio, tipo, fecha, cliente_id, cotizacion_id, obra, referencia, usuario_id,
                             entrego_nombre, recibio_nombre, recibio_tel, notas, demo)
          VALUES (${folioV}, ${v.tipo}, CURRENT_DATE, ${v.cli !== undefined ? ids[v.cli] : null},
                  ${v.cot !== undefined ? creadas[v.cot] : null}, ${v.obra}, ${v.referencia || null}, ${yo.id},
                  ${v.entrego}, ${v.recibio}, ${v.tel || null}, 'Vale de ejemplo para demostración.', TRUE)
          RETURNING id, folio`;
        for (const [clave, cant] of v.partidas) {
          const [it] = await db.sql`SELECT id, existencia FROM catalogo WHERE clave = ${clave}`;
          if (!it) continue;
          const saldo = v.tipo === "salida"
            ? Math.max(0, Number(it.existencia) - cant)
            : Number(it.existencia) + cant;
          await db.sql`UPDATE catalogo SET existencia = ${saldo}, actualizado_en = NOW() WHERE id = ${it.id}`;
          await db.sql`
            INSERT INTO movimientos (item_id, tipo, cantidad, saldo, motivo, usuario_id, cliente_id, fecha_entrega, vale_id, demo)
            VALUES (${it.id}, ${v.tipo}, ${cant}, ${saldo}, ${"Vale " + vale.folio + " · " + v.obra}, ${yo.id},
                    ${v.cli !== undefined ? ids[v.cli] : null}, CURRENT_DATE, ${vale.id}, TRUE)`;
        }
      }

      return json({ ok: true, mensaje: `Se cargaron ${CLIENTES.length} clientes y ${COTS.length} cotizaciones de ejemplo.` });
    }

    /* ============ PANEL ============ */
    if (ruta === "panel" && metodo === "GET") {
      /* El panel del almacén: lo que hay bajo mínimo y el movimiento del mes. */
      if (esAlmacen(yo)) {
        const bajoMinimo = await db.sql`SELECT clave, descripcion, existencia, minimo, unidad FROM catalogo
                                         WHERE controla_inventario AND activo AND existencia <= minimo ORDER BY clave`;
        const [mes] = await db.sql`
          SELECT COUNT(*) FILTER (WHERE tipo = 'salida')::int AS salidas,
                 COUNT(*) FILTER (WHERE tipo = 'entrada')::int AS entradas,
                 COUNT(*) FILTER (WHERE tipo = 'devolucion')::int AS devoluciones
            FROM vales WHERE cancelado_en IS NULL AND fecha >= date_trunc('month', CURRENT_DATE)`;
        const [piezas] = await db.sql`
          SELECT COALESCE(SUM(m.cantidad) FILTER (WHERE m.tipo = 'salida'),0)::float AS salidas
            FROM movimientos m JOIN vales v ON v.id = m.vale_id
           WHERE v.cancelado_en IS NULL AND v.fecha >= date_trunc('month', CURRENT_DATE)`;
        const ultimos = await db.sql`
          SELECT v.id, v.folio, v.tipo, v.fecha::text AS fecha, v.obra, cl.nombre AS cliente, v.recibio_nombre, v.cancelado_en,
                 (SELECT COALESCE(SUM(m.cantidad),0)::float FROM movimientos m WHERE m.vale_id = v.id AND m.tipo = v.tipo) AS piezas
            FROM vales v LEFT JOIN clientes cl ON cl.id = v.cliente_id
           ORDER BY v.fecha DESC, v.id DESC LIMIT 6`;
        return json({ almacen: { mes, piezasMes: piezas?.salidas || 0, ultimos }, bajoMinimo, resumen: [], porVendedor: [] });
      }
      const resumen = esDueno(yo)
        ? await db.sql`
            SELECT estatus, COUNT(*)::int AS n, COALESCE(SUM(total),0)::float AS monto
            FROM cotizaciones GROUP BY estatus`
        : await db.sql`
            SELECT estatus, COUNT(*)::int AS n, COALESCE(SUM(total),0)::float AS monto
            FROM cotizaciones WHERE vendedor_id = ${yo.id} GROUP BY estatus`;
      const bajoMinimo = esDueno(yo)
        ? await db.sql`SELECT clave, descripcion, existencia, minimo, unidad FROM catalogo
                       WHERE controla_inventario AND activo AND existencia <= minimo ORDER BY clave`
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
    /* La librería de base de datos envuelve el error real y pega la consulta
       completa —tablas, columnas, a veces datos— en el mensaje. Nada de eso
       debe llegar al navegador. Se registra completo en Netlify con una
       referencia de seis letras; al usuario sólo se le muestra la referencia. */
    const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
    console.error(`API error [${ref}] ${metodo} /${ruta}:`, e, e?.cause || "");
    return err(`Ocurrió un error en el servidor (ref. ${ref}). Si se repite, avisa al administrador con esa referencia.`, 500);
  }
};
