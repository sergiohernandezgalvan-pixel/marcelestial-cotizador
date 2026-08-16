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
const SECRET = process.env.JWT_SECRET || "cambiar-esta-llave-en-netlify";
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
    SELECT id, correo, nombre, rol, activo FROM usuarios WHERE id = ${datos.uid} LIMIT 1`;
  if (!u || !u.activo) return null;
  return u;
}

export const esDueno = (u) => u?.rol === "owner";

/* ---------------- utilidades ---------------- */
export const num = (v) => {
  const n = Number(String(v ?? "").toString().replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const limpio = (v, max = 500) =>
  v === null || v === undefined ? null : String(v).trim().slice(0, max) || null;

export async function siguienteFolio() {
  const anio = new Date().getFullYear();
  const [r] = await db.sql`
    SELECT COUNT(*)::int AS n FROM cotizaciones WHERE folio LIKE ${"MC-" + anio + "-%"}`;
  return `MC-${anio}-${String((r?.n || 0) + 1).padStart(4, "0")}`;
}

export function totalDePartidas(partidas) {
  return (Array.isArray(partidas) ? partidas : []).reduce(
    (acc, p) => acc + num(p.cantidad) * num(p.precio),
    0
  );
}

/* Foto del recibo: sólo se acepta una imagen en formato data URL y con un tamaño
   razonable. Cualquier otra cosa se descarta, para que nadie meta basura en la
   base de datos. Alrededor de 4 MB de texto equivalen a 3 MB de imagen. */
export function fotoValida(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) return null;
  if (s.length > 4_000_000) return null;
  return s;
}
