import { getDatabase } from "@netlify/database";
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

/* conexión perezosa: el módulo no debe fallar al importarse */
let _db = null;
const conectar = () => (_db ??= getDatabase());
export const db = {
  get sql() { return conectar().sql; },
  get pool() { return conectar().pool; },
};

/* ---------------- respuestas ---------------- */
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const err = (mensaje, status = 400) => json({ error: mensaje }, status);

/* ---------------- contraseñas (scrypt) ---------------- */
export function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(plain), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/* Invitaciones de un solo uso.
   El enlace lleva un código al azar; en la base sólo se guarda su huella, igual
   que con las contraseñas. Si alguien se robara un respaldo de la base no podría
   reconstruir los enlaces pendientes. */
export function nuevoCodigo() {
  return randomBytes(24).toString("base64url");
}
export function huellaDeCodigo(codigo) {
  return createHmac("sha256", String(process.env.JWT_SECRET || "")).update(String(codigo)).digest("hex");
}

/* Una cuenta invitada todavía no tiene contraseña utilizable. Se marca así para
   que ningún intento de inicio de sesión pueda coincidir por accidente. */
export const SIN_PASSWORD = "pendiente-de-activacion";

export function verifyPassword(plain, stored) {
  try {
    const [algo, salt, hash] = String(stored).split("$");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const calc = scryptSync(String(plain), salt, 64);
    const ref = Buffer.from(hash, "hex");
    return calc.length === ref.length && timingSafeEqual(calc, ref);
  } catch {
    return false;
  }
}

/* ---------------- token (JWT HS256 propio) ---------------- */
/* La llave de las sesiones viene SÓLO de la variable JWT_SECRET de Netlify.
   Antes, si faltaba, se usaba un texto fijo del código: cualquiera que lo
   conociera podía firmarse un token de administrador. Ahora, sin llave —o con
   la llave vieja del código— la API se niega a trabajar y dice qué configurar. */
const SECRET = String(process.env.JWT_SECRET || "");
const LLAVE_VIEJA = "cambiar-esta-llave-en-netlify";
export function problemaDeLlave() {
  if (!SECRET) return "Falta la variable JWT_SECRET en Netlify (Site configuration → Environment variables).";
  if (SECRET === LLAVE_VIEJA) return "JWT_SECRET todavía tiene el valor de ejemplo. Cámbiala por una llave propia de al menos 32 caracteres.";
  if (SECRET.length < 32) console.warn("JWT_SECRET es corta: conviene una llave de al menos 32 caracteres.");
  return null;
}
const b64u = (buf) => Buffer.from(buf).toString("base64url");

export function signToken(payload, dias = 30) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + dias * 86400 };
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = `${head}.${b64u(JSON.stringify(body))}`;
  const sig = createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function readToken(token) {
  try {
    const [head, body, sig] = String(token).split(".");
    if (!head || !body || !sig) return null;
    const esperado = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(esperado);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const datos = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!datos.exp || datos.exp < Math.floor(Date.now() / 1000)) return null;
    return datos;
  } catch {
    return null;
  }
}

/* ---------------- sesión ---------------- */
export async function sesion(req) {
  const cab = req.headers.get("authorization") || "";
  const token = cab.startsWith("Bearer ") ? cab.slice(7) : null;
  if (!token) return null;
  const datos = readToken(token);
  if (!datos?.uid) return null;
  const [u] = await db.sql`
    SELECT id, correo, nombre, rol, activo, token_version
      FROM usuarios WHERE id = ${datos.uid} LIMIT 1`;
  if (!u || !u.activo) return null;
  /* Revocación: el token trae la versión con la que se firmó. Si la cuenta
     subió de versión —cambio de contraseña, cambio de rol, baja— el token
     viejo ya no sirve aunque todavía no haya vencido. Los tokens emitidos
     antes de esta migración no traen tv; se aceptan una vez y el siguiente
     inicio de sesión ya los deja al corriente. */
  if (datos.tv !== undefined && Number(datos.tv) !== Number(u.token_version)) return null;
  const { token_version, ...limpioU } = u;
  return limpioU;
}

/* ---------------- roles ----------------
   owner     administrador general: todo
   vendedor  cotiza y lleva sus clientes; ve existencias pero no mueve almacén
   almacen   registra entradas y salidas (vales) y ve existencias; no cotiza ni ve precios */
export const ROLES = ["owner", "vendedor", "almacen"];
export const esDueno      = (u) => u?.rol === "owner";
export const esAlmacen    = (u) => u?.rol === "almacen";
export const esVendedor   = (u) => u?.rol === "vendedor";
export const mueveAlmacen = (u) => esDueno(u) || esAlmacen(u);

/* ---------------- utilidades ---------------- */
export const num = (v) => {
  const n = Number(String(v ?? "").toString().replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const limpio = (v, max = 500) =>
  v === null || v === undefined ? null : String(v).trim().slice(0, max) || null;

/* Último número de folio usado en el año.
   Se toma el MAYOR número ya usado, nunca la cantidad de cotizaciones: si se
   borra una cotización la cuenta baja y el folio se repetiría. Como el folio es
   único en la base de datos, eso era el error "duplicate key ... folio". */
export async function ultimoFolio(anio) {
  const [r] = await db.sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(substring(folio from 9), '[^0-9]', '', 'g'), '')::int), 0) AS n
      FROM cotizaciones
     WHERE folio LIKE ${"MC-" + anio + "-%"}`;
  return Number(r?.n || 0);
}

export async function siguienteFolio() {
  const anio = new Date().getFullYear();
  return `MC-${anio}-${String((await ultimoFolio(anio)) + 1).padStart(4, "0")}`;
}

/* Folios de los vales de almacén: VS = salida, VE = entrada, VD = devolución.
   Cada tipo lleva su propia numeración por año, igual que las cotizaciones. */
export const PREFIJO_VALE = { salida: "VS", entrada: "VE", devolucion: "VD" };
export async function siguienteFolioVale(tipo) {
  const pre = PREFIJO_VALE[tipo] || "VS";
  const anio = new Date().getFullYear();
  const [r] = await db.sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(substring(folio from 9), '[^0-9]', '', 'g'), '')::int), 0) AS n
      FROM vales
     WHERE folio LIKE ${pre + "-" + anio + "-%"}`;
  return `${pre}-${anio}-${String(Number(r?.n || 0) + 1).padStart(4, "0")}`;
}

/* Folio de la orden de compra al proveedor: OC-2026-0001, por año. */
export async function siguienteFolioOrden() {
  const anio = new Date().getFullYear();
  const [r] = await db.sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(substring(folio from 9), '[^0-9]', '', 'g'), '')::int), 0) AS n
      FROM ordenes
     WHERE folio LIKE ${"OC-" + anio + "-%"}`;
  return `OC-${anio}-${String(Number(r?.n || 0) + 1).padStart(4, "0")}`;
}

/* Precio por escalón de volumen. Los escalones vienen ordenados de menor a
   mayor; "hasta: 0" es el último y significa "de ahí en adelante". Se cobra el
   escalón que corresponde a la cantidad TOTAL del renglón, no por pieza. */
export function precioPorVolumen(escalones, cantidad) {
  const lista = Array.isArray(escalones) ? escalones : [];
  for (const e of lista) {
    const hasta = Number(e.hasta) || 0;
    if (hasta === 0 || cantidad <= hasta) return Number(e.precio) || 0;
  }
  return Number(lista[lista.length - 1]?.precio) || 0;
}

/* Material que consume un proyecto.
   Los puntos de sujeción interiores se comparten entre paneles vecinos: un riel
   con su clamp detiene el borde de un panel y el del siguiente. Por hilera de n
   paneles cada una de las dos líneas de riel lleva n+1 posiciones, así que:
       piezas = por_modulo × módulos + por_hilera × hileras
   Con por_modulo = 2 y por_hilera = 2 eso da 4 piezas para un panel solo y 6
   para dos en línea, que es como se montan en obra.
   La regla vive en el catálogo, no aquí: así entran productos nuevos sin tocar
   código. */
export function materialDeProyecto(catalogo, modulos, hileras = 1) {
  const n = Math.max(0, Math.floor(Number(modulos) || 0));
  const h = Math.min(n, Math.max(1, Math.floor(Number(hileras) || 1)));
  return (catalogo?.productos || [])
    .filter((p) => Number(p.por_modulo) > 0 || Number(p.por_hilera) > 0)
    .map((p) => {
      const cantidad = n * (Number(p.por_modulo) || 0) + h * (Number(p.por_hilera) || 0);
      const precio = precioPorVolumen(p.escalones, cantidad);
      return {
        clave: p.clave, nombre: p.nombre, detalle: p.detalle || "",
        unidad: p.unidad || "pza",
        por_modulo: Number(p.por_modulo) || 0, por_hilera: Number(p.por_hilera) || 0,
        cantidad, precio, importe: +(cantidad * precio).toFixed(2),
      };
    });
}

/* Un folio repetido todavía puede colarse si dos vendedores guardan en el mismo
   instante. En ese caso se vuelve a intentar con el siguiente número. */
export const esFolioRepetido = (e) =>
  /duplicate key|23505|cotizaciones_folio|vales_folio|ordenes_folio/i.test(
    [e?.message, e?.detail, e?.constraint,
     e?.cause?.message, e?.cause?.detail, e?.cause?.constraint].filter(Boolean).join(" ")
  );

export async function conFolio(intentar, intentos = 8, siguiente = siguienteFolio) {
  let ultimo = null;
  for (let i = 0; i < intentos; i++) {
    try {
      return await intentar(await siguiente());
    } catch (e) {
      if (!esFolioRepetido(e)) throw e;
      ultimo = e;
    }
  }
  throw ultimo;
}

/* Nombre normalizado para comparar clientes. Se quitan acentos, mayúsculas,
   signos y **también los espacios**, porque en los recibos y en las capturas la
   misma razón social aparece de mil formas:
     "PLÁSTICOS ALICA, S.A. DE C.V."  ·  "plasticos alica sa de cv"
     "Benítez Albiter Lucia Maria"    ·  "Benítez Albiter lucia María"
   Al final se recorta la forma legal (SA DE CV, S DE RL DE CV, SAS…) para que
   "Plásticos Alica" y "Plásticos Alica S.A. de C.V." se reconozcan como el
   mismo cliente. Se recorta sólo la forma completa: un "SA" suelto al final no
   se toca, porque hay nombres que terminan así de verdad. */
export function claveNombre(v) {
  const t = String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return t.replace(/(?:SAPIDECV|SADECV|SDERLDECV|SRLDECV|SDERL|SRL|SAPI|SAS)$/, "");
}

/* El RPU se compara sólo por sus dígitos y letras, sin espacios ni guiones. */
export function claveRpu(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function totalDePartidas(partidas) {
  return (Array.isArray(partidas) ? partidas : []).reduce(
    (acc, p) => acc + num(p.cantidad) * num(p.precio),
    0
  );
}

/* ---------------- precios autorizados ----------------
   La regla «sólo el administrador cambia precios» tiene que cumplirse en el
   servidor, no en la pantalla: un vendedor puede mandar por la API el precio
   que quiera aunque el campo esté deshabilitado en su teléfono.

   Para cada partida se determina de dónde sale su precio autorizado:
     SISTEMA-FV   → tabla de tarifas, por tarifa, tensión y cantidad de módulos
     INVERSOR     → guía de inversores o precio del cotizador rápido
     PANEL, ESTRUCT, MATELEC, MANOBRA → parámetros del cotizador rápido
     cualquier otra clave → catálogo
   Devuelve { ok } o { ok:false, mensaje }. El administrador nunca pasa por aquí. */
export function revisarPrecios(partidas, tecnico, config, catalogo) {
  const lista = Array.isArray(partidas) ? partidas : [];
  const tarifas = config.tarifas?.lista || [];
  const rapido = config.rapido_fotovoltaico || {};
  const guia = config.dimensionamiento?.guia_inversores || [];
  const porClave = new Map((catalogo || []).map((c) => [String(c.clave).toUpperCase(), Number(c.precio)]));
  const cerca = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.5;

  for (const p of lista) {
    const clave = String(p.clave || "").toUpperCase();
    const precio = Number(p.precio) || 0;
    const cant = Number(p.cantidad) || 0;

    if (clave === "SISTEMA-FV") {
      const tar = tarifas.find((t) => t.clave === tecnico?.tarifa);
      if (!tar) return { ok: false, mensaje: "La cotización no indica la tarifa; no se puede validar el precio por módulo." };
      const esc = (tar.escalones || [])
        .filter((e) => e.tension === String(tecnico?.tension) || e.tension === "*")
        .sort((a, b) => Number(a.hasta) - Number(b.hasta));
      if (!esc.length) return { ok: false, mensaje: "La tarifa no tiene precio para esa tensión." };
      const tope = Number(esc[esc.length - 1].hasta);
      if (cant > tope) continue;                       /* arriba del tope no hay precio de tabla */
      const m = esc.find((e) => cant <= Number(e.hasta)) || esc[esc.length - 1];
      if (!cerca(precio, m.precio))
        return { ok: false, mensaje: `El precio por módulo (${precio}) no coincide con la tarifa (${Number(m.precio)}). Sólo el administrador puede cambiarlo.` };
      continue;
    }

    if (clave === "INVERSOR") {
      const permitidos = [Number(rapido.inversor_precio) || 0, ...guia.map((g) => Number(g.precio) || 0)];
      if (!permitidos.some((x) => cerca(precio, x)))
        return { ok: false, mensaje: `El precio del inversor (${precio}) no está en la guía. Sólo el administrador puede cambiarlo.` };
      continue;
    }

    const rapidas = { PANEL: "panel_precio", ESTRUCT: "estructura_por_panel",
                      MATELEC: "electrico_por_kwp", MANOBRA: "manobra_por_kwp" };
    if (rapidas[clave]) {
      const aut = Number(rapido[rapidas[clave]]) || 0;
      if (!cerca(precio, aut))
        return { ok: false, mensaje: `El precio de ${clave} (${precio}) no coincide con el configurado (${aut}). Sólo el administrador puede cambiarlo.` };
      continue;
    }

    if (!porClave.has(clave))
      return { ok: false, mensaje: `«${p.descripcion || clave}» no está en el catálogo. Sólo el administrador puede agregar conceptos fuera de él.` };
    if (!cerca(precio, porClave.get(clave)))
      return { ok: false, mensaje: `El precio de ${clave} (${precio}) no coincide con el catálogo (${porClave.get(clave)}). Sólo el administrador puede cambiarlo.` };
  }
  return { ok: true };
}

/* Foto del recibo: sólo se acepta una imagen en formato data URL y con un tamaño
   razonable. Cualquier otra cosa se descarta, para que nadie meta basura en la
   base de datos. Alrededor de 4 MB de texto equivalen a 3 MB de imagen. */
/* Firma trazada en pantalla: PNG en data URL y chica (menos de 80 KB).
   No es una foto: si pesa más, algo raro se está mandando. */
export function firmaValida(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)) return null;
  if (s.length > 80_000) return null;
  return s;
}

export function fotoValida(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) return null;
  if (s.length > 4_000_000) return null;
  return s;
}
