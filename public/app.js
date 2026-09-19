/* Cotizador Marcelestial — app cliente */
const VERSION = "2026.09.19e";
const S = {
  token: localStorage.getItem("mc_token") || null,
  yo: null,
  catalogo: [],
  clientes: [],
  cotizaciones: [],
  editor: null,
  config: {},
};

const LINEAS = {
  fotovoltaico: "Fotovoltaico",
  perfiles: "Perfiles y herrajes",
  electrico: "Servicios eléctricos",
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + (Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numero = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
/* Una fecha sin hora ("2026-09-07") se lee como día local: si se leyera como
   UTC, en México se mostraría el día anterior. */
const fecha = (f) => {
  if (!f) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(f))
    ? new Date(...String(f).split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0)))
    : new Date(f);
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
};
const esDueno = () => S.yo?.rol === "owner";
const esAlmacen = () => S.yo?.rol === "almacen";
const mueveAlmacen = () => esDueno() || esAlmacen();
const ROL_NOMBRE = { owner: "Administrador", vendedor: "Vendedor", almacen: "Almacén" };
const TIPO_VALE = { salida: "Salida", entrada: "Entrada", devolucion: "Devolución" };
const TIPO_MOV = { salida: "Salida", entrada: "Entrada", devolucion: "Devolución", ajuste: "Ajuste" };
const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const ESTATUS = {
  borrador: "Borrador", enviada: "Enviada", negociacion: "En negociación",
  ganada: "Ganada", perdida: "Perdida",
};

/* ---------------- API ---------------- */
async function api(ruta, opciones = {}) {
  const r = await fetch("/api/" + ruta, {
    ...opciones,
    headers: {
      "content-type": "application/json",
      ...(S.token ? { authorization: "Bearer " + S.token } : {}),
      ...(opciones.headers || {}),
    },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) { salir(); throw new Error("Sesión expirada"); }
  if (!r.ok) {
    /* El error lleva consigo la respuesta completa: así quien lo atrapa puede
       usar, por ejemplo, el cliente repetido que devolvió el servidor. */
    const e = new Error(datos.error || "Error " + r.status);
    e.datos = datos;
    e.status = r.status;
    throw e;
  }
  return datos;
}

/* Bloquea un botón mientras se guarda. Sin esto, dos toques seguidos en un
   teléfono con señal lenta mandan dos altas y se duplica el registro. */
async function conBoton(boton, trabajo, textoOcupado = "Guardando…") {
  if (!boton) return trabajo();
  if (boton.disabled) return;                 // ya se está guardando
  const antes = boton.textContent;
  boton.disabled = true;
  boton.textContent = textoOcupado;
  try { return await trabajo(); }
  finally { boton.disabled = false; boton.textContent = antes; }
}

/* Texto normalizado para buscar: sin acentos y en minúsculas. */
const paraBuscar = (v) => String(v || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/* ---------------- avisos ---------------- */
function aviso(el, texto, tipo = "err") {
  const n = $(el);
  n.className = "aviso " + tipo + (texto ? " on" : "");
  n.textContent = texto || "";
}

/* Licencia vencida: la aplicación queda congelada. No se esconde nada ni se
   borra nada; simplemente deja de operar y lo único que sigue vivo es la
   descarga del respaldo, porque esa información es del cliente. */
function pantallaCongelada(lic) {
  S.licencia = lic;
  document.body.classList.add("demo", "congelada");
  const gate = $("#gate");
  if (gate) gate.hidden = true;
  const app = $("#app");
  app.classList.add("on");
  const suspendida = lic.motivo === "suspendida";
  app.innerHTML = `
    <div class="congelado">
      <h2>${suspendida ? "Acceso suspendido"
                       : lic.demo ? "La demostración terminó" : "Tu licencia venció"}</h2>
      <p>${suspendida
            ? "El acceso a la aplicación está suspendido."
            : `La licencia venció el <b>${esc(fechaLarga(lic.vence))}</b>, así que la aplicación
               dejó de operar.`}
         <b>Tu información no se borró:</b> sigue guardada tal como la dejaste y vuelve completa
         el día que se reactive.</p>
      ${lic.contacto ? `<p>Para reactivarla, escríbenos al <b>${esc(lic.contacto)}</b>.</p>` : ""}
      <p>Mientras tanto puedes descargarla completa —clientes, cotizaciones, catálogo,
         almacén y vales— en un archivo que es tuyo.</p>
      <button class="btn pri" onclick="descargarRespaldo(this)">Descargar mi respaldo</button>
      <button class="btn sec" onclick="salir()">Cerrar sesión</button>
    </div>`;
}

/* ---------------- acceso ---------------- */
/* ¿Vienen de un enlace de invitación? El código viaja en la dirección:
   .../?activar=CODIGO  — se atiende antes que cualquier otra cosa. */
async function tramitarInvitacion() {
  const codigo = new URLSearchParams(location.search).get("activar");
  if (!codigo) return false;
  api("estado").then((e) => { prenderMarca(e.marca); prenderDemo(e.demo, e.licencia); }).catch(() => {});
  $("#formLogin").hidden = true;
  $("#formSetup").hidden = true;
  $("#gateTitulo").textContent = "Estrena tu cuenta";
  try {
    const quien = await api("activacion?codigo=" + encodeURIComponent(codigo));
    $("#gateSub").textContent = "Elige la contraseña con la que vas a entrar";
    $("#activarQuien").textContent = `${quien.nombre} · ${quien.correo}`;
    $("#formActivar").hidden = false;
    S.codigoInvitacion = codigo;
  } catch (x) {
    $("#gateSub").textContent = "";
    aviso("#gateError", x.message);
    $("#formLogin").hidden = false;
    $("#gateTitulo").textContent = "Cotizador";
  }
  return true;
}

async function arrancar() {
  if (await tramitarInvitacion()) return;
  if (S.token) {
    try {
      const { usuario, licencia } = await api("yo");
      S.yo = usuario;
      api("estado").then((e) => { prenderMarca(e.marca); prenderDemo(e.demo, e.licencia); }).catch(() => {});
      if (licencia && licencia.vencida) return pantallaCongelada(licencia);
      return entrar();
    } catch { localStorage.removeItem("mc_token"); S.token = null; }
  }
  try {
    const { instalado, demo, licencia, marca } = await api("estado");
    prenderMarca(marca);
    prenderDemo(demo, licencia);
    if (!instalado) {
      $("#formLogin").hidden = true;
      $("#formSetup").hidden = false;
      $("#gateTitulo").textContent = "Configuración inicial";
      $("#gateSub").textContent = "Crea la cuenta del administrador general";
    }
  } catch { aviso("#gateError", "No se pudo conectar con el servidor."); }
}

$("#formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  aviso("#gateError", "");
  const d = Object.fromEntries(new FormData(e.target));
  try {
    const { token, usuario } = await api("login", { method: "POST", body: d });
    S.token = token; S.yo = usuario;
    localStorage.setItem("mc_token", token);
    const est = await api("estado").catch(() => ({}));
    prenderMarca(est.marca);
    prenderDemo(est.demo, est.licencia);
    if (est.licencia && est.licencia.vencida) return pantallaCongelada(est.licencia);
    entrar();
  } catch (x) { aviso("#gateError", x.message); }
});

$("#formActivar").addEventListener("submit", async (e) => {
  e.preventDefault();
  aviso("#gateError", "");
  const d = Object.fromEntries(new FormData(e.target));
  if (d.password !== d.password2) return aviso("#gateError", "Las dos contraseñas no son iguales.");
  try {
    const { token, usuario } = await api("activar", {
      method: "POST", body: { codigo: S.codigoInvitacion, password: d.password },
    });
    S.token = token; S.yo = usuario;
    localStorage.setItem("mc_token", token);
    /* Se limpia la dirección para que el enlace no quede en el historial. */
    history.replaceState(null, "", location.pathname);
    const est = await api("estado").catch(() => ({}));
    prenderMarca(est.marca);
    prenderDemo(est.demo, est.licencia);
    entrar();
  } catch (x) { aviso("#gateError", x.message); }
});

$("#formSetup").addEventListener("submit", async (e) => {
  e.preventDefault();
  aviso("#gateError", "");
  const d = Object.fromEntries(new FormData(e.target));
  try {
    const { token, usuario } = await api("setup", { method: "POST", body: d });
    S.token = token; S.yo = usuario;
    localStorage.setItem("mc_token", token);
    entrar();
  } catch (x) { aviso("#gateError", x.message); }
});

function salir() {
  localStorage.removeItem("mc_token");
  S.token = null; S.yo = null;
  location.reload();
}
$("#btnSalir").addEventListener("click", salir);

async function entrar() {
  $("#gate").style.display = "none";
  $("#app").classList.add("on");
  $("#quienSoy").textContent = `${S.yo.nombre} · ${ROL_NOMBRE[S.yo.rol] || "Vendedor"}`;
  configurarTabs();
  await Promise.all([cargarCatalogo(), cargarClientes(), cargarConfig()]);
  ir("panel");
}

/* Las pestañas dependen del puesto: el almacén no cotiza, así que esa
   pestaña ni se le muestra. El servidor la niega de todas formas. */
function configurarTabs() {
  const ocultas = esAlmacen() ? ["cot"] : [];
  let visibles = 0;
  $$("#tabs button").forEach((b) => {
    b.hidden = ocultas.includes(b.dataset.v);
    if (!b.hidden) visibles++;
  });
  $("#tabs").style.gridTemplateColumns = `repeat(${visibles}, 1fr)`;
}

/* ---------------- navegación ---------------- */
let vistaActual = "panel";
$$("#tabs button").forEach((b) =>
  b.addEventListener("click", () => ir(b.dataset.v)));

function ir(v) {
  vistaActual = v;
  $$(".vista").forEach((s) => (s.hidden = true));
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  const destino = $("#v-" + v);
  if (destino) destino.hidden = false;
  window.scrollTo(0, 0);
  const conFab = (v === "cot" && !esAlmacen()) || (v === "cli" && !esAlmacen()) || (v === "inv" && mueveAlmacen());
  $("#fab").hidden = !conFab;
  $("#fab").onclick = v === "cot" ? menuNueva : v === "cli" ? () => formCliente() : v === "inv" ? menuVale : null;
  if (v === "panel") verPanel();
  if (v === "cot") verCotizaciones();
  if (v === "cli") verClientes();
  if (v === "inv") verInventario();
  if (v === "mas") verMas();
}

/* El sitio de demostración se marca solo: el servidor avisa si Netlify tiene
   MODO_DEMO = 1. No se puede encender desde la app. */
/* "2026-08-01" → "1 de agosto de 2026". Una fecha así se lee de un vistazo;
   la otra hay que descifrarla. */
const fechaLarga = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return String(iso || "");
  const MES = ["enero","febrero","marzo","abril","mayo","junio",
               "julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MES[m - 1]} de ${a}`;
};

/* Pinta el logo y el nombre de la empresa en la pantalla de acceso y en la
   barra de arriba, con lo que el servidor manda antes de iniciar sesión. */
function prenderMarca(marca) {
  if (!marca) return;
  const nombre = String(marca.razon_social || "").trim();
  const logo = String(marca.logo || "").trim();
  if (nombre) {
    document.title = "Cotizador · " + nombre;
    const t = $("#gateTitulo");
    if (t && t.textContent.includes("Marcelestial")) t.textContent = nombre;
  }
  if (logo) {
    /* Ojo con el selector: la firma del desarrollador vive dentro de #gate y
       NO debe cambiar de logo. Con «#gate img» a secas, la instalación de un
       cliente terminaba firmando con su propio logo la línea que dice
       «Una aplicación de Comercializadora Marcelestial». */
    for (const img of document.querySelectorAll("#gate .gate-card img, header.top img"))
      img.src = logo;
  }
}

function prenderDemo(esDemo, lic) {
  S.demo = !!esDemo;
  S.licencia = lic || null;
  document.body.classList.toggle("demo", S.demo);
  const cinta = $("#cintaDemo");

  /* Instalación de trabajo dentro de los días de gracia: no lleva los sellos de
     demostración, pero sí un aviso, porque a alguien se le pasó renovar y en
     unos días se apaga. Sin esto, el corte llegaría sin advertencia. */
  if (!S.demo && lic && lic.enGracia && cinta) {
    document.body.classList.add("demo");
    cinta.hidden = false;
    cinta.textContent = "TU LICENCIA VENCIÓ EL " + fechaLarga(lic.vence).toUpperCase() +
      " · SE SUSPENDE EN " + lic.diasDeGracia + (lic.diasDeGracia === 1 ? " DÍA" : " DÍAS") +
      (lic.contacto ? " · ESCRÍBENOS AL " + lic.contacto : "");
    return;
  }

  if (cinta) {
    cinta.hidden = !S.demo;
    const l = S.licencia;
    cinta.textContent = !l || !l.vence
      ? "MODO DEMOSTRACIÓN · los datos son ficticios"
      : l.vencida
        ? "LA DEMOSTRACIÓN VENCIÓ EL " + fechaLarga(l.vence).toUpperCase()
        : "VERSIÓN DE PRUEBA · vence el " + fechaLarga(l.vence) +
          (l.dias >= 0 ? " · faltan " + l.dias + (l.dias === 1 ? " día" : " días") : "");
  }
}

/* Atributos del sello que lleva cada hoja impresa cuando es demostración.
   Se leen desde el CSS, así que no dependen de que cada hoja se acuerde. */
const selloDemo = () => {
  if (!S.demo) return "";
  const l = S.licencia;
  return ` data-sello="DEMOSTRACIÓN\nSIN VALIDEZ COMERCIAL"` +
         ` data-cintilla="Documento de demostración · sin validez comercial${
           l && l.vence ? " · licencia vigente hasta el " + fechaLarga(l.vence) : ""}"`;
};

/* ---------------- datos base ---------------- */
async function cargarCatalogo() {
  try { S.catalogo = (await api("catalogo")).catalogo || []; } catch { S.catalogo = []; }
}
async function cargarClientes() {
  try { S.clientes = (await api("clientes")).clientes || []; } catch { S.clientes = []; }
}
async function cargarConfig() {
  try { S.config = (await api("config")).config || {}; } catch { S.config = {}; }
}
/* Datos de la empresa que firma las propuestas. Viven en config, se editan
   desde Más → Datos de la empresa. Si la instalación todavía no los tiene
   capturados, se cae a los de Marcelestial para no dejar la hoja en blanco. */
const EMPRESA_OMISION = {
  razon_social: "Comercializadora Marcelestial S.A.S.",
  giro: "Perfiles de aluminio · Sistemas fotovoltaicos · Soluciones eléctricas",
  whatsapp: "55 7657 4769",
  correo: "contacto@marcelestial.net",
  web: "www.marcelestial.net",
  cobertura: "CDMX y Estado de México",
  titulo_propuesta: "SISTEMA DE AUTOGENERACIÓN DE ENERGÍA FOTOVOLTAICA SOLAR",
  logo: "",
  mision_titulo: "Energía bien administrada",
  mision_texto: "Ser una solución integral, en México y el mundo, para la administración eficiente de la energía: integramos tecnología fotovoltaica, eólica y sistemas avanzados de almacenamiento para generar ahorros sostenibles, optimizar el uso de los recursos energéticos de nuestros clientes y contribuir activamente al cuidado del medio ambiente, impulsando el desarrollo de una sociedad más próspera, responsable y sustentable.",
  vision_titulo: "Transformar el consumo de energía",
  vision_texto: "Transformar la manera en que las personas, empresas e industrias consumen energía, con estrategias innovadoras que permitan un rápido retorno de inversión y la creación de activos energéticos perdurables. A través de modelos de ahorro compartido y soluciones tecnológicas de última generación, brindamos beneficios económicos inmediatos con una inversión accesible, generando valor sostenible para nuestros clientes.",
  portada: "",
};
/* Ojo con la regla: los valores por omisión SÓLO aplican cuando la instalación
   todavía no tiene capturada la llave 'empresa'. En cuanto una empresa guarda
   sus datos, un campo que dejó vacío sale vacío. Rellenarlo campo por campo
   haría que a un cliente ajeno se le colara el correo o el logo de Marcelestial
   en sus propias cotizaciones. */
const empresa = () => {
  const e = S.config.empresa;
  if (!e || !String(e.razon_social || "").trim()) return { ...EMPRESA_OMISION };
  const v = {};
  for (const k of Object.keys(EMPRESA_OMISION)) v[k] = String(e[k] ?? "").trim();
  return v;
};
/* El logo es el que suba la empresa. Si no subió ninguno, la hoja va sin logo:
   nunca se presta el de otra. El archivo del proyecto sólo se usa mientras la
   instalación siga sin datos capturados. */
const hayEmpresaPropia = () => !!(S.config.empresa && String(S.config.empresa.razon_social || "").trim());
const logoEmpresa = () => empresa().logo || (hayEmpresaPropia() ? "" : "/icons/logo.png");
/* Foto de la banda de la portada. Misma regla que el logo: la de Marcelestial
   sólo se usa mientras la instalación no tenga datos propios. */
const portadaEmpresa = () => empresa().portada || (hayEmpresaPropia() ? "" : "/img/portada.jpg");
/* Etiqueta de imagen del logo, o nada si no hay. */
const imgLogo = (clase = "", estilo = "") => {
  const src = logoEmpresa();
  return src ? `<img ${clase ? `class="${clase}" ` : ""}src="${src}" alt=""${estilo ? ` style="${estilo}"` : ""}>` : "";
};
/* Renglón de contacto: junta sólo lo que esté capturado, sin separadores sueltos. */
const contactoEmpresa = (conEtiqueta = true) => {
  const e = empresa();
  return [e.whatsapp && (conEtiqueta ? "WhatsApp " : "") + e.whatsapp, e.correo, e.web, e.cobertura]
    .filter(Boolean).map(esc).join(" · ");
};
/* Firma discreta del desarrollador al pie de la última hoja. Se apaga por
   instalación con CREDITO_PDF = 0 en Netlify. */
const firmaDesarrollo = () => (S.licencia && S.licencia.creditoPdf === false)
  ? ""
  : `<div class="firma-dev">
       <img src="/icons/logo.png" alt="">
       <span>Propuesta generada con el cotizador de <b>Comercializadora Marcelestial S.A.S.</b></span>
     </div>`;

const pieEmpresa = () => {
  const e = empresa();
  return `<b>${esc(e.razon_social)}</b>${e.giro ? " · " + esc(e.giro) : ""}<br>${contactoEmpresa()}`;
};

/* Misión y visión. Si la empresa no las capturó, la portada sale sin ese
   bloque en lugar de firmar el discurso de otra empresa. Si sólo capturó una
   de las dos, se imprime esa sola a todo el ancho. */
function bloqueMisionVision() {
  const e = empresa();
  const col = (etq, tit, txt) => (tit || txt)
    ? `<div>
         <div class="et">${etq}</div>
         ${tit ? `<div class="tit">${esc(tit)}</div>` : ""}
         ${txt ? `<p>${esc(txt)}</p>` : ""}
       </div>` : "";
  const m = col("Misión", e.mision_titulo, e.mision_texto);
  const v = col("Visión", e.vision_titulo, e.vision_texto);
  if (!m && !v) return "";
  const solaUna = !m || !v;
  return `<div class="mv"${solaUna ? ` style="grid-template-columns:1fr"` : ""}>${m}${v}</div>`;
}

const paramFV = () => S.config.rapido_fotovoltaico || {};
const paramDim = () => S.config.dimensionamiento || {};

/* ---------------- panel ---------------- */
async function verPanel() {
  $("#panelDes").textContent = esDueno() ? "Actividad de todo el equipo"
    : esAlmacen() ? "Movimiento del almacén este mes" : "Resumen de tu actividad";
  $("#panelKpis").innerHTML = '<div class="cargando">Cargando…</div>';
  $("#panelExtra").innerHTML = "";
  try {
    const { resumen, bajoMinimo, porVendedor, almacen } = await api("panel");

    if (esAlmacen() && almacen) {
      const m = almacen.mes || {};
      $("#panelKpis").innerHTML = `
        <div class="kpi"><b>${Number(m.salidas || 0)}</b><span>Vales de salida</span></div>
        <div class="kpi"><b>${Number(m.entradas || 0)}</b><span>Vales de entrada</span></div>
        <div class="kpi"><b>${Number(almacen.piezasMes || 0).toLocaleString("es-MX")}</b><span>Piezas entregadas</span></div>`;
      let html = `<div class="card"><h3>Últimos vales</h3>`;
      if (!(almacen.ultimos || []).length) html += `<div class="vacio">Todavía no hay vales. Toca <b>+</b> en Almacén para el primero.</div>`;
      (almacen.ultimos || []).forEach((v) => {
        html += `<div class="item" style="margin:0;border:0;box-shadow:none;border-radius:0;padding:9px 0;border-bottom:1px dashed var(--line)" onclick="abrirVale(${v.id})">
          <div class="m"><b>${esc(v.folio)} · ${TIPO_VALE[v.tipo] || v.tipo}${v.cancelado_en ? " · CANCELADO" : ""}</b>
          <span>${fecha(v.fecha)} · ${esc(v.cliente || v.obra)}${v.cliente ? " · " + esc(v.obra) : ""}</span></div>
          <div class="r"><b>${Number(v.piezas)}</b><span style="font-size:11px;color:var(--slate)">piezas</span></div></div>`;
      });
      html += `</div>`;
      if (bajoMinimo?.length) {
        html += `<div class="card"><h3>Inventario bajo mínimo</h3>`;
        bajoMinimo.forEach((i) => {
          html += `<div class="row between" style="padding:7px 0;border-bottom:1px dashed var(--line)">
            <div style="min-width:0"><b style="font-size:13.5px">${esc(i.clave)}</b>
            <span style="display:block;font-size:11.5px;color:var(--slate)">${esc(i.descripcion)}</span></div>
            <span class="badge b-bajo">${Number(i.existencia)} / ${Number(i.minimo)}</span></div>`;
        });
        html += `</div>`;
      }
      $("#panelExtra").innerHTML = html;
      return;
    }
    const total = resumen.reduce((a, r) => a + r.n, 0);
    const monto = resumen.reduce((a, r) => a + r.monto, 0);
    const ganadas = resumen.find((r) => r.estatus === "ganada") || { n: 0, monto: 0 };
    $("#panelKpis").innerHTML = `
      <div class="kpi"><b>${total}</b><span>Cotizaciones</span></div>
      <div class="kpi"><b>${ganadas.n}</b><span>Ganadas</span></div>
      <div class="kpi"><b>${money(ganadas.monto)}</b><span>Monto ganado</span></div>`;

    let html = `<div class="card"><h3>Pipeline</h3>`;
    if (!resumen.length) html += `<div class="vacio">Aún no hay cotizaciones.</div>`;
    Object.keys(ESTATUS).forEach((k) => {
      const r = resumen.find((x) => x.estatus === k);
      if (!r) return;
      html += `<div class="row between" style="padding:7px 0;border-bottom:1px dashed var(--line)">
        <span class="badge b-${k}">${ESTATUS[k]}</span>
        <span style="font-size:13px;color:var(--slate)">${r.n} · <b style="color:var(--ink)">${money(r.monto)}</b></span></div>`;
    });
    html += `<div class="row between" style="margin-top:10px;padding-top:10px;border-top:2px solid var(--line)">
      <b style="font-size:13px">Valor total en pipeline</b><b>${money(monto)}</b></div></div>`;

    if (esDueno() && porVendedor?.length) {
      html += `<div class="card"><h3>Por vendedor</h3>`;
      porVendedor.forEach((v) => {
        html += `<div class="row between" style="padding:8px 0;border-bottom:1px dashed var(--line)">
          <div><b style="font-size:14px">${esc(v.nombre)}</b>
          <span style="display:block;font-size:11.5px;color:var(--slate)">${v.n} cotizaciones</span></div>
          <div style="text-align:right"><b style="font-size:14px">${money(v.ganado)}</b>
          <span style="display:block;font-size:11px;color:var(--slate)">ganado</span></div></div>`;
      });
      html += `</div>`;
    }

    if (esDueno() && bajoMinimo?.length) {
      html += `<div class="card"><h3>Inventario bajo mínimo</h3>`;
      bajoMinimo.forEach((i) => {
        html += `<div class="row between" style="padding:7px 0;border-bottom:1px dashed var(--line)">
          <div style="min-width:0"><b style="font-size:13.5px">${esc(i.clave)}</b>
          <span style="display:block;font-size:11.5px;color:var(--slate)">${esc(i.descripcion)}</span></div>
          <span class="badge b-bajo">${Number(i.existencia)} / ${Number(i.minimo)}</span></div>`;
      });
      html += `</div>`;
    }
    $("#panelExtra").innerHTML = html;
  } catch (e) {
    $("#panelKpis").innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

/* ---------------- cotizaciones ---------------- */
async function verCotizaciones() {
  $("#cotDes").textContent = esDueno() ? "Todas las cotizaciones del equipo" : "Tus propuestas técnico-económicas";
  $("#listaCot").innerHTML = '<div class="cargando">Cargando…</div>';
  try {
    const lista = await api("cotizaciones");
    S.cotizaciones = lista.cotizaciones || [];
    S.cotEncontradas = lista.encontradas ?? S.cotizaciones.length;
    S.cotRecortada = !!lista.recortada;
    S.cotCargadas = true;
    if (!S.cotizaciones.length) {
      $("#listaCot").innerHTML = `<div class="vacio">Todavía no hay cotizaciones.<br>Toca el botón <b>+</b> para crear la primera.</div>`;
      return;
    }
    pintarCotizaciones();
  } catch (e) { $("#listaCot").innerHTML = `<div class="vacio">${esc(e.message)}</div>`; }
}

/* El buscador de cotizaciones mira el cliente, el folio y los dos números de
   servicio: el que trae la ficha del cliente y el que se capturó del recibo. */
function pintarCotizaciones() {
  const q = paraBuscar($("#qCot") ? $("#qCot").value : "").trim();
  const lista = !q ? S.cotizaciones : S.cotizaciones.filter((c) => {
    const heno = paraBuscar([c.cliente, c.folio, c.cliente_rpu, c.recibo_rpu,
                             c.vendedor, ESTATUS[c.estatus]].filter(Boolean).join(" "));
    const solo = (v) => String(v || "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const qn = solo(q);
    return heno.includes(q) ||
           (qn.length >= 3 && (solo(c.cliente_rpu).includes(qn) ||
                               solo(c.recibo_rpu).includes(qn) ||
                               solo(c.folio).includes(qn)));
  });

  const cuenta = $("#qCotCuenta");
  if (cuenta) {
    if (S.buscando) cuenta.textContent = "buscando…";
    else if (q) cuenta.textContent = `${lista.length} de ${S.cotEncontradas ?? S.cotizaciones.length}`;
    else if (S.cotRecortada) cuenta.textContent = `${S.cotizaciones.length} de ${S.cotEncontradas}`;
    else cuenta.textContent = "";
  }

  const aviso = (!q && S.cotRecortada)
    ? `<div class="nota-tope">Se muestran las ${S.cotizaciones.length} cotizaciones más recientes
         de ${S.cotEncontradas}. Para ver las anteriores, búscalas por cliente, folio o
         número de servicio: el buscador revisa todo el historial.</div>`
    : "";

  $("#listaCot").innerHTML = aviso + (!lista.length
    ? `<div class="sin-resultados">Ninguna cotización coincide con <b>${esc($("#qCot").value)}</b>.<br>
         Se busca por cliente, folio y número de servicio (RPU).</div>`
    : lista.map((c) => {
        const rpu = c.recibo_rpu || c.cliente_rpu;
        return `
      <div class="item" onclick="abrirCotizacion(${c.id})">
        <div class="m">
          <b>${esc(c.cliente || "Sin cliente")}</b>
          <span>${esc(c.folio)} · ${LINEAS[c.linea] || ""}${c.tipo === "rapida" ? " · rápida" : ""} · ${fecha(c.creado_en)}${esDueno() ? " · " + esc(c.vendedor || "") : ""}</span>
          ${rpu ? `<span>RPU ${esc(rpu)}</span>` : ""}
        </div>
        <div class="r">
          <b>${money(c.total)}</b>
          <span class="badge b-${c.estatus}">${ESTATUS[c.estatus] || c.estatus}</span>
        </div>
      </div>`;
      }).join(""));
}

function nuevaCotizacion() {
  S.editor = {
    id: null, folio: "(nueva)", cliente_id: "", estatus: "borrador",
    tecnico: {}, partidas: [], ahorro: {}, comentarios: "",
  };
  editor();
}

async function abrirCotizacion(id) {
  try {
    const { cotizacion } = await api("cotizacion/" + id);
    S.editor = {
      id: cotizacion.id, folio: cotizacion.folio, cliente_id: cotizacion.cliente_id || "",
      estatus: cotizacion.estatus, tecnico: cotizacion.tecnico || {},
      partidas: cotizacion.partidas || [], ahorro: cotizacion.ahorro || {},
      comentarios: cotizacion.comentarios || "", _full: cotizacion,
    };
    editor();
  } catch (e) { alert(e.message); }
}

const CAMPOS_TEC = [
  ["ubicacion", "Ubicación", "text"],
  ["kwp", "Potencia pico (kWp)", "text"],
  ["produccion", "Producción (kWh bim.)", "text"],
  ["cubierta", "Tipo de cubierta", "select", ["Concreto", "Teja", "Lámina", "Suelo", "Otra"]],
  ["estructura", "Tipo de estructura", "text"],
  ["tension", "Tensión de interconexión", "select", ["220", "440", "Otra"]],
  ["paneles", "Número de paneles", "number"],
  ["wpanel", "Capacidad por panel (W)", "number"],
  ["marcapanel", "Marca y modelo del panel", "text"],
  ["inversores", "Número de inversores", "number"],
  ["capinversor", "Capacidad del inversor", "text"],
  ["marcainversor", "Marca del inversor", "select", ["SMA", "Sungrow", "Solis", "Huawei", "Otra"]],
];

function editor() {
  const e = S.editor;
  const opcCli = S.clientes.map((c) =>
    `<option value="${c.id}" ${String(c.id) === String(e.cliente_id) ? "selected" : ""}>${esc(c.nombre)}</option>`).join("");
  const opcEst = Object.entries(ESTATUS).map(([k, v]) =>
    `<option value="${k}" ${k === e.estatus ? "selected" : ""}>${v}</option>`).join("");

  const tec = CAMPOS_TEC.map(([k, etq, tipo, ops]) => {
    if (tipo === "select")
      return `<label class="f"><span>${etq}</span><select data-tec="${k}"><option value="">—</option>
        ${ops.map((o) => `<option ${e.tecnico[k] === o ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;
    return `<label class="f"><span>${etq}</span><input type="${tipo}" data-tec="${k}" value="${esc(e.tecnico[k] || "")}"></label>`;
  }).join("");

  $("#v-editor").innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <div><h2 class="tit">${e.id ? "Cotización" : "Nueva cotización"}</h2>
      <p class="des" style="margin:0">${esc(e.folio)}</p></div>
      <button class="btn sec sm" onclick="ir('cot')">Cerrar</button>
    </div>
    <div class="aviso" id="edAviso"></div>

    <div class="card">
      <h3>Cliente y estatus</h3>
      ${campoCliente("edCliente", e.cliente_id || "")}
      <button class="btn sec sm" onclick="formCliente()">+ Nuevo cliente</button>
      <label class="f" style="margin-top:12px"><span>Estatus ${pista("ganada")}</span><select id="edEstatus">${opcEst}</select></label>
    </div>

    <div class="card" id="edMaterial" hidden>
      <h3>Material de montaje</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Al ganar el proyecto puedes pedir el riel y los clamps a
        <b>Comercializadora Mar Celestial</b>. La app calcula las piezas a partir de los
        módulos de esta cotización.</p>
      <div id="edMaterialResumen"></div>
    </div>

    <div class="card">
      <h3>Partidas</h3>
      <div id="edPartidas"></div>
      <div class="total-row"><span>Total</span><b id="edTotal">$0.00</b></div>
      <button class="btn pri sm" style="margin-top:12px" onclick="agregarPartida()">+ Agregar concepto</button>
      ${esDueno() ? "" : '<p style="font-size:11.5px;color:var(--slate);margin-top:9px">Los precios los define el administrador. Tú capturas la cantidad.</p>'}
    </div>

    <div class="card">
      <h3>Detalle técnico</h3>
      <div class="grid2">${tec}</div>
    </div>

    <div class="card">
      <h3>Análisis de ahorro</h3>
      <div class="grid2">
        <label class="f"><span>Pago actual a CFE</span><input type="number" id="ahActual" value="${esc(e.ahorro.actual || "")}"></label>
        <label class="f"><span>Pagará con paneles</span><input type="number" id="ahNuevo" value="${esc(e.ahorro.nuevo || "")}"></label>
        <label class="f"><span>Retorno de inversión (años)</span><input type="number" step="0.1" id="ahRoi" value="${esc(e.ahorro.roi || "")}"></label>
        <label class="f"><span>Beneficio anual</span><input type="number" id="ahAnual" value="${esc(e.ahorro.anual || "")}"></label>
      </div>
      <div id="ahResumen" style="font-size:13px;color:var(--slate)"></div>
    </div>

    <div class="card">
      <h3>Foto del equipo</h3>
      <p style="font-size:11.5px;color:var(--slate);margin-bottom:12px">
        La que se imprime en la hoja del final. Se elige del carrete.</p>
      <div class="foto-caja">
        <div id="edProdPrev"></div>
        <div style="flex:1">
          <input type="file" accept="image/*" id="edProd" hidden>
          <div class="acciones">
            <button class="btn sec sm" type="button" onclick="document.getElementById('edProd').click()">
              ${e._full && e._full.foto_producto ? "Cambiar foto" : "Elegir del carrete"}</button>
            <button class="btn dan sm" type="button" id="edProdQuitar" onclick="quitarFotoEditor()" hidden>
              Quitar</button>
          </div>
          <p id="edProdNota" style="font-size:11px;color:var(--slate);margin-top:8px"></p>
        </div>
      </div>
      <p style="font-size:11px;color:var(--slate);margin-top:10px">
        Después de cambiarla, toca <b>Guardar</b>.</p>
    </div>

    <div class="card" id="cardSitio">
      <h3>Vista previa en el techo</h3>
      <p style="font-size:11.5px;color:var(--slate);margin-bottom:12px">
        Sube la foto del techo y marca sus cuatro esquinas. La app dibuja
        <b>los paneles que trae esta cotización</b>, en perspectiva, sobre la imagen real.
        Sirve igual una foto de dron o una vista de satélite de Google Maps.</p>
      <input type="file" accept="image/*" id="edSitioFoto" hidden>
      <div id="sitioVacio">
        <div class="acciones">
          <button class="btn sec sm" type="button" onclick="elegirFotoSitio('dron')">
            Foto de dron</button>
          <button class="btn sec sm" type="button" onclick="elegirFotoSitio('satelite')">
            Imagen de Google Maps</button>
        </div>
      </div>
      <details class="sitio-guia">
        <summary>¿No hay dron? Cómo sacar la imagen y las medidas de Google Maps</summary>
        <ol>
          <li>Abre <b>Google Maps</b> y busca la dirección del cliente.</li>
          <li>Cambia a <b>vista de satélite</b> y acerca hasta que el techo llene la pantalla.</li>
          <li>Captura la pantalla. <b>Deja visible la franja de abajo</b>, donde aparece el
              crédito de Google: esa parte no se puede recortar ni tapar.</li>
          <li>Para las medidas: clic derecho sobre una esquina del techo →
              <b>Medir distancia</b> → clic en la esquina de enfrente. Ése es el
              <b>ancho</b>. Repite para el <b>fondo</b>.</li>
          <li>Sube aquí la captura con el botón <b>Imagen de Google Maps</b> y captura
              esas dos medidas.</li>
        </ol>
        <p class="sitio-ojo">⚠ Usa <b>Google Maps</b>, no <b>Google Earth</b>: las imágenes de
          Google Earth no se permiten con fines comerciales ni promocionales. Las capturas de
          Maps sí pueden usarse en propuestas y documentos de la empresa, siempre que se
          conserve el crédito a Google.</p>
        <p class="sitio-ojo">La vista de satélite puede tener meses o años de antigüedad y no
          muestra sombras, tuberías ni instalaciones nuevas: la distribución final se define
          en la visita técnica.</p>
      </details>
      <div id="sitioTrabajo" hidden>
        <label class="sitio-fuente">
          <input type="checkbox" id="sitioSatelite">
          <span>Esta imagen viene de <b>Google Maps</b> — se respeta y se vuelve a escribir
            el crédito de Google sobre el montaje.</span>
        </label>
        <p class="sitio-paso" id="sitioPaso"></p>
        <canvas id="sitioLienzo" class="sitio-lienzo"></canvas>
        <div class="acciones" style="margin:10px 0">
          <button class="btn sec sm" type="button" id="btnRemarcar"
                  onclick="reiniciarEsquinas()">Volver a marcar</button>
          <button class="btn sec sm" type="button" id="btnArea" onclick="agregarArea()">
            Agregar otra área</button>
          <button class="btn pri sm" type="button" id="btnAcomodar" hidden
                  onclick="modoAcomodar()">Acomodar los paneles</button>
          <button class="btn sec sm" type="button" id="btnMarcar" hidden
                  onclick="modoMarcar()">Volver a las esquinas</button>
          <button class="btn sec sm" type="button" onclick="document.getElementById('edSitioFoto').click()">
            Cambiar foto</button>
          <button class="btn dan sm" type="button" onclick="quitarSitio()">Quitar</button>
        </div>
        <p class="sitio-ayuda">¿Techo a dos aguas, o nave más patio? Marca una caída, toca
          <b>Agregar otra área</b> y marca la siguiente. Los módulos de la cotización se
          reparten solos entre ellas; si quieres otro reparto, escribe cuántos van en cada una.</p>
        <div id="sitioAreas"></div>
        <p class="sitio-nota" id="sitioCaben"></p>
        <div class="acciones">
          <button class="btn pri sm" type="button" onclick="verVistaSitio(this)">Ver cómo queda</button>
        </div>
        <div id="sitioResultado"></div>
      </div>
    </div>

    ${e._full && e._full.recibo_foto ? `
    <div class="card">
      <h3>Foto del recibo</h3>
      <p style="font-size:11.5px;color:var(--slate);margin-bottom:10px">
        Respaldo interno. <b>No sale en el PDF del cliente.</b></p>
      <a href="${e._full.recibo_foto}" target="_blank" rel="noopener">
        <img src="${e._full.recibo_foto}" alt="Recibo de CFE"
             style="width:100%;border-radius:10px;border:1px solid #d4dde9"></a>
    </div>` : ""}

    <div class="card">
      <h3>Comentarios</h3>
      <textarea id="edComentarios" placeholder="Requerimientos extra, condiciones especiales…">${esc(e.comentarios)}</textarea>
    </div>

    <div class="acciones" style="margin-bottom:30px">
      <button class="btn pri" onclick="guardarCotizacion(this)">Guardar</button>
      ${e.id ? `<button class="btn sec" onclick="imprimirCotizacion()">Vista previa</button>
                ${e._full && e._full.recibo_foto
                  ? `<button class="btn sec" onclick="imprimirCotizacion(true)"
                       title="Uso interno: incluye la foto del recibo">Vista previa con recibo</button>` : ""}
                <button class="btn sec" onclick="verSeguimiento(${e.id})">Seguimiento</button>
                <button class="btn dan" onclick="borrarCotizacion()">Borrar</button>` : ""}
    </div>`;

  $$(".vista").forEach((s) => (s.hidden = true));
  $("#v-editor").hidden = false;
  $("#fab").hidden = true;
  window.scrollTo(0, 0);
  activarBuscadorCliente("edCliente");
  pintarPartidas();
  pintarMaterial();
  $("#edEstatus")?.addEventListener("change", () => {
    S.editor.estatus = $("#edEstatus").value;
    pintarMaterial();
  });
  S.edFotoProd = (e._full && e._full.foto_producto) || null;
  $("#edProd")?.addEventListener("change", tomarFotoEditor);
  pintarFotoEditor();

  /* vista previa en el techo */
  S.edSitioFoto = (e._full && e._full.foto_sitio) || null;
  /* lo guardado puede venir en la forma vieja (un área suelta): se normaliza
     siempre a una lista de áreas, para que el resto del código sea uno solo. */
  S.edSitio = (e._full && e._full.sitio)
    ? {
        fuente: e._full.sitio.fuente === "satelite" ? "satelite" : "dron",
        ancho_foto: e._full.sitio.ancho_foto || 0,
        alto_foto: e._full.sitio.alto_foto || 0,
        areas: MCSitio.areasDe(e._full.sitio).map((a) => ({ paneles: 0, ...a })),
      }
    : null;
  S.edSitioImagen = null;
  S.edSitioModo = "marcar";
  S.edSitioArrastre = null;
  S.edSitioCeldas = [];
  $("#edSitioFoto")?.addEventListener("change", tomarFotoSitio);
  const lz = $("#sitioLienzo");
  if (lz) {
    /* Marcar esquinas: un toque. Acomodar: arrastrar o tocar un módulo. */
    lz.addEventListener("click", (ev) => { if (S.edSitioModo !== "acomodar") tocarLienzo(ev); });
    lz.addEventListener("touchstart", (ev) => {
      if (S.edSitioModo === "acomodar") { empezarToque(ev); return; }
      ev.preventDefault(); tocarLienzo(ev);
    }, { passive: false });
    lz.addEventListener("touchmove", moverToque, { passive: false });
    lz.addEventListener("touchend", soltarToque);
    lz.addEventListener("touchcancel", soltarToque);
    lz.addEventListener("mousedown", empezarToque);
    lz.addEventListener("mousemove", moverToque);
    window.addEventListener("mouseup", soltarToque);
  }
  if (S.edSitio && $("#sitioSatelite")) $("#sitioSatelite").checked = S.edSitio.fuente === "satelite";
  $("#sitioSatelite")?.addEventListener("change", (ev) => {
    if (!S.edSitio) return;
    S.edSitio.fuente = ev.target.checked ? "satelite" : "dron";
  });
  pintarSitio();
  ["ahActual", "ahNuevo"].forEach((id) => $("#" + id).addEventListener("input", calcAhorro));
  calcAhorro();
}

function calcAhorro() {
  const a = numero($("#ahActual")?.value), n = numero($("#ahNuevo")?.value);
  const r = $("#ahResumen");
  if (!r) return;
  if (a > 0 && n >= 0 && a >= n) {
    const pct = Math.round(((a - n) / a) * 100);
    r.innerHTML = `Ahorro por periodo: <b style="color:var(--ok)">${money(a - n)}</b> · <b>${pct}%</b> menos que hoy.`;
  } else r.textContent = "";
}

/* ---------------- material de montaje y orden de compra ----------------
   La tarjeta sólo aparece cuando la cotización está ganada y ya se guardó:
   antes de eso no hay proyecto que surtir. */
async function pintarMaterial() {
  const caja = $("#edMaterial");
  if (!caja) return;
  const e = S.editor;
  const modulos = Number(e.tecnico?.paneles) || 0;
  const listo = e.id && e.estatus === "ganada";
  caja.hidden = !listo;
  if (!listo) return;

  const cuerpo = $("#edMaterialResumen");
  if (!modulos) {
    cuerpo.innerHTML = `<p style="font-size:13px;color:var(--slate)">
      Esta cotización no tiene capturado el número de módulos, así que no se puede
      calcular el material. Escríbelo en <b>Detalle técnico → Número de paneles</b>
      y guarda.</p>`;
    return;
  }

  /* ¿ya se pidió? */
  let orden = null;
  try {
    const { ordenes } = await api("ordenes");
    orden = (ordenes || []).find((o) => o.cotizacion_id === e.id && !o.cancelado_en) || null;
  } catch { /* si falla, se ofrece generarla */ }

  if (orden) {
    cuerpo.innerHTML = `
      <div class="dato-fijo" style="margin-bottom:12px">
        Orden <b>${esc(orden.folio)}</b> · ${orden.modulos} módulos · ${money(orden.total)} con IVA
        ${orden.enviada_en ? '<br><span style="color:var(--exito,#1F7A4D);font-weight:600">Ya enviada al proveedor</span>' : ""}
      </div>
      <div class="acciones">
        <button class="btn pri sm" onclick="verOrden(${orden.id})">Ver la orden</button>
        <button class="btn sec sm" onclick="cancelarOrden(${orden.id})">Cancelar orden</button>
      </div>`;
    return;
  }

  /* Las hileras importan: los puntos de sujeción interiores se comparten entre
     paneles vecinos, así que el material NO es proporcional a los módulos. */
  const hileras = Math.max(1, Math.min(modulos, Number(S.edHileras) || 1));
  try {
    const { partidas, catalogo } = await api(`material?modulos=${modulos}&hileras=${hileras}`);
    const sub = partidas.reduce((a, p) => a + p.importe, 0);
    const iva = sub * (Number(catalogo.iva) || 0);
    cuerpo.innerHTML = `
      <label class="f"><span>¿En cuántas hileras van los ${modulos} paneles? ${pista("hileras")}</span>
        <input type="number" min="1" max="${modulos}" id="edHileras" value="${hileras}"
               onchange="cambiarHileras(this.value)">
        <small style="color:var(--slate)">Los clamps de en medio sujetan dos paneles a la vez,
        así que a más hileras, más piezas. Cuéntalas en el techo.</small></label>
      <table class="tabla-mini">
        <tr><th>Material</th><th>Cant.</th><th>P. unit.</th><th>Importe</th></tr>
        ${partidas.map((p) => `<tr>
          <td>${esc(p.nombre)}<small>2 por panel + 2 por hilera</small></td>
          <td>${p.cantidad}</td><td>${money(p.precio)}</td><td>${money(p.importe)}</td>
        </tr>`).join("")}
        <tr class="suma"><td colspan="3">Subtotal</td><td>${money(sub)}</td></tr>
        <tr class="suma"><td colspan="3">IVA</td><td>${money(iva)}</td></tr>
        <tr class="suma tot"><td colspan="3">Total</td><td>${money(sub + iva)}</td></tr>
      </table>
      <button class="btn pri" style="margin-top:14px" onclick="generarOrden()">
        Generar orden de compra</button>`;
  } catch (x) {
    cuerpo.innerHTML = `<p style="font-size:13px;color:var(--slate)">${esc(x.message)}</p>`;
  }
}

/* Hoja imprimible de la orden de compra. Va dirigida al proveedor, así que
   arriba manda SU marca, no la de la empresa que la emite. */
window.verOrden = async (id) => {
  try {
    const { orden, catalogo } = await api("orden/" + id);
    const pv = catalogo.proveedor || {};
    const cancelada = !!orden.cancelado_en;
    $("#doc").innerHTML = `
      <div class="hoja orden ${cancelada ? "cancelado" : ""}"${selloDemo()}>
        <div class="dh">
          <div>
            <h1>Orden de compra</h1>
            <div style="font-size:11.5px;color:#6b7280;margin-top:4px">
              Folio <b>${esc(orden.folio)}</b> · ${fecha(orden.creado_en)}</div>
          </div>
          ${imgLogo()}
        </div>

        <div class="oc-partes">
          <div>
            <div class="et">Proveedor</div>
            <b>${esc(pv.razon_social || "")}</b>
            <span>${esc(pv.giro || "")}</span>
            <span>${[pv.whatsapp && "WhatsApp " + pv.whatsapp, pv.correo, pv.web].filter(Boolean).map(esc).join(" · ")}</span>
          </div>
          <div>
            <div class="et">Solicita</div>
            <b>${esc(empresa().razon_social)}</b>
            <span>${contactoEmpresa()}</span>
            <span>Atiende: ${esc(orden.usuario || "")}</span>
          </div>
        </div>

        <div class="oc-obra">
          <div><span>Obra</span><b>${esc(orden.obra || orden.cliente || "—")}</b></div>
          <div><span>Módulos del proyecto</span><b>${orden.modulos}</b></div>
          <div><span>Cotización</span><b>${esc(orden.cotizacion_folio || "—")}</b></div>
        </div>

        <table class="oc-tabla">
          <thead><tr>
            <th>Clave</th><th>Material</th><th>Cant.</th><th>Unidad</th>
            <th>P. unitario</th><th>Importe</th>
          </tr></thead>
          <tbody>
            ${(orden.partidas || []).map((p) => `<tr>
              <td>${esc(p.clave)}</td>
              <td><b>${esc(p.nombre)}</b>${p.detalle ? `<small>${esc(p.detalle)}</small>` : ""}</td>
              <td class="n">${p.cantidad}</td>
              <td class="n">${esc(p.unidad)}</td>
              <td class="n">${money(p.precio)}</td>
              <td class="n">${money(p.importe)}</td>
            </tr>`).join("")}
          </tbody>
          <tfoot>
            <tr><td colspan="5">Subtotal</td><td class="n">${money(orden.subtotal)}</td></tr>
            <tr><td colspan="5">IVA</td><td class="n">${money(orden.iva)}</td></tr>
            <tr class="tot"><td colspan="5">Total</td><td class="n">${money(orden.total)}</td></tr>
          </tfoot>
        </table>

        ${orden.notas ? `<p class="oc-notas"><b>Notas:</b> ${esc(orden.notas)}</p>` : ""}
        ${cancelada ? `<p class="oc-notas"><b>Cancelada:</b> ${esc(orden.cancelado_motivo || "")}</p>` : ""}

        <p class="oc-notas">Precios sujetos a los escalones de volumen vigentes del proveedor.
        Cantidades calculadas para ${orden.modulos} paneles en ${orden.hileras}
        ${orden.hileras === 1 ? "hilera" : "hileras"}, a razón de 2 piezas por panel más 2 por hilera:
        los puntos de sujeción interiores los comparten dos paneles vecinos.
        Confirmar contra el levantamiento en sitio antes de surtir.</p>

        <div class="pie">${pieEmpresa()}</div>
      </div>`;
    abrirPrevia(orden.folio);
    /* Se marca como enviada en cuanto se abre para imprimir o compartir: es el
       momento en que sale del teléfono hacia el proveedor. */
    if (!orden.enviada_en && !cancelada) {
      try { await api("orden/" + id + "/enviada", { method: "POST" }); } catch {}
    }
  } catch (x) { alert(x.message); }
};

window.cambiarHileras = (v) => { S.edHileras = Number(v) || 1; pintarMaterial(); };

window.generarOrden = async () => {
  const e = S.editor;
  if (!e.id) return alert("Guarda la cotización antes de pedir el material.");
  const obra = prompt("¿Para qué obra es el material? (aparece en la orden)",
                      S.clientes.find((c) => String(c.id) === String(e.cliente_id))?.nombre || "");
  if (obra === null) return;
  try {
    const { orden } = await api("ordenes", { method: "POST",
      body: { cotizacion_id: e.id, obra, modulos: Number(e.tecnico?.paneles) || 0,
              hileras: Math.max(1, Number(S.edHileras) || 1) } });
    await pintarMaterial();
    verOrden(orden.id);
  } catch (x) { alert(x.message); }
};

window.cancelarOrden = async (id) => {
  const motivo = prompt("¿Por qué se cancela la orden?");
  if (!motivo) return;
  try {
    await api("orden/" + id + "/cancelar", { method: "POST", body: { motivo } });
    await pintarMaterial();
  } catch (x) { alert(x.message); }
};

function pintarPartidas() {
  const cont = $("#edPartidas");
  if (!cont) return;
  const p = S.editor.partidas;
  if (!p.length) { cont.innerHTML = '<div class="vacio" style="padding:18px">Sin conceptos todavía.</div>'; }
  else {
    cont.innerHTML = p.map((x, i) => `
      <div class="partida">
        <div class="d"><b>${esc(x.descripcion)}</b><span>${esc(x.clave)} · ${esc(x.unidad || "PZA")}</span></div>
        <input type="number" min="0" step="0.01" value="${x.cantidad}" onchange="cambiarCantidad(${i},this.value)">
        ${esDueno() ? `<input type="number" min="0" step="0.01" value="${x.precio}" onchange="cambiarPrecio(${i},this.value)">`
                    : `<div class="imp">${money(numero(x.cantidad) * numero(x.precio))}</div>`}
        <button class="x" onclick="quitarPartida(${i})">×</button>
      </div>`).join("");
  }
  const total = p.reduce((a, x) => a + numero(x.cantidad) * numero(x.precio), 0);
  $("#edTotal").textContent = money(total);
}

window.cambiarCantidad = (i, v) => { S.editor.partidas[i].cantidad = numero(v); pintarPartidas(); };
window.cambiarPrecio = (i, v) => { S.editor.partidas[i].precio = numero(v); pintarPartidas(); };
window.quitarPartida = (i) => { S.editor.partidas.splice(i, 1); pintarPartidas(); };

function agregarPartida() {
  const activos = S.catalogo.filter((c) => c.activo);
  abrirModal("Agregar concepto", `
    <input id="buscaCat" placeholder="Buscar por clave o descripción…" style="margin-bottom:12px">
    <div id="resCat" style="max-height:52vh;overflow:auto"></div>`);
  const pintar = (f = "") => {
    const t = f.toLowerCase();
    const lista = activos.filter((c) =>
      !t || c.clave.toLowerCase().includes(t) || c.descripcion.toLowerCase().includes(t));
    $("#resCat").innerHTML = lista.length ? lista.map((c) => `
      <div class="item" onclick="elegirConcepto(${c.id})">
        <div class="m"><b>${esc(c.descripcion)}</b>
        <span>${esc(c.clave)} · ${esc(c.categoria)}${c.controla_inventario ? ` · existencia ${Number(c.existencia)}` : ""}</span></div>
        <div class="r"><b>${money(c.precio)}</b><span style="font-size:11px;color:var(--slate)">${esc(c.unidad)}</span></div>
      </div>`).join("") : '<div class="vacio">Sin resultados</div>';
  };
  pintar();
  $("#buscaCat").addEventListener("input", (e) => pintar(e.target.value));
}

window.elegirConcepto = (id) => {
  const c = S.catalogo.find((x) => x.id === id);
  if (!c) return;
  S.editor.partidas.push({
    catalogo_id: c.id, clave: c.clave, descripcion: c.descripcion,
    unidad: c.unidad, precio: Number(c.precio), cantidad: 1,
  });
  cerrarModal();
  pintarPartidas();
};

async function guardarCotizacion(boton) {
  return conBoton(boton, () => _guardarCotizacion());
}

async function _guardarCotizacion() {
  S.cotCargadas = false;   /* la lista en memoria quedó vieja */
  const e = S.editor;
  e.cliente_id = $("#edCliente").value;
  e.estatus = $("#edEstatus").value;
  e.comentarios = $("#edComentarios").value;
  e.tecnico = {};
  $$("[data-tec]").forEach((i) => { if (i.value) e.tecnico[i.dataset.tec] = i.value; });
  e.ahorro = {
    actual: numero($("#ahActual").value), nuevo: numero($("#ahNuevo").value),
    roi: numero($("#ahRoi").value), anual: numero($("#ahAnual").value),
  };
  if (S.edFotoProd !== undefined) e.foto_producto = S.edFotoProd;
  if (S.edSitioFoto !== undefined) e.foto_sitio = S.edSitioFoto;
  if (S.edSitioFoto === "" || S.edSitio === null) e.sitio = null;
  else if (S.edSitio && (S.edSitio.areas || []).length &&
           S.edSitio.areas.every((a) => (a.esquinas || []).length === 4)) e.sitio = S.edSitio;
  if (!e.cliente_id) return aviso("#edAviso", "Selecciona un cliente antes de guardar.");
  if (!e.partidas.length) return aviso("#edAviso", "Agrega al menos un concepto.");
  try {
    if (e.id) {
      await api("cotizaciones", { method: "PATCH", body: e });
      aviso("#edAviso", "Cambios guardados.", "ok");
    } else {
      const { cotizacion } = await api("cotizaciones", { method: "POST", body: e });
      S.editor.id = cotizacion.id; S.editor.folio = cotizacion.folio;
      aviso("#edAviso", "Cotización creada: " + cotizacion.folio, "ok");
      setTimeout(() => abrirCotizacion(cotizacion.id), 700);
    }
  } catch (x) { aviso("#edAviso", x.message); }
}

async function borrarCotizacion() {
  S.cotCargadas = false;   /* la lista en memoria quedó vieja */
  if (!confirm("¿Borrar esta cotización? No se puede deshacer.")) return;
  try { await api("cotizaciones?id=" + S.editor.id, { method: "DELETE" }); ir("cot"); }
  catch (e) { aviso("#edAviso", e.message); }
}

/* ---------------- documento imprimible ---------------- */
/* conRecibo = true sólo desde el botón "PDF con recibo", que es de uso interno.
   El PDF que se le manda al cliente nunca lleva la foto de su recibo. */
async function imprimirCotizacion(conRecibo = false) {
  let c = S.editor._full;
  try { c = (await api("cotizacion/" + S.editor.id)).cotizacion; } catch {}
  const partidas = c.partidas || [];
  const total = partidas.reduce((a, p) => a + numero(p.cantidad) * numero(p.precio), 0);
  const t = c.tecnico || {}, ah = c.ahorro || {};
  const campo = (k, v) => v ? `<div><span>${k}</span><b>${esc(v)}</b></div>` : "";
  /* La superficie que ocupa el arreglo: número de módulos × los m² por panel que
     están en los parámetros del dimensionamiento (3.1 m² si no se cambiaron). */
  const m2Panel = Number(paramDim().m2_por_panel) || 3.1;
  const nPaneles = numero(t.paneles);
  const superficie = nPaneles > 0
    ? (nPaneles * m2Panel).toLocaleString("es-MX", { maximumFractionDigits: 1 }) + " m²" : "";

  $("#doc").innerHTML = `
    ${hojaPortada(c)}
    <div class="hoja"${selloDemo()}>
      <div class="dh">
        <div>
          <h1>Propuesta técnica-económica</h1>
          <div style="font-size:11.5px;color:#6b7280;margin-top:4px">
            Sistema de autogeneración de energía fotovoltaica solar</div>
        </div>
        ${imgLogo()}
      </div>

      <div class="campos">
        ${campo("Folio", c.folio)}
        ${campo("Fecha", fecha(c.creado_en))}
        ${campo("Cliente", c.cliente_nombre)}
        ${campo("No. de servicio (RPU)", c.cliente_referencia)}
        ${campo("Dirección", c.cliente_direccion)}
        ${campo("Atiende", c.vendedor_nombre)}
      </div>

      <h2>Oferta económica</h2>
      <table>
        <tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Importe</th></tr>
        ${partidas.map((p) => `<tr>
          <td>${esc(p.descripcion)}<br><span style="font-size:10px;color:#6b7280">${esc(p.clave)}</span></td>
          <td class="n">${numero(p.cantidad)} ${esc(p.unidad || "")}</td>
          <td class="n">${money(numero(p.cantidad) * numero(p.precio))}</td></tr>`).join("")}
        <tr class="tot"><td colspan="2">TOTAL MXN NETO</td><td class="n">${money(total)}</td></tr>
      </table>

      ${Object.keys(t).length ? `<h2>Detalle técnico</h2><div class="campos">
        ${campo("Ubicación", t.ubicacion)}${campo("Potencia pico", t.kwp ? t.kwp + " kWp" : "")}
        ${campo("Producción", t.produccion ? t.produccion + " kWh bim." : "")}${campo("Tipo de cubierta", t.cubierta)}
        ${campo("Tipo de estructura", t.estructura)}${campo("Tensión de interconexión", t.tension)}
        ${campo("Número de paneles", t.paneles)}${campo("Superficie requerida", superficie)}
        ${campo("Capacidad por panel", t.wpanel ? t.wpanel + " W" : "")}
        ${campo("Marca y modelo del panel", t.marcapanel)}${campo("Número de inversores", t.inversores)}
        ${campo("Capacidad del inversor", t.capinversor)}${campo("Marca del inversor", t.marcainversor)}
      </div>
      ${superficie ? `<p style="font-size:10.5px;color:#6b7280;margin-top:7px;line-height:1.5">
        <b>Superficie requerida:</b> área aproximada del arreglo, a razón de ${m2Panel} m² por
        módulo con su separación entre hileras. Pasillos de servicio y áreas libres por sombras
        se definen en la visita técnica.</p>` : ""}` : ""}

      ${(ah.actual || ah.roi) ? `<h2>Análisis de ahorro</h2><div class="campos">
        ${campo("Pago actual a CFE", ah.actual ? money(ah.actual) : "")}
        ${campo("Pagará con sistema FV", ah.nuevo || ah.nuevo === 0 ? money(ah.nuevo) : "")}
        ${campo("Ahorro por periodo", ah.actual ? money(numero(ah.actual) - numero(ah.nuevo)) : "")}
        ${campo("Cobertura de su consumo", ah.cobertura ? ah.cobertura + " %" : "")}
        ${campo("Precio de referencia", ah.precio_kwh ? "$" + ah.precio_kwh + " / kWh" : "")}
        ${campo("Retorno de inversión", ah.roi ? ah.roi + " años" : "")}
        ${campo("Beneficio anual promedio", ah.anual ? money(ah.anual) : "")}
      </div>
      ${ah.cobertura && Number(ah.cobertura) < 100 ? `
        <p style="font-size:10.5px;color:#6b7280;margin-top:7px;line-height:1.5">
          El sistema propuesto cubre el ${ah.cobertura}% de su consumo actual. El resto se seguirá
          tomando de la red y ya está considerado en el importe indicado arriba. El sistema es
          ampliable si más adelante desea cubrir un porcentaje mayor.</p>` : ""}
      ${ah.nuevo === 0 && ah.actual ? `
        <p style="font-size:10.5px;color:#6b7280;margin-top:7px;line-height:1.5">
          El sistema cubre la totalidad de su consumo de energía. Aun así, CFE continúa facturando
          el <b>cargo fijo del servicio</b> y el derecho de alumbrado público${ah.cargo_fijo
            ? `, del orden de <b>${money(ah.cargo_fijo)}</b> por periodo` : ""}, por lo que su
          recibo no llega a cero.</p>` : ""}` : ""}

      ${conRecibo && c.recibo_foto ? `
        <div class="recibo-doc">
          <span>Recibo de CFE proporcionado por el cliente${
            (c.recibo || {}).periodo ? ` · periodo ${esc(c.recibo.periodo)}` : ""}</span>
          <img src="${c.recibo_foto}" alt="Recibo de CFE">
        </div>` : ""}

      <h2>Garantías</h2>
      <div class="campos">
        <div><span>Paneles solares</span><b>30 años</b></div>
        <div><span>Inversores</span><b>10 años</b></div>
        <div><span>Instalación y mano de obra</span><b>1 año</b></div>
        <div><span>Interconexión CFE</span><b>5 a 90 días hábiles</b></div>
      </div>

      ${c.comentarios ? `<h2>Comentarios</h2><p style="font-size:11.5px;line-height:1.6">${esc(c.comentarios)}</p>` : ""}

      <div class="pie">
        ${pieEmpresa()}<br><br>
        Los precios son indicativos y están sujetos a revisión técnica en sitio y a confirmación por escrito.
        Vigencia de la oferta: 30 días. Cifras de ahorro estimadas con base en el consumo histórico reportado
        y en las tarifas vigentes de CFE.
      </div>
    </div>
    ${tablaRecuperacion(c, total)}
    ${hojaSitio(c)}
    ${hojaProducto(c)}
    ${hojaMonitoreo()}
    ${S.demo ? '<div class="pie-demo">Documento generado en el sitio de demostración · cifras y precios ficticios</div>' : ""}`;
  pintarHojaSitio(c);              /* el montaje se dibuja al vuelo */
  abrirPrevia(c.folio);
}

/* ---------- vista previa antes de imprimir ----------
   El vendedor revisa la propuesta en pantalla —con la corrida de recuperación
   incluida— y desde ahí decide imprimirla o guardarla en PDF. */
function abrirPrevia(folio) {
  $("#previaFolio").textContent = folio ? "Folio " + folio : "";
  $("#previaBarra").hidden = false;
  $("#doc").classList.add("previa");
  document.body.classList.add("previa");
  ajustarPrevia();
  $("#doc").scrollTop = 0;
}

/* La hoja mide 7 pulgadas de ancho, como el papel. En un teléfono no cabe, así
   que se encoge completa —igual que el zoom de un PDF— en lugar de reacomodar
   el texto: así lo que ve el vendedor es lo que va a salir impreso. */
function ajustarPrevia() {
  const doc = $("#doc");
  const disponible = doc.clientWidth - 20;
  doc.querySelectorAll(".hoja").forEach((hoja) => {
    /* la propuesta mide 7 pulgadas de ancho; la portada, la hoja de papel
       completa: 8.5 pulgadas. Cada una se encoge con su propia proporción. */
    const ancho = hoja.classList.contains("portada") ? 816 : 672;
    let caja = hoja.parentElement;
    if (!caja.classList.contains("hoja-caja")) {      // se envuelve una sola vez
      caja = document.createElement("div");
      caja.className = "hoja-caja";
      hoja.parentNode.insertBefore(caja, hoja);
      caja.appendChild(hoja);
    }
    const z = Math.min(1, disponible / ancho);
    hoja.style.width = ancho + "px";
    hoja.style.transform = z < 1 ? `scale(${z})` : "";
    /* el alto real de la hoja sin encoger, para que la caja ocupe lo justo */
    caja.style.height = Math.ceil(hoja.offsetHeight * z) + "px";
    caja.style.width = Math.ceil(ancho * z) + "px";
  });
}

window.addEventListener("resize", () => {
  if (document.body.classList.contains("previa")) ajustarPrevia();
});

function cerrarPrevia() {
  $("#previaBarra").hidden = true;
  $("#doc").classList.remove("previa");
  document.body.classList.remove("previa");
}

function imprimirAhora() { setTimeout(() => window.print(), 60); }

/* El botón físico de "atrás" del teléfono cierra la vista previa en lugar de
   sacar al vendedor de la aplicación. */
window.addEventListener("popstate", () => {
  if (document.body.classList.contains("previa")) cerrarPrevia();
});

/* ---------- Portada de la propuesta ----------
   Es fija: la misma para todas las cotizaciones. Sólo cambian los datos del
   cliente de la caja azul, que la app llena con lo que ya tiene guardado. */
function hojaPortada(c) {
  const r = c.recibo || {};
  const rpu = c.cliente_referencia || r.no_servicio || "";
  const f = c.creado_en ? new Date(c.creado_en) : new Date();
  const MES = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
               "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
  const renglon = (etq, val) => val
    ? `<div><span class="lab">${etq}</span><span class="val">${esc(val)}</span></div>` : "";

  /* Sin foto de portada y sin misión ni visión, la hoja usa el acomodo
     sencillo: el título centrado en lugar de dos tercios en blanco. */
  const sencilla = !portadaEmpresa() && !bloqueMisionVision();
  return `
    <div class="hoja portada${sencilla ? " sencilla" : ""}"${selloDemo()}>
      <div class="arriba">
        ${imgLogo("marca")}
        <h1>${esc(empresa().titulo_propuesta || EMPRESA_OMISION.titulo_propuesta)}</h1>
        <div class="sub">Propuesta técnica-económica</div>
        ${portadaEmpresa() ? `<img class="banda" src="${portadaEmpresa()}" alt="Sistema fotovoltaico instalado en cubierta">` : ""}

        ${bloqueMisionVision()}
      </div>

      <div class="caja">
        ${renglon("Cliente:", c.cliente_nombre)}
        ${renglon("Dirección:", c.cliente_direccion)}
        <div class="gap"></div>
        ${renglon("Referencia:", rpu)}
        ${renglon("Fecha:", MES[f.getMonth()] + " " + f.getFullYear())}
      </div>

      <div class="datos">
        <div><b>${esc(empresa().razon_social)}</b></div>
        ${empresa().whatsapp ? `<div><b>WhatsApp:</b> ${esc(empresa().whatsapp)}</div>` : ""}
        ${empresa().correo ? `<div><b>Correo:</b> ${esc(empresa().correo)}</div>` : ""}
        ${empresa().web ? `<div><b>Web:</b> ${esc(empresa().web)}</div>` : ""}
      </div>
    </div>`;
}

/* ---------- Hoja de anexo: la foto que el vendedor eligió de su carrete ----------
   La portada es fija, así que la foto del vendedor va en su propia hoja, antes
   del cierre. Sin foto, esa hoja simplemente no aparece. */
/* Hoja de la vista previa en el techo. Se dibuja al vuelo con la foto de
   dron guardada: así siempre coincide con los paneles de la cotización,
   aunque después se cambien. */
function hojaSitio(c) {
  if (!c.foto_sitio || !c.sitio) return "";
  const t = c.tecnico || {};
  return `
    <div class="hoja sitio"${selloDemo()}>
      <div class="dh">
        <div><h1>Así se vería en tu techo</h1>
          <div style="font-size:11.5px;color:#6b7280;margin-top:4px">
            Folio ${esc(c.folio || "")} · ${esc(c.cliente_nombre || "")}</div></div>
        ${imgLogo()}
      </div>
      <div id="sitioHoja"><img class="foto-sitio" src="${c.foto_sitio}" alt="Vista previa en el techo"></div>
      <p style="font-size:10.5px;color:#6b7280;margin-top:10px;line-height:1.5">
        Montaje sobre la fotografía real del inmueble, con
        ${esc(String(t.paneles || ""))} módulos${t.wpanel ? " de " + esc(String(t.wpanel)) + " W" : ""}
        dibujados a escala${MCSitio.areasDe(c.sitio).length > 1
          ? ` y distribuidos en ${MCSitio.areasDe(c.sitio).length} superficies` : ""}.
        <b>Es una imagen de referencia:</b> la distribución definitiva,
        los pasillos de servicio y los apartados por sombras o instalaciones existentes se
        determinan en la visita técnica.${c.sitio.fuente === "satelite"
          ? ` Imagen de satélite <b>© Google</b>; puede no reflejar cambios recientes en el inmueble.`
          : ""}</p>
      <div class="pie">
        ${pieEmpresa()}
      </div>
    </div>`;
}

/* Cambia la foto cruda por el montaje con los módulos ya dibujados. */
async function pintarHojaSitio(c) {
  const caja = document.getElementById("sitioHoja");
  if (!caja || !c.foto_sitio || !c.sitio) return;
  try {
    const r = await MCSitio.generarVistaSitio(c.foto_sitio, c.sitio, c.tecnico || {}, logoEmpresa());
    caja.innerHTML = `<img class="foto-sitio" src="${r.url}" alt="Vista previa en el techo">`;
  } catch { /* si algo falla, se queda la foto tal cual */ }
}

function hojaProducto(c) {
  if (!c.foto_producto) return "";
  const t = c.tecnico || {};
  const pie = [
    t.wpanel ? `Panel de ${t.wpanel} W` : "",
    t.marcainversor ? `Inversor ${t.marcainversor}${t.capinversor ? " · " + t.capinversor : ""}` : "",
    "Estructura de aluminio anodizado de fabricación propia",
  ].filter(Boolean).join(" · ");

  return `
    <div class="hoja anexo"${selloDemo()}>
      <div class="dh">
        <div><h1>El equipo que se instala</h1>
          <div style="font-size:11.5px;color:#6b7280;margin-top:4px">
            Folio ${esc(c.folio || "")} · ${esc(c.cliente_nombre || "")}</div></div>
        ${imgLogo()}
      </div>

      <div class="foto-anexo"><img src="${c.foto_producto}" alt="Equipo del sistema fotovoltaico"></div>
      ${pie ? `<p class="pie-anexo">${esc(pie)}</p>` : ""}

      <p style="font-size:10.5px;color:#6b7280;margin-top:10px;line-height:1.5">
        Imagen de referencia del equipo y de los materiales considerados en esta propuesta.
        Las marcas y modelos definitivos se confirman en la visita técnica y quedan asentados
        en el contrato.</p>

      <div class="pie">
        ${pieEmpresa()}
      </div>
    </div>`;
}

/* ---------- Última hoja: monitoreo y contacto ----------
   Los dibujos del monitor y del celular no son fotos: son gráficos vectoriales
   dentro del propio documento, así que no pesan nada. */
function hojaMonitoreo() {
  return `
    <div class="hoja monitoreo"${selloDemo()}>
      <div class="dh">
        <div><h1>Reporte de visita técnica</h1>
          <div style="font-size:11.5px;color:#6b7280;margin-top:4px">d) Sistema de monitoreo</div></div>
        ${imgLogo()}
      </div>

      <p style="font-size:11.5px;line-height:1.6;color:#374151">
        La instalación dispone de sistema de monitorización disponible para el usuario final, que le
        permite un control continuo y en tiempo real de la producción solar. Se conforma de inversor
        y datalogger.</p>

      <div class="mon">
        <svg viewBox="0 0 320 210" width="280" aria-hidden="true">
          <rect x="20" y="10" width="280" height="170" rx="8" fill="#1f2a33"/>
          <rect x="28" y="18" width="264" height="154" rx="3" fill="#f4f7fb"/>
          <rect x="36" y="26" width="248" height="14" fill="#e3e9f0"/>
          <rect x="36" y="48" width="60" height="116" fill="#eef2f7"/>
          <g fill="#2F6FC4"><rect x="110" y="120" width="9" height="40"/><rect x="124" y="100" width="9" height="60"/>
            <rect x="138" y="86" width="9" height="74"/><rect x="152" y="74" width="9" height="86"/>
            <rect x="166" y="92" width="9" height="68"/><rect x="180" y="110" width="9" height="50"/>
            <rect x="194" y="128" width="9" height="32"/></g>
          <polyline points="110,150 130,120 150,128 175,98 200,112 230,90 270,100"
                    fill="none" stroke="#F0A93C" stroke-width="2.5"/>
          <rect x="120" y="190" width="160" height="14" rx="7" fill="#9aa3a8"/>
        </svg>
        <div style="flex:1">
          <div class="pastilla">Seguimiento de la producción</div>
          <div class="pastilla">Detección de posibles averías</div>
          <div class="pastilla">Análisis de rendimiento</div>
          <div class="pastilla">Configuración de reportes</div>
        </div>
      </div>

      <div class="cierre">
        <svg class="tel" viewBox="0 0 170 320" width="128" aria-hidden="true">
          <rect x="10" y="6" width="150" height="308" rx="26" fill="#1f2a33"/>
          <rect x="18" y="16" width="134" height="288" rx="18" fill="#eaf1f7"/>
          <rect x="60" y="22" width="48" height="7" rx="3.5" fill="#1f2a33"/>
          <rect x="30" y="44" width="110" height="40" rx="6" fill="#fff"/>
          <circle cx="85" cy="150" r="42" fill="#fff"/>
          <circle cx="85" cy="150" r="42" fill="none" stroke="#F0A93C" stroke-width="7"
                  stroke-dasharray="200 64" transform="rotate(-90 85 150)"/>
          <circle cx="85" cy="150" r="26" fill="#FDF4E6"/>
          <path d="M85 138 l9 14 h-18Z" fill="#F0A93C"/>
          <rect x="30" y="214" width="50" height="34" rx="6" fill="#fff"/>
          <rect x="90" y="214" width="50" height="34" rx="6" fill="#fff"/>
          <rect x="30" y="256" width="110" height="30" rx="6" fill="#fff"/>
          <circle cx="55" cy="271" r="9" fill="#dde8f6"/><circle cx="85" cy="271" r="9" fill="#dde8f6"/>
          <circle cx="115" cy="271" r="9" fill="#dde8f6"/>
        </svg>
        <div class="tarjeta">
          ${imgLogo()}
          <div class="razon">${esc(empresa().razon_social)}</div>
          ${empresa().whatsapp ? `<div class="ct"><svg width="18" height="18" viewBox="0 0 24 24" fill="#134a92"><path d="M12 2a10 10 0 0 0-8.6 15l-1.4 5 5.2-1.4A10 10 0 1 0 12 2zm5.4 14.2c-.2.6-1.2 1.1-1.7 1.2-.5.1-1 .1-1.7-.1-.4-.1-1-.3-1.6-.6-2.9-1.3-4.8-4.2-5-4.4-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-2 .9-2.2.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.5-.3.3c-.1.1-.3.3-.1.6.2.3.8 1.4 1.8 2.2 1.3 1.1 2.3 1.5 2.6 1.6.3.1.5.1.7-.1l.7-.9c.2-.3.4-.2.6-.1l2 .9c.2.1.4.2.4.3.1.1.1.6-.1 1.2z"/></svg>
            <b>WhatsApp:</b> ${esc(empresa().whatsapp)}</div>` : ""}
          ${empresa().correo ? `<div class="ct"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#134a92" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
            ${esc(empresa().correo)}</div>` : ""}
          ${empresa().web ? `<div class="ct"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#134a92" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
            ${esc(empresa().web)}</div>` : ""}
          <div class="nota">Atención y cotizaciones vía WhatsApp — te contactamos de inmediato.</div>
          ${firmaDesarrollo()}
        </div>
      </div>
    </div>`;
}

const MESES_CORTO = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

/* Segunda hoja de la propuesta: mes a mes, cuánto del proyecto lleva recuperado el
   cliente con su propio ahorro, hasta que el saldo llega a cero. */
function tablaRecuperacion(c, inversion) {
  const ah = c.ahorro || {}, t = c.tecnico || {};
  const mensual = numero(ah.anual) / 12;
  if (!(inversion > 0) || !(mensual > 0)) return "";

  const kwhMes = Math.round(numero(t.produccion) / 2);   // "produccion" se guarda bimestral
  const inicio = c.creado_en ? new Date(c.creado_en) : new Date();
  const TOPE = 120;                                       // 10 años, por si el ahorro es mínimo
  const filas = [];
  let saldo = inversion;
  for (let i = 0; i < TOPE && saldo > 0.005; i++) {
    const aplica = Math.min(mensual, saldo);              // el último mes sólo abona lo que falta
    const mes = (inicio.getMonth() + i) % 12;
    const anio = inicio.getFullYear() + Math.floor((inicio.getMonth() + i) / 12);
    saldo -= aplica;
    filas.push({ n: i + 1, etq: `${MESES_CORTO[mes]}-${String(anio).slice(2)}`,
                 aplica, saldo: saldo < 0.005 ? 0 : saldo, cierraAnio: (i + 1) % 12 === 0 });
  }
  if (!filas.length) return "";
  const ultima = filas[filas.length - 1];
  const anios = (filas.length / 12).toFixed(1);

  return `
    <div class="hoja recuperacion"${selloDemo()}>
      <div class="dh">
        <div><h1>Recuperación de la inversión</h1>
          <div style="font-size:11.5px;color:#6b7280;margin-top:4px">
            Folio ${esc(c.folio || "")} · ${esc(c.cliente_nombre || "")}</div></div>
        ${imgLogo()}
      </div>

      <div class="campos" style="margin-bottom:12px">
        <div><span>Inversión</span><b>${money(inversion)}</b></div>
        <div><span>Ahorro mensual estimado</span><b>${money(mensual)}</b></div>
        ${kwhMes > 0 ? `<div><span>Energía generada al mes</span><b>${kwhMes.toLocaleString("es-MX")} kWh</b></div>` : ""}
        <div><span>Inversión recuperada en</span><b>${filas.length} meses · ${anios} años</b></div>
      </div>

      <table class="rec">
        <tr><th class="n">Mes</th><th>Periodo</th>${kwhMes > 0 ? "<th class='n'>Energía generada</th>" : ""}
          <th class="n">Ahorro del mes</th><th class="n">Ahorro del año</th>
          <th class="n">Falta por recuperar</th></tr>
        ${filas.map((f) => `<tr${f.cierraAnio ? ' class="anio"' : ""}>
          <td class="n">${f.n}</td><td>${f.etq}</td>
          ${kwhMes > 0 ? `<td class="n">${kwhMes.toLocaleString("es-MX")} kWh</td>` : ""}
          <td class="n">${money(f.aplica)}</td>
          <td class="n">${f.cierraAnio ? money(mensual * 12) : ""}</td>
          <td class="n">${money(f.saldo)}</td></tr>`).join("")}
      </table>

      <p style="font-size:10.5px;color:#6b7280;margin-top:10px;line-height:1.5">
        A partir de <b>${esc(ultima.etq)}</b> el sistema ya se pagó solo y todo lo que genera es
        ahorro neto, durante el resto de su vida útil. El cálculo supone un ahorro constante:
        no considera la degradación natural de los paneles ni los aumentos de tarifa de CFE,
        que en la práctica se compensan entre sí. Los periodos son estimados y se recorren
        según la fecha real de interconexión.</p>

      <div class="pie">
        ${pieEmpresa()}
      </div>
    </div>`;
}


/* ---------------- nueva cotización: rápida o formal ----------------
   Los dos caminos con el mismo peso, como los ocupa el equipo. */
function menuNueva() {
  abrirModal("Nueva cotización", `
    <div class="item" onclick="elegirRapida()">
      <div class="m"><b>Cotización rápida</b>
      <span>Pocos datos, precio al instante y PDF básico para el cliente</span></div>
      <div class="r" style="color:var(--slate);font-size:19px">›</div>
    </div>
    <div class="item" onclick="cerrarModal();nuevaCotizacion()">
      <div class="m"><b>Cotización formal</b>
      <span>Propuesta completa con detalle técnico y análisis de ahorro</span></div>
      <div class="r" style="color:var(--slate);font-size:19px">›</div>
    </div>`);
}

function elegirRapida() {
  abrirModal("¿Qué vas a cotizar?", Object.entries(LINEAS).map(([k, v]) => `
    <div class="item" onclick="rapida('${k}')">
      <div class="m"><b>${v}</b><span>${
        k === "fotovoltaico" ? "Paneles, inversor, estructura y mano de obra"
        : k === "perfiles" ? "Riel, abrazaderas y tornillería por pieza"
        : "Media tensión, mantenimiento y limpieza"}</span></div>
      <div class="r" style="color:var(--slate);font-size:19px">›</div>
    </div>`).join(""));
}

/* ---- lo que pasa al guardar una rápida ----
   Va directo al PDF, sin preguntar nada en medio: así lo ocupa el equipo.
   La vista del techo se agrega abriendo la cotización desde la lista. */
function trasGuardarRapida(cotizacion) {
  S.editor = { id: cotizacion.id, folio: cotizacion.folio };
  setTimeout(imprimirCotizacion, 400);
}

window.elegirRapida = elegirRapida;
window.rapida = (linea) => {
  if (linea !== "fotovoltaico") { cerrarModal(); return rapidaCatalogo(linea); }
  abrirModal("Fotovoltaico", `
    <div class="item" onclick="cerrarModal();rapidaRecibo()">
      <div class="m"><b>Desde el recibo de CFE</b>
      <span>Capturas el consumo y el pago; la app calcula módulos, kWp, superficie, ahorro y retorno</span></div>
      <div class="r" style="color:var(--slate);font-size:19px">›</div>
    </div>
    <div class="item" onclick="cerrarModal();rapidaFV()">
      <div class="m"><b>Por número de paneles</b>
      <span>Ya sabes cuántos paneles lleva y solo quieres el precio</span></div>
      <div class="r" style="color:var(--slate);font-size:19px">›</div>
    </div>`);
};

/* ---- rápida: fotovoltaico ---- */
function rapidaFV() {
  const P = paramFV();
  const opcCli = S.clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  const marcas = ["SMA", "Sungrow", "Solis", "Huawei"];
  $("#v-editor").innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <div><h2 class="tit">Cotización rápida</h2><p class="des" style="margin:0">Fotovoltaico</p></div>
      <button class="btn sec sm" onclick="ir('cot')">Cerrar</button>
    </div>
    <div class="aviso" id="rpAviso"></div>

    <div class="card">
      ${campoCliente("rpCliente")}
      <button class="btn sec sm" onclick="formCliente()">+ Nuevo cliente</button>
    </div>

    <div class="card">
      <h3>Datos del sistema</h3>
      <div class="grid2">
        <label class="f"><span>Número de paneles</span>
          <input type="number" id="rpPaneles" min="1" value="300" inputmode="numeric"></label>
        <label class="f"><span>Watts por panel</span>
          <input type="number" id="rpW" min="1" value="600" inputmode="numeric"></label>
        <label class="f"><span>Tensión</span>
          <select id="rpTension"><option>220</option><option>440</option></select></label>
        <label class="f"><span>Inversores</span>
          <input type="number" id="rpInv" min="0" value="" placeholder="automático" inputmode="numeric"></label>
      </div>
      <label class="f"><span>Marca del inversor</span>
        <select id="rpMarca">${marcas.map((m) => `<option>${m}</option>`).join("")}<option>Otra</option></select></label>
    </div>

    <div class="card">
      <h3>Precio de la energía</h3>
      <label class="f destaca"><span>Precio por kWh que paga el cliente ($)</span>
        <input type="number" step="0.01" id="rpPrecioKwh" inputmode="decimal"
               value="${Number(P.precio_kwh_default) || 3.5}"></label>
      <p style="font-size:11.5px;color:var(--slate)">
        De este dato depende todo el retorno de inversión. Si el cliente trae su recibo,
        conviene cotizar desde el recibo para sacarlo exacto.</p>
    </div>

    <div class="card" id="rpResultado"></div>

    <div class="acciones" style="margin-bottom:30px">
      <button class="btn pri" onclick="guardarRapida(this)">Guardar y generar PDF</button>
    </div>`;

  $$(".vista").forEach((x) => (x.hidden = true));
  $("#v-editor").hidden = false;
  $("#fab").hidden = true;
  window.scrollTo(0, 0);
  activarBuscadorCliente("rpCliente");
  ["rpPaneles", "rpW", "rpInv", "rpPrecioKwh"].forEach((id) => $("#" + id).addEventListener("input", calcFV));
  calcFV();

  if (!Number(P.panel_precio)) {
    aviso("#rpAviso", esDueno()
      ? "Aún no defines los precios del cotizador rápido. Ve a Más → Cotizador rápido."
      : "El administrador todavía no captura los precios del cotizador rápido.");
  }
}

function partidasFV() {
  const P = paramFV();
  const paneles = numero($("#rpPaneles").value);
  const w = numero($("#rpW").value);
  const kwp = (paneles * w) / 1000;
  const porInv = Number(P.paneles_por_inversor) || 20;
  const inv = numero($("#rpInv").value) || Math.max(1, Math.ceil(paneles / porInv));
  const lista = [
    { clave: "PANEL", descripcion: `Panel fotovoltaico ${w} W`, unidad: "PZA", cantidad: paneles, precio: Number(P.panel_precio) || 0 },
    { clave: "INVERSOR", descripcion: `Inversor ${$("#rpMarca").value} · ${$("#rpTension").value} V`, unidad: "PZA", cantidad: inv, precio: Number(P.inversor_precio) || 0 },
    { clave: "ESTRUCT", descripcion: "Estructura de montaje de aluminio anodizado", unidad: "PZA", cantidad: paneles, precio: Number(P.estructura_por_panel) || 0 },
    { clave: "MATELEC", descripcion: "Material eléctrico y fotovoltaico", unidad: "kWp", cantidad: kwp, precio: Number(P.electrico_por_kwp) || 0 },
    { clave: "MANOBRA", descripcion: "Mano de obra calificada y certificada", unidad: "kWp", cantidad: kwp, precio: Number(P.manobra_por_kwp) || 0 },
  ].filter((x) => x.cantidad > 0);
  return { lista, kwp, inv, paneles, w };
}

function calcFV() {
  const P = paramFV();
  const { lista, kwp, inv, paneles } = partidasFV();
  const total = lista.reduce((a, x) => a + x.cantidad * x.precio, 0);
  const prod = kwp * (Number(P.produccion_kwh_kwp_bim) || 150);   // kWh bimestrales
  /* Sin recibo no hay de dónde sacar el precio por kWh, así que el vendedor lo captura.
     Con él ya se puede mostrar el retorno, que es el número que cierra la venta. */
  const precioKwh = numero($("#rpPrecioKwh")?.value);
  const ahorroMes = (prod / 2) * precioKwh;
  const ahorroAnual = ahorroMes * 12;
  const roi = ahorroAnual > 0 ? total / ahorroAnual : 0;
  $("#rpResultado").innerHTML = `
    <h3>Resultado</h3>
    <div class="grid3" style="margin-bottom:12px">
      <div class="kpi"><b>${kwp.toFixed(2)}</b><span>kWp</span></div>
      <div class="kpi"><b>${inv}</b><span>Inversores</span></div>
      <div class="kpi"><b>${Math.round(prod).toLocaleString("es-MX")}</b><span>kWh bim.</span></div>
    </div>
    ${lista.map((x) => `<div class="row between" style="padding:6px 0;border-bottom:1px dashed var(--line);font-size:13px">
      <span style="color:var(--slate)">${esc(x.descripcion)} <b style="color:var(--ink)">× ${x.cantidad % 1 ? x.cantidad.toFixed(2) : x.cantidad}</b></span>
      <b>${money(x.cantidad * x.precio)}</b></div>`).join("")}
    <div class="total-row"><span>Total</span><b>${money(total)}</b></div>
    ${precioKwh > 0 ? `
      <div class="grid3" style="margin-top:14px">
        <div class="kpi"><b>${money(ahorroMes)}</b><span>Ahorro mensual</span></div>
        <div class="kpi"><b>${money(ahorroAnual)}</b><span>Ahorro anual</span></div>
        <div class="kpi"><b>${roi.toFixed(1)}</b><span>Años de retorno</span></div>
      </div>
      <p style="font-size:11.5px;color:var(--slate);margin-top:10px">
        Calculado a ${money(precioKwh)} por kWh. Supone que el cliente consume al menos lo que
        genera el sistema; si genera de más, el excedente no se ahorra igual.</p>` : `
      <p style="font-size:12px;color:var(--warn);margin-top:12px">
        Captura el precio por kWh para poder mostrar el retorno de inversión.</p>`}`;
}

/* Ahorro y retorno de la cotización por panel, con el precio por kWh que capturó el
   vendedor. Si lo dejó vacío, no se inventa nada: la cotización va sin análisis. */
function ahorroRapida() {
  const P = paramFV();
  const { kwp } = partidasFV();
  const precioKwh = numero($("#rpPrecioKwh")?.value);
  if (precioKwh <= 0) return {};
  const total = partidasFV().lista.reduce((a, x) => a + x.cantidad * x.precio, 0);
  const ahorroMes = (kwp * (Number(P.produccion_kwh_kwp_bim) || 150) / 2) * precioKwh;
  const anual = ahorroMes * 12;
  /* Aquí NO se sabe cuánto paga hoy el cliente (no hay recibo), así que no se llenan
     "pago actual" ni "pagará con el sistema": sólo el beneficio y el retorno. */
  return {
    precio_kwh: Number(precioKwh.toFixed(4)),
    roi: Number((anual > 0 ? total / anual : 0).toFixed(1)),
    anual: Math.round(anual),
  };
}

async function guardarRapida(boton) {
  return conBoton(boton, () => _guardarRapida());
}

async function _guardarRapida() {
  S.cotCargadas = false;   /* la lista en memoria quedó vieja */
  const cliente = $("#rpCliente").value;
  if (!cliente) return aviso("#rpAviso", "Selecciona un cliente.");
  const { lista, kwp, inv, paneles, w } = partidasFV();
  if (!lista.length) return aviso("#rpAviso", "Captura al menos el número de paneles.");
  const P = paramFV();
  try {
    const { cotizacion } = await api("cotizaciones", { method: "POST", body: {
      cliente_id: cliente, estatus: "borrador", linea: "fotovoltaico", tipo: "rapida",
      partidas: lista,
      tecnico: {
        kwp: kwp.toFixed(2), paneles: String(paneles), wpanel: String(w),
        inversores: String(inv), tension: $("#rpTension").value,
        marcainversor: $("#rpMarca").value,
        produccion: String(Math.round(kwp * (Number(P.produccion_kwh_kwp_bim) || 150))),
      },
      ahorro: ahorroRapida(),
      comentarios: "Estimación rápida. Sujeta a levantamiento técnico en sitio.",
    }});
    aviso("#rpAviso", "Guardada como " + cotizacion.folio, "ok");
    trasGuardarRapida(cotizacion);
  } catch (x) { aviso("#rpAviso", x.message); }
}

/* ---- rápida: perfiles y servicios eléctricos ---- */
function rapidaCatalogo(linea) {
  const items = S.catalogo.filter((c) => c.activo && (c.linea || "fotovoltaico") === linea);
  const opcCli = S.clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  S.rapidaLinea = linea;
  $("#v-editor").innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <div><h2 class="tit">Cotización rápida</h2><p class="des" style="margin:0">${LINEAS[linea]}</p></div>
      <button class="btn sec sm" onclick="ir('cot')">Cerrar</button>
    </div>
    <div class="aviso" id="rpAviso"></div>
    <div class="card">
      ${campoCliente("rpCliente")}
      <button class="btn sec sm" onclick="formCliente()">+ Nuevo cliente</button>
    </div>
    <div class="card">
      <h3>Cantidades</h3>
      ${items.length ? items.map((c) => `
        <div class="partida" style="grid-template-columns:1fr 78px 96px">
          <div class="d"><b>${esc(c.descripcion)}</b><span>${esc(c.clave)} · ${money(c.precio)} / ${esc(c.unidad)}</span></div>
          <input type="number" min="0" step="1" value="0" inputmode="numeric"
                 data-cat="${c.id}" data-precio="${c.precio}" oninput="calcCat()">
          <div class="imp" id="imp-${c.id}">$0.00</div>
        </div>`).join("") : '<div class="vacio">No hay conceptos en esta línea.</div>'}
      <div class="total-row"><span>Total</span><b id="rpTotal">$0.00</b></div>
    </div>
    <div class="acciones" style="margin-bottom:30px">
      <button class="btn pri" onclick="guardarRapidaCat(this)">Guardar y generar PDF</button>
    </div>`;
  $$(".vista").forEach((x) => (x.hidden = true));
  $("#v-editor").hidden = false;
  $("#fab").hidden = true;
  window.scrollTo(0, 0);
  activarBuscadorCliente("rpCliente");
}

window.calcCat = () => {
  let total = 0;
  $$("[data-cat]").forEach((i) => {
    const imp = numero(i.value) * numero(i.dataset.precio);
    total += imp;
    const c = $("#imp-" + i.dataset.cat);
    if (c) c.textContent = money(imp);
  });
  $("#rpTotal").textContent = money(total);
};

async function guardarRapidaCat(boton) {
  return conBoton(boton, () => _guardarRapidaCat());
}

async function _guardarRapidaCat() {
  S.cotCargadas = false;   /* la lista en memoria quedó vieja */
  const cliente = $("#rpCliente").value;
  if (!cliente) return aviso("#rpAviso", "Selecciona un cliente.");
  const lista = [];
  $$("[data-cat]").forEach((i) => {
    const cant = numero(i.value);
    if (cant > 0) {
      const c = S.catalogo.find((x) => x.id === Number(i.dataset.cat));
      lista.push({ catalogo_id: c.id, clave: c.clave, descripcion: c.descripcion,
                   unidad: c.unidad, precio: Number(c.precio), cantidad: cant });
    }
  });
  if (!lista.length) return aviso("#rpAviso", "Captura al menos una cantidad.");
  try {
    const { cotizacion } = await api("cotizaciones", { method: "POST", body: {
      cliente_id: cliente, estatus: "borrador", linea: S.rapidaLinea, tipo: "rapida",
      partidas: lista, comentarios: "Estimación rápida. Precios sujetos a confirmación por escrito.",
    }});
    aviso("#rpAviso", "Guardada como " + cotizacion.folio, "ok");
    trasGuardarRapida(cotizacion);
  } catch (x) { aviso("#rpAviso", x.message); }
}

Object.assign(window, {
  menuNueva, elegirRapida, rapidaFV, guardarRapida, guardarRapidaCat, calcFV,
  trasGuardarRapida,
});


/* ================= DIMENSIONAMIENTO DESDE EL RECIBO DE CFE =================
   La tarifa manda: define qué campos se piden y qué precio por panel aplica.
     consumo total   = base + intermedia + punta   (tarifas horarias)
                     = consumo capturado           (las demás)
     precio promedio = pago a CFE / consumo total
     consumo por dia = consumo total / dias del periodo
     genera un panel = kW x eficiencia x horas solares
     modulos         = consumo por dia / genera un panel
     precio unitario = tabla de la tarifa, segun tension y cantidad de modulos
   =========================================================================== */

const paramTar = () => S.config.tarifas || {};
const listaTarifas = () => paramTar().lista || [];
const listaHilos = () => paramTar().hilos || [];
const tarifaDe = (clave) => listaTarifas().find((t) => t.clave === clave) || listaTarifas()[0] || {};

function guiaDeInversores(modulos) {
  const g = (paramTar().guia_inversores || []);
  return g.find((x) => modulos >= Number(x.desde) && modulos <= Number(x.hasta)) || null;
}

function escalonesDe(tar, tension) {
  return (tar.escalones || [])
    .filter((e) => e.tension === tension || e.tension === "*")
    .sort((a, b) => Number(a.hasta) - Number(b.hasta));
}

function precioDePanel(tar, tension, modulos) {
  const esc = escalonesDe(tar, tension);
  if (!esc.length) return 0;
  const m = esc.find((e) => modulos <= Number(e.hasta));
  return Number((m || esc[esc.length - 1]).precio) || 0;
}

/* Arriba del último escalón la tarifa ya no tiene precio definido: se avisa y
   el vendedor captura el precio a mano. */
function topeDeTarifa(tar, tension) {
  const esc = escalonesDe(tar, tension);
  return esc.length ? Number(esc[esc.length - 1].hasta) : 0;
}

function calcularDimensionamiento(e) {
  const P = paramDim();
  const T = paramTar();
  const tar = tarifaDe(e.tarifa);
  const panel = (P.paneles || []).find((x) => x.clave === e.panel) || (P.paneles || [])[0] || {};

  const consumo = tar.horaria ? (e.base + e.intermedia + e.punta) : e.consumo;
  const dias = e.dias > 0 ? e.dias : 30;
  /* Precio por kWh = lo que el cliente paga en total a CFE entre los kWh del recibo.
     Si el resultado se sale del rango normal, casi siempre es un dato mal capturado
     (el consumo o el total), así que la app lo avisa antes de que llegue al cliente. */
  const precioKwh = consumo > 0 ? e.pago / consumo : 0;
  /* El rango normal no es el mismo en todas las tarifas: en media tensión
     industrial (GDMTO, GDMTH) el kWh sale bastante más barato que en casa o
     en un negocio chico. Cada tarifa puede traer el suyo; si no, se usa el
     general de los parámetros del dimensionamiento. */
  const precioMin = Number(tar.precio_kwh_min) || Number(P.precio_kwh_min) || 0;
  const precioMax = Number(tar.precio_kwh_max) || Number(P.precio_kwh_max) || 0;
  const precioFueraDeRango = consumo > 0 && e.pago > 0 && precioMin > 0 && precioMax > 0
    && (precioKwh < precioMin || precioKwh > precioMax);
  const consumoDia = consumo / dias;
  const porPanelDia = (panel.kw || 0) * (panel.eficiencia || 0) * (panel.horas_solares || 0);
  const modulos = porPanelDia > 0 ? consumoDia / porPanelDia : 0;
  const modulosEnteros = Math.ceil(modulos);
  const usar = e.modulosManual > 0 ? e.modulosManual : modulosEnteros;

  const precioSugerido = precioDePanel(tar, e.tension, usar);
  const precioPanel = e.precioManual > 0 ? e.precioManual : precioSugerido;
  const tope = topeDeTarifa(tar, e.tension);
  const fueraDeEscalon = usar > 0 && tope > 0 && usar > tope;

  const guia = guiaDeInversores(usar);
  const fueraDeGuia = usar > 0 && !guia;
  const invSugeridos = guia ? Number(guia.inversores) : 0;
  const inversores = e.inversoresManual > 0 ? e.inversoresManual : invSugeridos;
  const cobraInv = T.inversor_se_cobra === true;
  const precioInv = cobraInv && guia ? Number(guia.precio) || 0 : 0;
  const costoInversores = inversores * precioInv;

  const kwp = usar * (panel.kw || 0);
  const superficie = usar * (Number(P.m2_por_panel) || 3.1);
  const produccionDia = usar * porPanelDia;
  const produccionMes = produccionDia * 30;
  const valor = usar * precioPanel + costoInversores;

  /* El ahorro nunca puede ser mayor que el recibo: si el sistema se reduce (por espacio en
     el techo, por ejemplo) sólo se ahorra lo que se genera; si el sistema alcanza a cubrir
     todo el consumo, se ahorra el recibo completo y no más. */
  const consumoMes = consumoDia * 30;
  /* Qué tanto del recibo alcanza a cubrir el sistema propuesto. Es normal cotizar
     menos módulos de los que pide el cálculo, por presupuesto o por espacio. */
  const cobertura = consumoMes > 0 ? Math.min(100, (produccionMes / consumoMes) * 100) : 0;
  const ahorroMes = Math.min(produccionMes, consumoMes) * precioKwh;
  /* Lo mismo pero sobre los días reales del recibo, que pueden ser 28 o 63. */
  const ahorroPeriodo = Math.min(produccionDia * dias, consumo) * precioKwh;
  const ahorroAnual = ahorroMes * 12;
  const ahorro30 = ahorroAnual * 30;
  const pagoAnual = consumoMes * precioKwh * 12;
  const roi = ahorroAnual > 0 ? valor / ahorroAnual : 0;

  const enganche = valor * ((Number(P.enganche_pct) || 0) / 100);
  const plazo = Number(P.plazo_meses) || 120;
  const mensualidad = plazo > 0 ? (valor - enganche) / plazo : 0;

  return { tar, panel, consumo, dias, precioKwh, precioFueraDeRango, precioMin, precioMax,
           consumoDia, porPanelDia, modulos, modulosEnteros,
           usar, precioSugerido, precioPanel, tope, fueraDeEscalon,
           guia, fueraDeGuia, invSugeridos, inversores,
           cobraInv, precioInv, costoInversores, kwp, superficie,
           produccionDia, produccionMes, consumoMes, cobertura,
           valor, ahorroMes, ahorroPeriodo, ahorroAnual, ahorro30, roi,
           enganche, plazo, mensualidad };
}

function rapidaRecibo() {
  const P = paramDim();
  const tarifas = listaTarifas();
  if (!tarifas.length) return alert("Todavía no hay tarifas configuradas.");
  S.rcTarifa = tarifas[0].clave;
  S.rcValores = {};
  S.rcFoto = null;
  S.rcFotoProd = null;
  pintarRecibo();
}

function pintarRecibo() {
  const P = paramDim();
  const tar = tarifaDe(S.rcTarifa);
  const esMedia = tar.grupo === "media";
  const paneles = P.paneles || [];
  const opcCli = S.clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");

  $("#v-editor").innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <div><h2 class="tit">Desde el recibo de CFE</h2>
      <p class="des" style="margin:0">Fotovoltaico · dimensionamiento automático</p></div>
      <button class="btn sec sm" onclick="ir('cot')">Cerrar</button>
    </div>
    <div class="aviso" id="rcAviso"></div>

    <div class="card">
      ${campoCliente("rcCliente")}
      <button class="btn sec sm" onclick="formCliente()">+ Nuevo cliente</button>
    </div>

    <div class="card">
      <h3>Tarifa del recibo</h3>
      <label class="f"><span>Tarifa ${pista("tarifa")}</span>
        <select id="rcTarifa" onchange="cambiarTarifa(this.value)">
          ${listaTarifas().map((t) => `<option value="${esc(t.clave)}" ${t.clave === tar.clave ? "selected" : ""}>${esc(t.nombre)}</option>`).join("")}
        </select></label>
      <label class="f"><span>Nº de servicio ${pista("servicio")}</span>
        <input id="rcServicio" inputmode="numeric" placeholder="viene arriba en el recibo"></label>

      ${esMedia ? `
        <div class="grid2">
          <label class="f"><span>Tensión de interconexión ${pista("tension")}</span>
            <select id="rcTension" onchange="calcRecibo()">
              ${(tar.tensiones || []).map((v) => `<option ${v === "440" ? "selected" : ""}>${v}</option>`).join("")}
            </select></label>
          <label class="f"><span>Demanda contratada (kW)</span>
            <input type="number" id="rcDemanda" value="" inputmode="decimal"></label>
        </div>`
      : `
        <div class="grid2">
          <label class="f"><span>Hilos</span>
            <select id="rcHilos" onchange="calcRecibo()">
              ${listaHilos().map((h) => `<option value="${h.tension}">${esc(h.descripcion)}</option>`).join("")}
            </select></label>
          <label class="f"><span>Tensión</span>
            <input id="rcTensionTxt" readonly value=""></label>
        </div>`}

      ${(tar.uvie || tar.gestion || (tar.incluye || []).length) ? `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:2px">
          ${tar.uvie ? '<span class="badge b-enviada">UVIE incluida</span>' : ""}
          ${tar.gestion ? '<span class="badge b-enviada">Gestión incluida</span>' : ""}
          ${(tar.incluye || []).filter((x) => !/gesti/i.test(x))
            .map((x) => `<span class="badge b-enviada">${esc(x)}</span>`).join("")}
        </div>
        <p style="font-size:11.5px;color:var(--slate);margin-top:8px">
          Van siempre en esta tarifa y su costo ya está considerado en el valor del proyecto.</p>` : ""}
    </div>

    <div class="card">
      <h3>Consumo y pago</h3>
      ${tar.horaria ? `
        <div class="grid3">
          <label class="f"><span>Base (kWh) ${pista("consumo")}</span><input type="number" id="rcBase" value="0" inputmode="numeric"></label>
          <label class="f destaca"><span>Intermedia (kWh)</span><input type="number" id="rcInter" value="0" inputmode="numeric"></label>
          <label class="f"><span>Punta (kWh)</span><input type="number" id="rcPunta" value="0" inputmode="numeric"></label>
        </div>
        <p style="font-size:11.5px;color:var(--slate);margin-top:-4px;margin-bottom:10px">
          La <b style="color:var(--sky)">intermedia</b> es donde actúan los paneles.</p>`
      : `
        <label class="f"><span>Consumo del periodo (kWh) ${pista("consumo")}</span>
          <input type="number" id="rcConsumo" value="0" inputmode="numeric"></label>`}
      <div class="grid2">
        <label class="f"><span>Periodo facturado · del ${pista("periodo")}</span>
          <input type="date" id="rcDel" onchange="calcularDias()"></label>
        <label class="f"><span>al</span>
          <input type="date" id="rcAl" onchange="calcularDias()"></label>
      </div>
      <div class="grid2">
        <label class="f"><span>Días del periodo</span>
          <input type="number" id="rcDias" value="${Number(P.dias_periodo) || 30}" inputmode="numeric"></label>
        <label class="f"><span>Pago actual a CFE ($)</span>
          <input type="number" id="rcPago" value="0" inputmode="decimal"></label>
      </div>
      <p id="rcDiasNota" style="font-size:11.5px;color:var(--slate);margin-top:-4px;margin-bottom:10px"></p>
      <p style="font-size:11.5px;color:var(--slate);margin-top:-4px">
        El precio por kWh sale del total del recibo entre los kWh del periodo.</p>
    </div>

    <div class="card">
      <h3>Equipo</h3>
      <div class="grid2">
        <label class="f"><span>Tipo de panel</span><select id="rcPanel" onchange="calcRecibo()">
          ${paneles.map((x) => `<option ${x.clave === "710 W" ? "selected" : ""}>${esc(x.clave)}</option>`).join("")}
        </select></label>
        <label class="f"><span>Módulos a cotizar ${pista("modulos")}</span>
          <input type="number" id="rcModulos" placeholder="automático" inputmode="numeric"></label>
        <label class="f"><span>Inversores</span>
          <input type="number" id="rcInversores" placeholder="automático" inputmode="numeric"></label>
        <label class="f"><span>Precio por panel ($) ${pista("precio")}</span>
          <input type="number" id="rcPrecio" placeholder="según tarifa" ${esDueno() ? "" : "readonly"}></label>
      </div>
      <p style="font-size:11.5px;color:var(--slate)">
        Deja vacío lo que quieras que calcule la app. El precio sale de la tabla de la tarifa.</p>
    </div>

    <div class="card">
      <h3>Foto del recibo</h3>
      <p style="font-size:11.5px;color:var(--slate);margin-bottom:12px">
        Se guarda dentro de la cotización como respaldo.
        <b>No aparece en el PDF que ve el cliente.</b></p>
      <div class="foto-caja">
        <div id="rcFotoPrev"></div>
        <div style="flex:1">
          <input type="file" accept="image/*" capture="environment" id="rcFoto" hidden>
          <div class="acciones">
            <button class="btn sec sm" type="button" onclick="document.getElementById('rcFoto').click()">
              Tomar o elegir foto</button>
            <button class="btn dan sm" type="button" id="rcFotoQuitar" onclick="quitarFoto()" hidden>
              Quitar</button>
          </div>
          <p id="rcFotoNota" style="font-size:11px;color:var(--slate);margin-top:8px"></p>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Foto del equipo</h3>
      <p style="font-size:11.5px;color:var(--slate);margin-bottom:12px">
        Opcional. Elige una foto de tu carrete —el panel, la estructura, el inversor o una obra
        parecida ya terminada—. <b>Ésta sí se imprime</b>, en una hoja al final de la propuesta.
        Sin foto, esa hoja no aparece.</p>
      <div class="foto-caja">
        <div id="rcProdPrev"></div>
        <div style="flex:1">
          <input type="file" accept="image/*" id="rcProd" hidden>
          <div class="acciones">
            <button class="btn sec sm" type="button" onclick="document.getElementById('rcProd').click()">
              Elegir del carrete</button>
            <button class="btn dan sm" type="button" id="rcProdQuitar" onclick="quitarFotoProducto()" hidden>
              Quitar</button>
          </div>
          <p id="rcProdNota" style="font-size:11px;color:var(--slate);margin-top:8px"></p>
        </div>
      </div>
    </div>

    <div class="card" id="rcResultado"></div>

    <div class="acciones" style="margin-bottom:30px">
      <button class="btn pri" onclick="guardarRecibo(this)">Guardar y generar PDF</button>
    </div>`;

  $$(".vista").forEach((x) => (x.hidden = true));
  $("#v-editor").hidden = false;
  $("#fab").hidden = true;
  window.scrollTo(0, 0);
  activarBuscadorCliente("rcCliente");
  ["rcBase","rcInter","rcPunta","rcConsumo","rcDias","rcPago","rcModulos","rcInversores","rcPrecio","rcDemanda","rcServicio"]
    .forEach((id) => { const n = $("#" + id); if (n) n.addEventListener("input", () => { recordarRecibo(); calcRecibo(); }); });
  $("#rcFoto")?.addEventListener("change", tomarFoto);
  $("#rcProd")?.addEventListener("change", tomarFotoProducto);
  pintarFoto();
  pintarFotoProducto();
  calcRecibo();
}

/* ---- foto del recibo: se comprime en el teléfono antes de guardarla ---- */
async function comprimirImagen(archivo, lado = 1400, calidad = 0.72) {
  const mapa = await createImageBitmap(archivo);
  const escala = Math.min(1, lado / Math.max(mapa.width, mapa.height));
  const ancho = Math.max(1, Math.round(mapa.width * escala));
  const alto = Math.max(1, Math.round(mapa.height * escala));
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho; lienzo.height = alto;
  lienzo.getContext("2d").drawImage(mapa, 0, 0, ancho, alto);
  mapa.close?.();
  return lienzo.toDataURL("image/jpeg", calidad);
}

async function tomarFoto(ev) {
  const archivo = ev.target.files && ev.target.files[0];
  if (!archivo) return;
  try {
    let datos = await comprimirImagen(archivo);
    if (datos.length > 1400000) datos = await comprimirImagen(archivo, 1000, 0.6);
    S.rcFoto = datos;
    pintarFoto();
  } catch {
    aviso("#rcAviso", "No se pudo leer la imagen. Intenta con otra foto.");
  } finally { ev.target.value = ""; }
}

window.formEmpresa = formEmpresa;

/* Borrar la propia cuenta al entregar una instalación. El servidor sólo lo
   permite si queda otro administrador que ya activó su cuenta. */
window.salirDeInstalacion = async () => {
  if (!confirm("Vas a eliminar tu cuenta de esta instalación. Se cierra tu sesión y ya no " +
               "podrás entrar aquí. ¿Seguro?")) return;
  try {
    await api("usuarios?id=" + S.yo.id, { method: "DELETE" });
    alert("Listo. Tu cuenta salió de esta instalación.");
    salir();
  } catch (x) { alert(x.message); }
};

/* Descarga el respaldo como archivo. Sigue funcionando con la licencia vencida:
   la información capturada es del cliente, no de quien le vendió la aplicación. */
window.descargarRespaldo = async (btn) => {
  const antes = btn.textContent;
  btn.disabled = true; btn.textContent = "Preparando…";
  try {
    const datos = await api("respaldo");
    const hoy = new Date().toISOString().slice(0, 10);
    const nombre = (empresa().razon_social || "respaldo")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `respaldo_${nombre}_${hoy}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (x) {
    alert("No se pudo generar el respaldo: " + x.message);
  } finally { btn.disabled = false; btn.textContent = antes; }
};
window.quitarFoto = () => { S.rcFoto = null; pintarFoto(); };

/* ---- foto del producto: se elige del carrete y SÍ se imprime ----
   No lleva el atributo "capture", así que el teléfono abre la galería en lugar
   de la cámara. */
async function tomarFotoProducto(ev) {
  const archivo = ev.target.files && ev.target.files[0];
  if (!archivo) return;
  try {
    let datos = await comprimirImagen(archivo, 1500, 0.78);
    if (datos.length > 1600000) datos = await comprimirImagen(archivo, 1100, 0.65);
    S.rcFotoProd = datos;
    pintarFotoProducto();
  } catch {
    aviso("#rcAviso", "No se pudo leer la imagen. Intenta con otra foto.");
  } finally { ev.target.value = ""; }
}

window.quitarFotoProducto = () => { S.rcFotoProd = null; pintarFotoProducto(); };

/* =======================================================================
   Vista previa en el techo
   El vendedor sube la foto (de dron, del teléfono o de Google Maps) y toca
   las cuatro esquinas del techo. Con eso y las medidas en metros, la app
   dibuja los módulos en perspectiva.

   Un techo a dos aguas —o una nave más su patio— son dos superficies planas
   distintas: se marcan como ÁREAS separadas dentro de la misma foto, hasta
   cuatro, y los módulos cotizados se reparten entre ellas.
   ===================================================================== */
const ESQUINAS = ["arriba a la izquierda", "arriba a la derecha",
                  "abajo a la derecha", "abajo a la izquierda"];
const COLOR_AREA = ["#F0A93C", "#2FB6A2", "#E0679B", "#7C6BE0"];

const areaVacia = () => ({ esquinas: [], ancho_m: 0, fondo_m: 0, filas: 0, columnas: 0, paneles: 0 });
const areasEd = () => (S.edSitio && Array.isArray(S.edSitio.areas)) ? S.edSitio.areas : [];
/* La que se está marcando: la primera que aún no tiene sus cuatro esquinas. */
const areaActiva = () => areasEd().findIndex((a) => (a.esquinas || []).length < 4);

async function tomarFotoSitio(ev) {
  const archivo = ev.target.files && ev.target.files[0];
  if (!archivo) return;
  try {
    let datos = await comprimirImagen(archivo, 1600, 0.82);
    if (datos.length > 1800000) datos = await comprimirImagen(archivo, 1200, 0.7);
    const fuente = S.edSitioFuente || (S.edSitio && S.edSitio.fuente) || "dron";
    S.edSitioFuente = null;
    S.edSitioFoto = datos;
    S.edSitio = { fuente, areas: [areaVacia()] };
    S.edSitioModo = "marcar";
    await pintarSitio();
    if ($("#sitioSatelite")) $("#sitioSatelite").checked = fuente === "satelite";
    aviso("#edAviso", "Ahora toca las cuatro esquinas del techo, en orden.", "ok");
  } catch {
    aviso("#edAviso", "No se pudo leer la imagen. Intenta con otra foto.");
  } finally { ev.target.value = ""; }
}

/* Los dos botones del estado vacío: el mismo selector de archivo, pero
   dejando anotado de dónde sale la imagen. */
window.elegirFotoSitio = (fuente) => {
  S.edSitioFuente = fuente === "satelite" ? "satelite" : "dron";
  document.getElementById("edSitioFoto").click();
};

window.quitarSitio = () => {
  S.edSitioFoto = "";                      /* cadena vacía = quitarla al guardar */
  S.edSitio = null;
  S.edSitioFuente = null;
  pintarSitio();
  aviso("#edAviso", "Se quitará al guardar.", "ok");
};

/* Borra las esquinas del área que se está marcando; si ya están las cuatro,
   las de la última. La medida capturada se conserva. */
window.reiniciarEsquinas = () => {
  const areas = areasEd();
  if (!areas.length) return;
  const i = areaActiva();
  areas[i >= 0 ? i : areas.length - 1].esquinas = [];
  pintarSitio();
};

window.agregarArea = () => {
  const areas = areasEd();
  if (!areas.length) return;
  if (areas.length >= MCSitio.TOPE_AREAS)
    return aviso("#edAviso", `Se pueden marcar hasta ${MCSitio.TOPE_AREAS} áreas en una foto.`);
  if (areaActiva() >= 0)
    return aviso("#edAviso", "Primero termina de marcar las cuatro esquinas del área que sigue.");
  areas.push(areaVacia());
  pintarSitio();
  aviso("#edAviso", `Marca las cuatro esquinas del área ${areas.length}.`, "ok");
};

window.quitarArea = (i) => {
  const areas = areasEd();
  if (areas.length <= 1) return aviso("#edAviso", "Debe quedar al menos un área. Usa Quitar para borrar la foto.");
  areas.splice(i, 1);
  pintarSitio();
};

/* Dibuja la foto a escala dentro del recuadro y encima las áreas marcadas. */
async function pintarSitio() {
  const vacio = $("#sitioVacio"), trabajo = $("#sitioTrabajo");
  if (!vacio || !trabajo) return;
  const hay = !!(S.edSitioFoto && S.edSitio);
  vacio.hidden = hay;
  trabajo.hidden = !hay;
  if (!hay) return;

  const lienzo = $("#sitioLienzo");
  const img = await new Promise((ok, mal) => {
    const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = S.edSitioFoto;
  });
  S.edSitio.ancho_foto = img.naturalWidth;
  S.edSitio.alto_foto = img.naturalHeight;

  const ancho = Math.min(lienzo.parentElement.clientWidth || 340, img.naturalWidth);
  const esc = ancho / img.naturalWidth;
  lienzo.width = ancho;
  lienzo.height = Math.round(img.naturalHeight * esc);
  S.edSitioEscala = esc;

  const ctx = lienzo.getContext("2d");
  ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);

  const areas = areasEd();
  const activa = areaActiva();

  /* Con las esquinas puestas y las medidas capturadas, el recuadro deja de
     servir para marcar y pasa a servir para acomodar los paneles. */
  if (S.edSitioModo === "acomodar" && listoParaAcomodar()) {
    pintarAcomodo(ctx, esc, areas);
    pintarAreas();
    calcularCaben();
    actualizarBotonesSitio();
    return;
  }

  areas.forEach((area, ia) => {
    const e = area.esquinas || [];
    const color = COLOR_AREA[ia % COLOR_AREA.length];
    if (e.length) {
      ctx.beginPath();
      e.forEach(([x, y], i) => (i ? ctx.lineTo(x * esc, y * esc) : ctx.moveTo(x * esc, y * esc)));
      if (e.length === 4) ctx.closePath();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      if (e.length === 4) { ctx.fillStyle = color + "33"; ctx.fill(); }
    }
    e.forEach(([x, y], i) => {
      ctx.beginPath(); ctx.arc(x * esc, y * esc, 11, 0, Math.PI * 2);
      ctx.fillStyle = (ia === activa || activa < 0) ? "#0A2A5E" : "#5A6B85"; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "700 12px system-ui,sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), x * esc, y * esc);
    });
    /* el número del área, sobre su primera esquina */
    if (areas.length > 1 && e.length) {
      const [x, y] = e[0];
      ctx.beginPath(); ctx.arc(x * esc + 17, y * esc - 15, 10, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#12233F"; ctx.font = "700 12px system-ui,sans-serif";
      ctx.fillText(String(ia + 1), x * esc + 17, y * esc - 15);
    }
  });

  const paso = $("#sitioPaso");
  if (paso) {
    const cuantas = areas.length;
    const nombre = cuantas > 1 ? ` del área ${activa + 1}` : " del techo";
    paso.textContent = activa >= 0
      ? `Toca la esquina ${ESQUINAS[areas[activa].esquinas.length]}${nombre} `
        + `(${areas[activa].esquinas.length + 1} de 4)`
      : cuantas > 1
        ? `Las ${cuantas} áreas están marcadas. Captura las medidas de cada una.`
        : "Las cuatro esquinas están marcadas. Ahora captura las medidas.";
  }
  const btn = $("#btnArea");
  if (btn) btn.hidden = areas.length >= MCSitio.TOPE_AREAS;

  pintarAreas();
  calcularCaben();
  actualizarBotonesSitio();
}

/* La lista de áreas con sus medidas. Se redibuja sólo cuando cambia el número
   de áreas o sus esquinas, nunca al teclear: así no se pierde el cursor. */
/* Los botones para mover, quitar y girar, dentro de la tarjeta de cada área. */
function controlesAcomodo(a, i) {
  const ac = acomodoEfectivo(i);
  const t = topesDeArea({ ...a, giro: ac.giro });
  const quitados = (a.quitados || []).length;
  const dibujados = a.mano ? MCSitio.cuantosEnRejilla({ ...a, ...ac })
                           : ac.filas * ac.columnas;
  const b = (campo, paso, txt, activo) =>
    `<button class="btn sec sm" type="button" ${activo ? "" : "disabled"}
             onclick="cambiarRejilla(${i},'${campo}',${paso})">${txt}</button>`;
  return `
    <div class="acomodo">
      <div class="acomodo-fila">
        <span>Hileras</span>
        ${b("filas", -1, "−", ac.filas > 1)}
        <b id="sitioFil${i}">${ac.filas}</b>
        ${b("filas", 1, "+", ac.filas < t.maxFil)}
      </div>
      <div class="acomodo-fila">
        <span>Por hilera</span>
        ${b("columnas", -1, "−", ac.columnas > 1)}
        <b id="sitioCol${i}">${ac.columnas}</b>
        ${b("columnas", 1, "+", ac.columnas < t.maxCol)}
      </div>
      <div class="acciones" style="margin-top:4px">
        <button class="btn sec sm" type="button" onclick="girarRejilla(${i})">
          ${ac.giro ? "Poner acostados" : "Poner parados"}</button>
        <button class="btn sec sm" type="button" onclick="centrarRejilla(${i})">Centrar</button>
        ${a.mano ? `<button class="btn sec sm" type="button"
                            onclick="autoRejilla(${i})">Volver a automático</button>` : ""}
      </div>
      <p class="sitio-nota" style="margin:8px 0 0">
        <b>${dibujados}</b> módulos dibujados en esta área${
          quitados ? ` · ${quitados} quitado${quitados === 1 ? "" : "s"} a mano` : ""}.
        ${a.mano ? "" : "Se está acomodando sola; en cuanto la toques, manda lo que tú pongas."}</p>
    </div>`;
}

function pintarAreas() {
  const caja = $("#sitioAreas");
  if (!caja) return;
  const areas = areasEd();
  const uno = areas.length === 1;
  const acomodando = S.edSitioModo === "acomodar" && listoParaAcomodar();
  caja.innerHTML = areas.map((a, i) => `
    <div class="sitio-area">
      <div class="sitio-area-t">
        <b><span class="pin" style="background:${COLOR_AREA[i % COLOR_AREA.length]}"></span>
          ${uno ? "Medidas del techo" : "Área " + (i + 1)}</b>
        ${uno ? "" : `<button class="btn dan sm" type="button" onclick="quitarArea(${i})">Quitar área</button>`}
      </div>
      <div class="campos">
        <label class="f"><span>Ancho (m)</span>
          <input type="number" step="0.1" min="1" inputmode="decimal"
                 id="sitioAncho${i}" data-area="${i}" data-campo="ancho_m"
                 value="${a.ancho_m || ""}"></label>
        <label class="f"><span>Fondo (m)</span>
          <input type="number" step="0.1" min="1" inputmode="decimal"
                 id="sitioFondo${i}" data-area="${i}" data-campo="fondo_m"
                 value="${a.fondo_m || ""}"></label>
      </div>
      ${acomodando ? controlesAcomodo(a, i) : (uno ? "" : `
      <label class="f"><span>Módulos en esta área</span>
        <input type="number" step="1" min="0" inputmode="numeric"
               id="sitioPan${i}" data-area="${i}" data-campo="paneles"
               placeholder="automático" value="${a.paneles || ""}"></label>`)}
    </div>`).join("");
  caja.oninput = (ev) => {
    const el = ev.target;
    if (!el.dataset || el.dataset.area === undefined) return;
    const a = areasEd()[Number(el.dataset.area)];
    if (!a) return;
    a[el.dataset.campo] = Number(el.value) || 0;
    calcularCaben();
  };
}

/* Del toque en pantalla a coordenadas de la foto original. */
function puntoEnFoto(ev) {
  const lienzo = $("#sitioLienzo");
  const r = lienzo.getBoundingClientRect();
  const t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
  return [(t.clientX - r.left) * (lienzo.width / r.width) / S.edSitioEscala,
          (t.clientY - r.top) * (lienzo.height / r.height) / S.edSitioEscala];
}

function tocarLienzo(ev) {
  const i = areaActiva();
  if (i < 0) return;
  const [x, y] = puntoEnFoto(ev);
  areasEd()[i].esquinas.push([Math.round(x), Math.round(y)]);
  pintarSitio();
}

/* =======================================================================
   Acomodar los paneles a mano
   El vendedor arrastra el bloque dentro del área, le cambia filas y
   columnas, lo gira, y toca un módulo para quitarlo cuando ahí hay un
   domo o un extractor. Los paneles siguen en cuadrícula: así el dibujo
   corresponde a algo que sí se puede instalar y la cuenta cuadra.
   ===================================================================== */

/* Se puede acomodar cuando todas las áreas están marcadas y medidas. */
function listoParaAcomodar() {
  const areas = areasEd();
  return areas.length > 0 && areas.every((a) =>
    (a.esquinas || []).length === 4 && Number(a.ancho_m) > 0 && Number(a.fondo_m) > 0);
}

/* La matriz de esa área, en coordenadas de la foto original. */
function hDeArea(a) {
  const e = a.esquinas || [];
  const A = Number(a.ancho_m) || 0, F = Number(a.fondo_m) || 0;
  if (e.length !== 4 || !(A > 0) || !(F > 0)) return null;
  return MCSitio.homografia([[0, 0], [A, 0], [A, F], [0, F]], e.map(([x, y]) => [x, y]));
}

/* Cuántas filas y columnas caben a tamaño real, sin encoger los módulos. */
function topesDeArea(a) {
  const margen = 0.6, sep = 0.03;
  const pa = a.giro ? 1.13 : 2.28, pl = a.giro ? 2.28 : 1.13;
  const cab = (t, m) => Math.max(Math.floor((Number(t) - 2 * margen + sep) / (m + sep)), 0);
  return { maxCol: cab(a.ancho_m, pa), maxFil: cab(a.fondo_m, pl) };
}

/* El acomodo que se ve hoy: el de a mano si lo hay, si no el automático. */
function acomodoEfectivo(i) {
  const a = areasEd()[i];
  if (!a) return { filas: 0, columnas: 0, giro: false };
  if (a.mano) return { filas: a.filas, columnas: a.columnas, giro: !!a.giro };
  const rep = MCSitio.repartir(areasEd(), Number(leerTecnico().paneles) || 0);
  const ac = MCSitio.acomodo(Number(a.ancho_m) || 0, Number(a.fondo_m) || 0, rep.asignado[i]);
  return { filas: ac.filas, columnas: ac.columnas, giro: ac.giro };
}

/* En cuanto el vendedor toca un área, esa área deja de ser automática y se
   queda con lo que él decida. Las demás siguen calculándose solas. */
function fijarAMano(i) {
  const a = areasEd()[i];
  if (!a) return null;
  if (!a.mano) {
    const ac = acomodoEfectivo(i);
    a.filas = ac.filas; a.columnas = ac.columnas; a.giro = !!ac.giro;
    a.off_x = 0; a.off_y = 0; a.quitados = [];
    a.mano = true;
  }
  return a;
}

/* Después de cualquier cambio a mano, los módulos de esa área son los que
   quedaron dibujados: ni uno más. */
function recontarArea(a) { a.paneles = MCSitio.cuantosEnRejilla(a); }

const dentroDe = (px, py, poly) => {
  let d = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
};

/* Dibuja el arreglo de cada área sobre la foto, listo para tocarlo. */
function pintarAcomodo(ctx, esc, areas) {
  const cot = Number(leerTecnico().paneles) || 0;
  const rep = MCSitio.repartir(areas, cot);
  S.edSitioCeldas = [];

  areas.forEach((a, ia) => {
    const color = COLOR_AREA[ia % COLOR_AREA.length];
    const e = a.esquinas || [];
    ctx.beginPath();
    e.forEach(([x, y], i) => (i ? ctx.lineTo(x * esc, y * esc) : ctx.moveTo(x * esc, y * esc)));
    ctx.closePath();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();

    const H = hDeArea({ ...a, ...acomodoEfectivo(ia) });
    if (!H) return;
    const { celdas } = MCSitio.rejilla({ ...a, ...acomodoEfectivo(ia) });
    const tope = rep.asignado[ia];
    let n = 0;
    for (const k of celdas) {
      const q = MCSitio.cuadroDeCelda(H, k).map(([x, y]) => [x * esc, y * esc]);
      const cabe = !k.fuera && (tope <= 0 || n < tope);
      ctx.beginPath();
      ctx.moveTo(q[0][0], q[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]);
      ctx.closePath();
      if (cabe) {
        ctx.fillStyle = "rgba(20,33,60,.88)"; ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.stroke();
        n++;
      } else {
        ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        ctx.stroke(); ctx.setLineDash([]);
      }
      /* se guarda en coordenadas de la foto para poder tocarlo después */
      S.edSitioCeldas.push({ ia, f: k.f, c: k.c, poly: MCSitio.cuadroDeCelda(H, k) });
    }
  });

  const paso = $("#sitioPaso");
  if (paso) paso.textContent = areas.length > 1
    ? "Arrastra cada arreglo para moverlo. Toca un módulo para quitarlo o regresarlo."
    : "Arrastra el arreglo para moverlo. Toca un módulo para quitarlo o regresarlo.";
}

/* ---------- el dedo sobre el lienzo ---------- */
function empezarToque(ev) {
  if (S.edSitioModo !== "acomodar" || !listoParaAcomodar()) return;
  const [x, y] = puntoEnFoto(ev);
  const celda = (S.edSitioCeldas || []).find((k) => dentroDe(x, y, k.poly));
  const ia = celda ? celda.ia
    : areasEd().findIndex((a) => dentroDe(x, y, (a.esquinas || []).map(([u, v]) => [u, v])));
  if (ia < 0) return;
  ev.preventDefault();
  const a = fijarAMano(ia);
  const Hinv = MCSitio.invertirH(hDeArea(a));
  if (!Hinv) return;
  S.edSitioArrastre = {
    ia, celda, Hinv, movido: false,
    origen: MCSitio.aMetros(Hinv, x, y),
    off: [Number(a.off_x) || 0, Number(a.off_y) || 0],
  };
}

function moverToque(ev) {
  const d = S.edSitioArrastre;
  if (!d) return;
  ev.preventDefault();
  const [x, y] = puntoEnFoto(ev);
  const p = MCSitio.aMetros(d.Hinv, x, y);
  const dx = p[0] - d.origen[0], dy = p[1] - d.origen[1];
  if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12 && !d.movido) return;
  d.movido = true;
  const a = areasEd()[d.ia];
  a.off_x = d.off[0] + dx; a.off_y = d.off[1] + dy;
  pintarSitio();
}

function soltarToque() {
  const d = S.edSitioArrastre;
  S.edSitioArrastre = null;
  if (!d) return;
  const a = areasEd()[d.ia];
  if (!d.movido && d.celda) {
    /* fue un toque, no un arrastre: se quita o se regresa ese módulo */
    const llave = d.celda.f + "," + d.celda.c;
    const q = Array.isArray(a.quitados) ? a.quitados : (a.quitados = []);
    const i = q.indexOf(llave);
    if (i >= 0) q.splice(i, 1); else q.push(llave);
  }
  recontarArea(a);
  pintarSitio();
}

/* ---------- los botones de cada área ---------- */
window.cambiarRejilla = (i, campo, paso) => {
  const a = fijarAMano(i);
  if (!a) return;
  const t = topesDeArea(a);
  const max = campo === "filas" ? t.maxFil : t.maxCol;
  const v = Math.max(1, Math.min(Math.round(Number(a[campo]) || 0) + paso, max));
  if (v === a[campo]) return;
  a[campo] = v;
  a.quitados = (a.quitados || []).filter((k) => {
    const [f, c] = k.split(",").map(Number);
    return f < a.filas && c < a.columnas;
  });
  recontarArea(a);
  pintarSitio();
};

window.girarRejilla = (i) => {
  const a = fijarAMano(i);
  if (!a) return;
  a.giro = !a.giro;
  const t = topesDeArea(a);
  a.filas = Math.max(1, Math.min(Number(a.filas) || 1, t.maxFil));
  a.columnas = Math.max(1, Math.min(Number(a.columnas) || 1, t.maxCol));
  a.quitados = [];
  recontarArea(a);
  pintarSitio();
};

window.centrarRejilla = (i) => {
  const a = fijarAMano(i);
  if (!a) return;
  a.off_x = 0; a.off_y = 0;
  pintarSitio();
};

window.autoRejilla = (i) => {
  const a = areasEd()[i];
  if (!a) return;
  a.mano = false; a.off_x = 0; a.off_y = 0; a.quitados = []; a.paneles = 0;
  pintarSitio();
};

window.modoAcomodar = () => {
  if (!listoParaAcomodar())
    return aviso("#edAviso", "Primero marca las cuatro esquinas y captura las medidas.");
  S.edSitioModo = "acomodar";
  pintarSitio();
};

window.modoMarcar = () => {
  S.edSitioModo = "marcar";
  pintarSitio();
};

function actualizarBotonesSitio() {
  const acomodando = S.edSitioModo === "acomodar" && listoParaAcomodar();
  const b1 = $("#btnAcomodar"), b2 = $("#btnMarcar"), b3 = $("#btnArea"), b4 = $("#btnRemarcar");
  if (b1) b1.hidden = acomodando || !listoParaAcomodar();
  if (b2) b2.hidden = !acomodando;
  if (b3) b3.hidden = acomodando || areasEd().length >= MCSitio.TOPE_AREAS;
  if (b4) b4.hidden = acomodando;
  const lz = $("#sitioLienzo");
  if (lz) lz.style.cursor = acomodando ? "grab" : "crosshair";
}

/* Cuántos módulos caben con las medidas capturadas, contra los cotizados. */
function calcularCaben() {
  const nota = $("#sitioCaben");
  if (!nota || !S.edSitio) return;
  /* las medidas se teclean sin repintar el lienzo, así que los botones
     —entre ellos el de acomodar— se refrescan desde aquí */
  actualizarBotonesSitio();
  const areas = areasEd();
  const cotizados = Number(leerTecnico().paneles) || 0;
  const conMedidas = areas.filter((a) => Number(a.ancho_m) > 0 && Number(a.fondo_m) > 0);
  if (conMedidas.length !== areas.length || !areas.length) {
    nota.textContent = areas.length > 1
      ? "Captura el ancho y el fondo de cada área para saber cuántos módulos caben."
      : "Captura el ancho y el fondo para saber cuántos módulos caben.";
    nota.className = "sitio-nota";
    return;
  }
  const rep = MCSitio.repartir(areas, cotizados);
  /* El acomodo de cada área se guarda para que el dibujo no lo recalcule mal.
     Las que el vendedor acomodó a mano NO se tocan: si no, cada vez que se
     repinta el lienzo se le borrarían las hileras y los módulos quitados. */
  areas.forEach((a, i) => {
    if (a.mano) return;
    const ac = MCSitio.acomodo(Number(a.ancho_m), Number(a.fondo_m), rep.asignado[i]);
    a.filas = ac.filas; a.columnas = ac.columnas; a.giro = ac.giro;
  });
  const detalle = areas.length > 1
    ? " (" + rep.asignado.map((n, i) => `área ${i + 1}: ${n}`).join(" · ") + ")"
    : "";
  if (!rep.caben) {
    nota.textContent = "Con esas medidas no cabe ni un módulo. Revisa el ancho y el fondo.";
    nota.className = "sitio-nota mal";
  } else if (cotizados && rep.total < cotizados) {
    /* No alcanzan: o el techo es chico, o el reparto a mano dejó módulos fuera. */
    const aMano = areas.some((a) => Number(a.paneles) > 0);
    nota.innerHTML = cotizados > rep.caben
      ? `⚠ En ${areas.length > 1 ? "esas áreas" : "ese techo"} caben <b>${rep.caben}</b>
         módulos y la cotización trae <b>${cotizados}</b>. Se dibujarán
         ${rep.total}${detalle}; revisa las medidas o el número de paneles.`
      : `⚠ Se dibujarán <b>${rep.total}</b> de los <b>${cotizados}</b> cotizados${detalle}.
         ${aMano ? "El acomodo que hiciste a mano deja fuera "
                 : "No alcanza el espacio para "}${cotizados - rep.total} módulos.`;
    nota.className = "sitio-nota mal";
  } else {
    nota.innerHTML = `Caben hasta <b>${rep.caben}</b> módulos · se dibujarán los
      <b>${rep.total}</b> de la cotización${detalle}.`;
    nota.className = "sitio-nota bien";
  }
}

function leerTecnico() {
  const t = {};
  $$("[data-tec]").forEach((i) => { t[i.dataset.tec] = i.value.trim(); });
  return t;
}

window.verVistaSitio = async function (boton) {
  const areas = areasEd();
  if (!areas.length || areas.some((a) => (a.esquinas || []).length !== 4))
    return aviso("#edAviso", areas.length > 1
      ? "Faltan esquinas por marcar en alguna de las áreas."
      : "Marca las cuatro esquinas del techo.");
  if (areas.some((a) => !(Number(a.ancho_m) > 0 && Number(a.fondo_m) > 0)))
    return aviso("#edAviso", areas.length > 1
      ? "Captura el ancho y el fondo de cada área, en metros."
      : "Captura el ancho y el fondo del techo, en metros.");
  const tec = leerTecnico();
  if (!Number(tec.paneles) || !Number(tec.wpanel))
    return aviso("#edAviso", "Primero captura el número de paneles y su capacidad en watts.");
  calcularCaben();
  await conBoton(boton, async () => {
    try {
      const r = await MCSitio.generarVistaSitio(S.edSitioFoto, S.edSitio, tec, logoEmpresa());
      S.edSitioImagen = r.url;
      const reparto = r.areas > 1
        ? " " + r.porArea.map((n, i) => `Área ${i + 1}: ${n}.`).join(" ")
        : "";
      $("#sitioResultado").innerHTML = `
        <img class="sitio-resultado" src="${r.url}" alt="Vista previa en el techo">
        <div class="acciones" style="margin-top:10px">
          <a class="btn pri sm" download="vista-previa.jpg" href="${r.url}">Descargar imagen</a>
        </div>
        <p class="sitio-nota">Se dibujaron ${r.dibujados} de los ${r.cotizados} módulos
          cotizados.${reparto}
          Toca <b>Guardar</b> para que la vista quede en la cotización y salga en el PDF.</p>`;
      aviso("#edAviso", "", "ok");
    } catch (e) { aviso("#edAviso", e.message); }
  }, "Dibujando…");
};

/* La misma foto, pero dentro de una cotización ya guardada. */
async function tomarFotoEditor(ev) {
  const archivo = ev.target.files && ev.target.files[0];
  if (!archivo) return;
  try {
    let datos = await comprimirImagen(archivo, 1500, 0.78);
    if (datos.length > 1600000) datos = await comprimirImagen(archivo, 1100, 0.65);
    S.edFotoProd = datos;
    pintarFotoEditor();
    aviso("#edAviso", "Foto lista. Toca Guardar para que quede en la cotización.", "ok");
  } catch {
    aviso("#edAviso", "No se pudo leer la imagen. Intenta con otra foto.");
  } finally { ev.target.value = ""; }
}

window.quitarFotoEditor = () => {
  S.edFotoProd = "";                       // cadena vacía = quitarla al guardar
  pintarFotoEditor();
  aviso("#edAviso", "Se quitará al guardar.", "ok");
};

function pintarFotoEditor() {
  const caja = $("#edProdPrev"); if (!caja) return;
  const quitar = $("#edProdQuitar"), nota = $("#edProdNota");
  if (S.edFotoProd) {
    caja.innerHTML = `<img src="${S.edFotoProd}" alt="Foto del producto">`;
    if (quitar) quitar.hidden = false;
    if (nota) nota.textContent = "Se imprime en la hoja del final.";
  } else {
    caja.innerHTML = '<div class="foto-vacia">Sin foto</div>';
    if (quitar) quitar.hidden = true;
    if (nota) nota.textContent = "Sin foto la propuesta sale igual, sólo sin esa hoja.";
  }
}

function pintarFotoProducto() {
  const caja = $("#rcProdPrev"); if (!caja) return;
  const quitar = $("#rcProdQuitar"), nota = $("#rcProdNota");
  if (S.rcFotoProd) {
    caja.innerHTML = `<img src="${S.rcFotoProd}" alt="Foto del producto">`;
    if (quitar) quitar.hidden = false;
    if (nota) nota.textContent = "Se imprime al final · "
      + Math.round(S.rcFotoProd.length / 1400) + " KB aprox.";
  } else {
    caja.innerHTML = '<div class="foto-vacia">Sin foto</div>';
    if (quitar) quitar.hidden = true;
    if (nota) nota.textContent = "Sin foto la propuesta sale igual, sólo sin esa hoja.";
  }
}

function pintarFoto() {
  const caja = $("#rcFotoPrev"); if (!caja) return;
  const quitar = $("#rcFotoQuitar"), nota = $("#rcFotoNota");
  if (S.rcFoto) {
    caja.innerHTML = `<img src="${S.rcFoto}" alt="Recibo de CFE">`;
    if (quitar) quitar.hidden = false;
    if (nota) nota.textContent = "Guardada · " + Math.round(S.rcFoto.length / 1400) + " KB aprox.";
  } else {
    caja.innerHTML = '<div class="foto-vacia">Sin foto</div>';
    if (quitar) quitar.hidden = true;
    if (nota) nota.textContent = "Opcional, pero sirve mucho para aclarar dudas después.";
  }
}

const CAMPOS_RC = ["rcCliente","rcServicio","rcDias","rcPago","rcDel","rcAl","rcDemanda","rcConsumo",
                   "rcBase","rcInter","rcPunta","rcModulos","rcInversores","rcPrecio","rcPanel"];

/* Los días salen de las fechas del recibo, pero quedan editables. */
const soloFecha = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

window.calcularDias = () => {
  const a = soloFecha($("#rcDel")?.value), b = soloFecha($("#rcAl")?.value);
  const nota = $("#rcDiasNota");
  if (!a || !b) { if (nota) nota.textContent = ""; return; }
  const dias = Math.round((b - a) / 86400000);
  if (dias <= 0) {
    if (nota) nota.textContent = "La fecha final debe ser posterior a la inicial.";
    return;
  }
  if ($("#rcDias")) $("#rcDias").value = dias;
  if (nota) nota.textContent = `${dias} días de facturación. Puedes corregirlo si el recibo dice otra cosa.`;
  recordarRecibo();
  calcRecibo();
};

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function periodoTexto() {
  const a = soloFecha($("#rcDel")?.value), b = soloFecha($("#rcAl")?.value);
  if (!a || !b) return "";
  const f = (d) => `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
  return `${f(a)} al ${f(b)}`;
}

function recordarRecibo() {
  S.rcValores = S.rcValores || {};
  CAMPOS_RC.forEach((id) => { const n = $("#" + id); if (n) S.rcValores[id] = n.value; });
}

function restaurarRecibo() {
  const v = S.rcValores || {};
  CAMPOS_RC.forEach((id) => {
    const n = $("#" + id);
    if (n && v[id] !== undefined && v[id] !== "") n.value = v[id];
  });
}

window.cambiarTarifa = (clave) => {
  recordarRecibo();
  S.rcTarifa = clave;
  pintarRecibo();
  restaurarRecibo();
  calcularDias();
  calcRecibo();
};

function tensionActual() {
  if ($("#rcTension")) return $("#rcTension").value;
  if ($("#rcHilos")) return $("#rcHilos").value;
  return "*";
}

function datosRecibo() {
  return {
    tarifa: S.rcTarifa,
    tension: tensionActual(),
    demanda: numero($("#rcDemanda")?.value),
    base: numero($("#rcBase")?.value), intermedia: numero($("#rcInter")?.value),
    punta: numero($("#rcPunta")?.value), consumo: numero($("#rcConsumo")?.value),
    dias: numero($("#rcDias")?.value), pago: numero($("#rcPago")?.value),
    servicio: ($("#rcServicio")?.value || "").trim(),
    panel: $("#rcPanel")?.value,
    modulosManual: numero($("#rcModulos")?.value),
    inversoresManual: numero($("#rcInversores")?.value),
    precioManual: numero($("#rcPrecio")?.value),
  };
}

function calcRecibo() {
  const d = datosRecibo();
  const r = calcularDimensionamiento(d);
  const n = (v, dec = 2) => Number(v || 0).toLocaleString("es-MX",
    { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const ajustado = d.modulosManual > 0 && d.modulosManual !== r.modulosEnteros;
  const precioTocado = d.precioManual > 0 && d.precioManual !== r.precioSugerido;
  if ($("#rcTensionTxt")) $("#rcTensionTxt").value = d.tension + " V";

  $("#rcResultado").innerHTML = `
    <h3>Resultado del dimensionamiento</h3>
    ${r.precioFueraDeRango ? `<div style="font-size:12.5px;color:var(--bad);background:#FBE4E2;
      border-radius:10px;padding:11px 13px;margin-bottom:12px">
      <b>Revisa la captura: el precio sale en $${n(r.precioKwh, 4)} por kWh.</b>
      Lo normal está entre $${n(r.precioMin, 2)} y $${n(r.precioMax, 2)}. Casi siempre es que el
      consumo o el total del recibo se capturaron mal, y eso descuadra el proyecto completo.</div>` : ""}
    <div class="grid3" style="margin-bottom:14px">
      <div class="kpi"><b>${n(r.usar, 0)}</b><span>Módulos</span></div>
      <div class="kpi"><b>${n(r.kwp)}</b><span>kWp</span></div>
      <div class="kpi"><b>${n(r.superficie, 0)}</b><span>m² requeridos</span></div>
      <div class="kpi"><b>${n(r.cobertura, 0)}%</b><span>de su recibo</span></div>
    </div>
    ${ajustado ? `<div style="font-size:12.5px;background:#E9F1FB;border-radius:10px;padding:11px 13px;margin-bottom:12px">
      El cálculo pedía <b>${n(r.modulosEnteros, 0)}</b> módulos; estás cotizando <b>${n(r.usar, 0)}</b>.
      Este sistema cubre el <b>${n(r.cobertura, 0)}%</b> de su consumo: el cliente seguirá pagando
      alrededor de <b>${money(Math.max(0, r.consumo * r.precioKwh - r.ahorroPeriodo))}</b>
      de energía por periodo de ${n(r.dias, 0)} días. Se puede ampliar después.</div>` : ""}
    ${!ajustado && r.cobertura >= 100 && r.consumo > 0 ? `
      <div style="font-size:12.5px;background:#E9F1FB;border-radius:10px;padding:11px 13px;margin-bottom:12px">
        Este sistema cubre <b>todo</b> su consumo de energía, así que la propuesta dirá que pagará
        <b>$0.00</b>. Recuérdale al cliente que CFE le seguirá cobrando el cargo fijo${
          Number(r.tar.cargo_fijo) ? ` — del orden de <b>${money(r.tar.cargo_fijo)}</b> por periodo` : ""
        } y el alumbrado público. La cotización ya lo trae escrito.</div>` : ""}
    ${precioTocado ? `<div style="font-size:12px;color:var(--warn);margin-bottom:10px">
      La tarifa marca <b>${money(r.precioSugerido)}</b> por panel; estás usando <b>${money(r.precioPanel)}</b>.</div>` : ""}
    ${r.fueraDeEscalon ? `<div style="font-size:12.5px;color:var(--warn);background:#FBF0E2;border-radius:10px;
      padding:11px 13px;margin-bottom:12px">
      <b>Fuera de la tabla de precios.</b> La tarifa ${esc(r.tar.clave || "")} tiene precio hasta
      ${Number(r.tope).toLocaleString("es-MX")} paneles y este proyecto pide ${n(r.usar, 0)}.
      Se está usando el precio del último escalón; confírmalo o captúralo a mano.</div>` : ""}
    ${r.fueraDeGuia ? `<div style="font-size:12.5px;color:var(--bad);background:#FBE4E2;border-radius:10px;
      padding:11px 13px;margin-bottom:12px">
      <b>Requiere revisión de ingeniería.</b> La guía de inversores llega hasta 1,000 módulos y este
      proyecto pide ${n(r.usar, 0)}. Captura los inversores a mano.</div>` : ""}
    ${r.guia ? `<div style="font-size:12.5px;background:#E9F1FB;border-radius:10px;padding:11px 13px;margin-bottom:12px">
      <b>${r.guia.inversores} inversor${r.guia.inversores === 1 ? "" : "es"} ${esc(paramTar().guia_marca || "")} ${esc(r.guia.modelo)}</b>
      · ${esc(r.guia.capacidad_ac)}<br>
      <span style="color:var(--slate)">${esc(r.guia.nota)}${r.cobraInv && r.precioInv > 0
        ? " · se cobra por separado" : " · incluido en el valor del proyecto"}</span></div>` : ""}

    <div class="spec" style="margin-bottom:6px">
      <div><span>Tarifa</span><b>${esc(r.tar.clave || "")} · ${esc(d.tension)} V</b></div>
      <div><span>Consumo total</span><b>${n(r.consumo, 0)} kWh</b></div>
      <div><span>Precio promedio</span><b>$${n(r.precioKwh, 4)} / kWh</b></div>
      <div><span>Consumo por día</span><b>${n(r.consumoDia)} kWh</b></div>
      <div><span>Genera un panel al día</span><b>${n(r.porPanelDia, 4)} kWh</b></div>
      <div><span>Producción mensual</span><b>${n(r.produccionMes, 0)} kWh</b></div>
      <div><span>Inversores</span><b>${r.inversores > 0 ? n(r.inversores, 0) : "por definir"}${
        r.guia && r.inversores === r.invSugeridos ? " · " + esc(r.guia.capacidad_ac) : ""}</b></div>
    </div>

    <div class="total-row"><span>Valor del proyecto</span><b>${money(r.valor)}</b></div>

    <div class="grid3" style="margin-top:16px">
      <div class="kpi"><b>${money(r.ahorroMes)}</b><span>Ahorro mensual</span></div>
      <div class="kpi"><b>${money(r.ahorroAnual)}</b><span>Ahorro anual</span></div>
      <div class="kpi"><b>${n(r.roi, 1)}</b><span>Años de retorno</span></div>
    </div>

    <div class="spec" style="margin-top:14px">
      <div><span>Enganche</span><b>${money(r.enganche)}</b></div>
      <div><span>Mensualidad a ${r.plazo} meses</span><b>${money(r.mensualidad)}</b></div>
      <div><span>Ahorro acumulado 30 años</span><b>${money(r.ahorro30)}</b></div>
      <div><span>Panel</span><b>${esc(r.panel.clave || "—")}</b></div>
    </div>`;
}

async function guardarRecibo(boton) {
  return conBoton(boton, () => _guardarRecibo());
}

async function _guardarRecibo() {
  S.cotCargadas = false;   /* la lista en memoria quedó vieja */
  const cliente = $("#rcCliente").value;
  if (!cliente) return aviso("#rcAviso", "Selecciona un cliente.");
  const d = datosRecibo();
  const r = calcularDimensionamiento(d);
  if (!(r.usar > 0) || !(r.valor > 0))
    return aviso("#rcAviso", "Captura el consumo y el pago a CFE para poder calcular.");
  const P = paramDim();
  try {
    const { cotizacion } = await api("cotizaciones", { method: "POST", body: {
      cliente_id: cliente, estatus: "borrador", linea: "fotovoltaico", tipo: "rapida",
      recibo_foto: S.rcFoto || null,
      foto_producto: S.rcFotoProd || null,
      partidas: [
        { clave: "SISTEMA-FV",
          descripcion: `Sistema fotovoltaico interconectado · ${r.usar} módulos de ${r.panel.clave} · ${r.kwp.toFixed(2)} kWp · tarifa ${r.tar.clave} en ${d.tension} V`
            + ((r.tar.incluye || []).length
                ? ` · Incluye ${r.tar.incluye.map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join(" y ")}`
                : ""),
          unidad: "MOD", cantidad: r.usar, precio: r.precioPanel },
        ...(r.cobraInv && r.precioInv > 0 ? [{
          clave: "INVERSOR",
          descripcion: `Inversor ${(paramTar().guia_marca || "")} ${r.guia ? r.guia.modelo : ""} · ${r.guia ? r.guia.capacidad_ac : ""}`.trim(),
          unidad: "PZA", cantidad: r.inversores, precio: r.precioInv }] : []),
      ],
      tecnico: {
        kwp: r.kwp.toFixed(2), paneles: String(r.usar),
        wpanel: String(Math.round((r.panel.kw || 0) * 1000)),
        inversores: String(r.inversores), tension: d.tension,
        capinversor: r.guia ? r.guia.capacidad_ac : "",
        marcainversor: r.guia ? ((paramTar().guia_marca || "") + " " + r.guia.modelo).trim() : "",
        produccion: String(Math.round(r.produccionMes * 2)),
      },
      ahorro: {
        actual: Math.round(d.pago),
        nuevo: Math.max(0, Math.round(d.pago - r.ahorroPeriodo)),
        cobertura: Math.round(r.cobertura),
        cargo_fijo: Number(r.tar.cargo_fijo) || 0,
        roi: Number(r.roi.toFixed(1)), anual: Math.round(r.ahorroAnual),
      },
      recibo: {
        tarifa: r.tar.clave, tarifa_nombre: r.tar.nombre, grupo: r.tar.grupo,
        tension: d.tension, hilos: $("#rcHilos") ? $("#rcHilos").selectedIndex + 1 : null,
        demanda_contratada: d.demanda || null,
        base: d.base, intermedia: d.intermedia, punta: d.punta,
        consumo_total: Math.round(r.consumo), dias: d.dias, pago: d.pago,
        no_servicio: d.servicio || null,
        periodo: periodoTexto(),
        periodo_del: $("#rcDel")?.value || null, periodo_al: $("#rcAl")?.value || null,
        uvie: !!r.tar.uvie, gestion: !!r.tar.gestion,
        inversores: r.inversores, inversor_modelo: r.guia ? r.guia.modelo : null,
        inversor_capacidad: r.guia ? r.guia.capacidad_ac : null,
        inversor_aplicacion: r.guia ? r.guia.nota : null,
        inversor_cobrado: r.cobraInv, revision_ingenieria: r.fueraDeGuia,
        precio_kwh: Number(r.precioKwh.toFixed(4)), consumo_dia: Math.round(r.consumoDia),
        superficie_m2: Math.round(r.superficie), produccion_mes: Math.round(r.produccionMes),
        ahorro_mes: Math.round(r.ahorroMes), ahorro_30: Math.round(r.ahorro30),
        enganche: Math.round(r.enganche), mensualidad: Math.round(r.mensualidad), plazo: r.plazo,
      },
      comentarios: "Cotización preliminar. No tendrá validez definitiva hasta la visita técnica del área de ingeniería, "
        + "en la que se inspeccionará el sitio, se tomarán medidas y se analizarán las condiciones de instalación. "
        + "Con base en esa evaluación se determinará la cantidad final de paneles que pueden instalarse de forma segura "
        + "y eficiente, por lo que el alcance y el importe podrán ajustarse.",
    }});
    aviso("#rcAviso", "Guardada como " + cotizacion.folio, "ok");
    trasGuardarRapida(cotizacion);
  } catch (x) { aviso("#rcAviso", x.message); }
}

/* ---- parámetros del dimensionamiento (solo dueño) ---- */
function formDimensionamiento() {
  const P = paramDim();
  const paneles = P.paneles || [];
  const campo = (k, etq, paso = "0.01") =>
    `<label class="f"><span>${etq}</span><input name="${k}" type="number" step="${paso}" value="${Number(P[k] || 0)}"></label>`;
  abrirModal("Parámetros del dimensionamiento", `
    <form id="fDim">
      <div class="grid2">
        ${campo("m2_por_panel", "m² por panel")}
        ${campo("dias_periodo", "Días del periodo", "1")}
        ${campo("enganche_pct", "Enganche %", "1")}
        ${campo("plazo_meses", "Plazo en meses", "1")}
        ${campo("precio_kwh_min", "Precio kWh mínimo", "0.1")}
        ${campo("precio_kwh_max", "Precio kWh máximo", "0.1")}
      </div>
      <p style="font-size:11.5px;color:var(--slate);margin:-4px 0 4px">
        Si una cotización sale fuera de ese rango, la app avisa que revisen la captura del recibo.
        Deja los dos en cero para apagar el aviso.</p>
      <div style="font-weight:700;font-size:13px;margin:14px 0 8px">Tipos de panel</div>
      ${paneles.map((x, i) => `
        <div class="grid3" style="gap:8px;margin-bottom:8px">
          <label class="f" style="margin:0"><span>Clave</span><input name="p${i}_clave" value="${esc(x.clave)}"></label>
          <label class="f" style="margin:0"><span>kW</span><input name="p${i}_kw" type="number" step="0.001" value="${x.kw}"></label>
          <label class="f" style="margin:0"><span>Eficiencia</span><input name="p${i}_ef" type="number" step="0.01" value="${x.eficiencia}"></label>
          <label class="f" style="margin:0;grid-column:span 3"><span>Horas solares</span>
            <input name="p${i}_hs" type="number" step="0.1" value="${x.horas_solares}"></label>
        </div>`).join("")}
      <button class="btn pri full" type="submit">Guardar parámetros</button>
    </form>`);
  $("#fDim").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    const valor = {
      precio_por_panel: Number(P.precio_por_panel) || 0,
      m2_por_panel: numero(d.m2_por_panel), dias_periodo: numero(d.dias_periodo),
      enganche_pct: numero(d.enganche_pct), plazo_meses: numero(d.plazo_meses),
      precio_kwh_min: numero(d.precio_kwh_min), precio_kwh_max: numero(d.precio_kwh_max),
      iva_incluido: P.iva_incluido !== false,
      paneles: paneles.map((_, i) => ({
        clave: d[`p${i}_clave`], kw: numero(d[`p${i}_kw`]),
        eficiencia: numero(d[`p${i}_ef`]), horas_solares: numero(d[`p${i}_hs`]),
      })),
    };
    try {
      await api("config", { method: "PATCH", body: { clave: "dimensionamiento", valor } });
      await cargarConfig();
      cerrarModal();
      alert("Parámetros actualizados.");
    } catch (x) { aviso("#modalError", x.message); }
  });
}


/* ---- datos de la empresa que firma las propuestas (solo dueño) ----
   Es lo que permite que cada instalación salga con su propio nombre y logo
   en lugar de los de quien escribió la aplicación. */
function formEmpresa() {
  const E = empresa();
  const campo = (k, etq, ayuda = "") =>
    `<label class="f"><span>${etq}</span>
       <input name="${k}" value="${esc(E[k] || "")}" autocomplete="off">
       ${ayuda ? `<small style="color:var(--slate)">${ayuda}</small>` : ""}
     </label>`;
  abrirModal("Datos de la empresa", `
    <p style="font-size:13px;color:var(--slate);margin-bottom:14px">
      Esto es lo que aparece en las cotizaciones, en los vales de almacén y en la
      hoja de contacto. Cámbialo y todas las propuestas que imprimas de aquí en
      adelante salen con estos datos.</p>
    <form id="fEmpresa">
      ${campo("razon_social", "Razón social *")}
      ${campo("giro", "Giro", "Sale bajo el nombre. Ejemplo: Sistemas fotovoltaicos · Soluciones eléctricas")}
      ${campo("whatsapp", "WhatsApp")}
      ${campo("correo", "Correo")}
      ${campo("web", "Sitio web")}
      ${campo("cobertura", "Zona que atiende", "Ejemplo: CDMX y Estado de México")}
      ${campo("titulo_propuesta", "Título de la portada",
              "El encabezado grande de la primera hoja. Si lo dejas vacío se usa el de siempre.")}

      <div class="f">
        <span>Logo ${pista("logo")}</span>
        <div style="display:flex;gap:12px;align-items:center;margin-top:6px">
          <div id="empLogoPrev" style="width:96px;height:96px;border:1px dashed #cbd5e1;border-radius:8px;
               display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff">
            <img src="${logoEmpresa()}" alt="" style="max-width:100%;max-height:100%">
          </div>
          <div>
            <label class="btn sm" style="display:inline-block">
              Elegir logo
              <input type="file" accept="image/*" style="display:none" onchange="subirLogo(event)">
            </label>
            <button type="button" class="btn sm" onclick="quitarLogo()">Quitar</button>
            <small style="display:block;color:var(--slate);margin-top:6px">
              PNG o JPG. Se guarda dentro de la aplicación; no hace falta subirlo al servidor.</small>
          </div>
        </div>
      </div>

      <div class="f">
        <span>Foto de portada</span>
        <div style="display:flex;gap:12px;align-items:center;margin-top:6px">
          <div id="empPortPrev" style="width:140px;height:80px;border:1px dashed #cbd5e1;border-radius:8px;
               display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff">
            ${portadaEmpresa() ? `<img src="${portadaEmpresa()}" alt="" style="width:100%;height:100%;object-fit:cover">`
                               : `<small style="color:var(--slate)">Sin foto</small>`}
          </div>
          <div>
            <label class="btn sm" style="display:inline-block">
              Elegir foto
              <input type="file" accept="image/*" style="display:none" onchange="subirPortada(event)">
            </label>
            <button type="button" class="btn sm" onclick="quitarPortada()">Quitar</button>
            <small style="display:block;color:var(--slate);margin-top:6px">
              La banda ancha de la primera hoja. Sin foto, la portada sale sin ella.</small>
          </div>
        </div>
      </div>

      <h3 style="margin:18px 0 4px">Misión y visión</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:10px">
        Es el texto de la portada. <b>Déjalo vacío y ese bloque no se imprime</b>, en lugar de
        salir con palabras que no son de tu empresa.</p>
      <label class="f"><span>Título de la misión</span>
        <input name="mision_titulo" value="${esc(E.mision_titulo || "")}" autocomplete="off"></label>
      <label class="f"><span>Misión</span>
        <textarea name="mision_texto" rows="5">${esc(E.mision_texto || "")}</textarea></label>
      <label class="f"><span>Título de la visión</span>
        <input name="vision_titulo" value="${esc(E.vision_titulo || "")}" autocomplete="off"></label>
      <label class="f"><span>Visión</span>
        <textarea name="vision_texto" rows="5">${esc(E.vision_texto || "")}</textarea></label>

      <div id="modalError"></div>
      <button class="btn pri" type="submit">Guardar</button>
    </form>`);
  S.empLogo = E.logo || "";
  S.empPortada = E.portada || "";
  document.querySelector("#fEmpresa").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    if (!String(d.razon_social || "").trim())
      return aviso("#modalError", "La razón social no puede quedar vacía: es lo que firma la cotización.");
    try {
      await api("config", { method: "PATCH", body: { clave: "empresa", valor: {
        razon_social: d.razon_social, giro: d.giro, whatsapp: d.whatsapp,
        correo: d.correo, web: d.web, cobertura: d.cobertura,
        titulo_propuesta: d.titulo_propuesta, logo: S.empLogo || "",
        mision_titulo: d.mision_titulo, mision_texto: d.mision_texto,
        vision_titulo: d.vision_titulo, vision_texto: d.vision_texto,
        portada: S.empPortada || "",
      } } });
      await cargarConfig();
      cerrarModal();
      alert("Datos de la empresa actualizados.");
    } catch (x) { aviso("#modalError", x.message); }
  });
}

/* El logo se reduce antes de guardarlo: entra a la base como data URL. */
window.subirLogo = async (ev) => {
  const archivo = ev.target.files && ev.target.files[0];
  if (!archivo) return;
  try {
    let datos = await comprimirImagen(archivo, 600, 0.9);
    if (datos.length > 500000) datos = await comprimirImagen(archivo, 400, 0.8);
    S.empLogo = datos;
    document.querySelector("#empLogoPrev").innerHTML =
      `<img src="${datos}" alt="" style="max-width:100%;max-height:100%">`;
  } catch {
    aviso("#modalError", "No se pudo leer la imagen. Intenta con otro archivo.");
  } finally { ev.target.value = ""; }
};

window.subirPortada = async (ev) => {
  const archivo = ev.target.files && ev.target.files[0];
  if (!archivo) return;
  try {
    let datos = await comprimirImagen(archivo, 1600, 0.78);
    if (datos.length > 1500000) datos = await comprimirImagen(archivo, 1200, 0.68);
    S.empPortada = datos;
    document.querySelector("#empPortPrev").innerHTML =
      `<img src="${datos}" alt="" style="width:100%;height:100%;object-fit:cover">`;
  } catch {
    aviso("#modalError", "No se pudo leer la imagen. Intenta con otro archivo.");
  } finally { ev.target.value = ""; }
};

window.quitarPortada = () => {
  S.empPortada = "";
  document.querySelector("#empPortPrev").innerHTML =
    `<small style="color:var(--slate)">Sin foto</small>`;
};

window.quitarLogo = () => {
  S.empLogo = "";
  document.querySelector("#empLogoPrev").innerHTML =
    `<img src="/icons/logo.png" alt="" style="max-width:100%;max-height:100%">`;
};

/* ---- tarifas y precios por panel (solo dueño) ---- */
function formTarifas() {
  const T = paramTar();
  const lista = T.lista || [];
  abrirModal("Tarifas y precio por panel", `
    <p style="font-size:12.5px;color:var(--slate);margin-bottom:14px">
      El precio se resuelve por tarifa, tensión y cantidad de módulos. "Hasta" es el tope de
      módulos de ese escalón. Cada tarifa lleva además su propio rango normal de precio por
      kWh: el de media tensión es más bajo que el de casa o negocio.</p>
    <form id="fTar">
      ${lista.map((t, i) => `
        <div class="card" style="box-shadow:none;margin-bottom:10px">
          <h3 style="font-size:13.5px">${esc(t.nombre)}</h3>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:10px">
            <label style="font-size:12px;display:flex;align-items:center;gap:6px">
              <input type="checkbox" name="t${i}_uvie" ${t.uvie ? "checked" : ""} style="width:auto"> UVIE</label>
            <label style="font-size:12px;display:flex;align-items:center;gap:6px">
              <input type="checkbox" name="t${i}_gestion" ${t.gestion ? "checked" : ""} style="width:auto"> Gestión</label>
            <label style="font-size:12px;display:flex;align-items:center;gap:6px">
              <input type="checkbox" name="t${i}_horaria" ${t.horaria ? "checked" : ""} style="width:auto"> Horaria</label>
          </div>
          <label class="f"><span>Cargo fijo de CFE por periodo ($)</span>
            <input name="t${i}_cargo" type="number" step="0.01" value="${Number(t.cargo_fijo) || 0}">
            <small style="font-size:11px;color:var(--slate)">Lo que CFE sigue cobrando aunque el
              sistema cubra todo el consumo. Se imprime en la cotización.</small></label>
          <div class="grid2" style="gap:8px">
            <label class="f" style="margin:0"><span>Precio kWh mínimo</span>
              <input name="t${i}_pmin" type="number" step="0.1" value="${Number(t.precio_kwh_min) || 0}"></label>
            <label class="f" style="margin:0"><span>Precio kWh máximo</span>
              <input name="t${i}_pmax" type="number" step="0.1" value="${Number(t.precio_kwh_max) || 0}"></label>
          </div>
          <small style="font-size:11px;color:var(--slate);display:block;margin:-4px 0 10px">
            Si el precio del recibo sale fuera de este rango, la app avisa que revisen la captura.
            En cero, se usa el rango general de los parámetros del dimensionamiento.</small>
          ${(t.escalones || []).map((e, j) => `
            <div class="grid3" style="gap:8px;margin-bottom:6px">
              <label class="f" style="margin:0"><span>Tensión</span>
                <input name="t${i}e${j}_tension" value="${esc(e.tension)}"></label>
              <label class="f" style="margin:0"><span>Hasta módulos</span>
                <input name="t${i}e${j}_hasta" type="number" value="${Number(e.hasta)}"></label>
              <label class="f" style="margin:0"><span>Precio</span>
                <input name="t${i}e${j}_precio" type="number" value="${Number(e.precio)}"></label>
            </div>`).join("")}
        </div>`).join("")}
      <button class="btn pri full" type="submit">Guardar tarifas</button>
    </form>`);
  $("#fTar").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    const valor = { ...T, lista: lista.map((t, i) => ({
      ...t,
      uvie: !!d[`t${i}_uvie`], gestion: !!d[`t${i}_gestion`], horaria: !!d[`t${i}_horaria`],
      cargo_fijo: numero(d[`t${i}_cargo`]),
      precio_kwh_min: numero(d[`t${i}_pmin`]), precio_kwh_max: numero(d[`t${i}_pmax`]),
      escalones: (t.escalones || []).map((e, j) => ({
        tension: d[`t${i}e${j}_tension`],
        hasta: numero(d[`t${i}e${j}_hasta`]),
        precio: numero(d[`t${i}e${j}_precio`]),
      })),
    })) };
    try {
      await api("config", { method: "PATCH", body: { clave: "tarifas", valor } });
      await cargarConfig();
      cerrarModal();
      alert("Tarifas actualizadas.");
    } catch (x) { aviso("#modalError", x.message); }
  });
}

/* ---- guía de inversores (solo dueño) ---- */
function formInversores() {
  const T = paramTar();
  const g = T.guia_inversores || [];
  if (!g.length) return alert("Todavía no hay guía de inversores cargada.");
  abrirModal("Guía de inversores", `
    <p style="font-size:12.5px;color:var(--slate);margin-bottom:14px">
      La app elige el inversor por cantidad de paneles. Arriba de ${Number(g[g.length - 1].hasta).toLocaleString("es-MX")}
      paneles avisa que requiere revisión de ingeniería.</p>
    <form id="fInv">
      <label class="f"><span>Marca</span>
        <input name="marca" value="${esc(T.guia_marca || "")}"></label>
      <label style="font-size:13px;display:flex;align-items:center;gap:8px;margin:4px 0 14px">
        <input type="checkbox" name="cobra" id="invCobra" style="width:auto"
          ${T.inversor_se_cobra ? "checked" : ""}>
        Cobrar el inversor como partida aparte</label>
      <div id="invPrecios" style="${T.inversor_se_cobra ? "" : "display:none"}">
        <div class="grid2" style="gap:8px;margin-bottom:10px">
          <label class="f" style="margin:0"><span>Poner este precio en todos</span>
            <input type="number" id="invTodos" placeholder="0"></label>
          <button class="btn sm" type="button" onclick="invAplicarTodos()"
            style="align-self:end;margin-bottom:2px">Aplicar</button>
        </div>
        ${g.map((x, i) => `
          <div class="grid2" style="gap:8px;margin-bottom:6px;align-items:end">
            <div style="font-size:12px;color:var(--slate);line-height:1.35">
              <b style="color:var(--ink)">${Number(x.desde).toLocaleString("es-MX")}–${Number(x.hasta).toLocaleString("es-MX")} paneles</b><br>
              ${x.inversores} × ${esc(x.modelo)} · ${esc(x.capacidad_ac)}</div>
            <label class="f" style="margin:0"><span>Precio c/u</span>
              <input class="invP" name="p${i}" type="number" value="${Number(x.precio) || 0}"></label>
          </div>`).join("")}
      </div>
      <button class="btn pri full" type="submit">Guardar guía</button>
    </form>`);
  $("#invCobra").addEventListener("change", (ev) => {
    $("#invPrecios").style.display = ev.target.checked ? "" : "none";
  });
  $("#fInv").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    const valor = { ...T, guia_marca: String(d.marca || "").trim(), inversor_se_cobra: !!d.cobra,
      guia_inversores: g.map((x, i) => ({ ...x, precio: numero(d[`p${i}`]) })) };
    try {
      await api("config", { method: "PATCH", body: { clave: "tarifas", valor } });
      await cargarConfig();
      cerrarModal();
      alert("Guía de inversores actualizada.");
    } catch (x) { aviso("#modalError", x.message); }
  });
}
window.invAplicarTodos = () => {
  const v = $("#invTodos")?.value;
  if (v === "" || v === undefined) return;
  document.querySelectorAll(".invP").forEach((i) => { i.value = v; });
};

Object.assign(window, { rapidaRecibo, guardarRecibo, calcRecibo, formDimensionamiento,
                        calcularDimensionamiento, formTarifas, formInversores, pintarRecibo });

/* ---------------- selector de cliente con buscador ----------------
   El desplegable traía la lista entera y había que bajar hasta encontrar al
   cliente. Ahora se escribe el nombre arriba y la lista se reduce sola; si
   queda uno solo, se elige solo. Busca también por RPU y por teléfono. */
function campoCliente(idSel, elegido = "", etiqueta = "Cliente") {
  return `
    <label class="f"><span>${etiqueta}</span>
      <div class="selcli">
        <input class="qcli" id="${idSel}Q" type="search" autocomplete="off" inputmode="search"
               placeholder="Escribe el nombre, RPU o teléfono">
        <span class="cuenta" id="${idSel}Cuenta"></span>
        <select id="${idSel}" data-sel="${esc(elegido)}"></select>
      </div>
    </label>`;
}

function pintarOpcionesCliente(idSel) {
  const sel = $("#" + idSel);
  if (!sel) return;
  const caja = $("#" + idSel + "Q");
  const q = paraBuscar(caja ? caja.value : "").trim();
  const solo = (v) => String(v || "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
  const qn = solo(q);
  const antes = sel.value || sel.dataset.sel || "";

  const lista = !q ? S.clientes : S.clientes.filter((c) =>
    paraBuscar([c.nombre, c.contacto, c.telefono, c.referencia].filter(Boolean).join(" ")).includes(q) ||
    (qn.length >= 3 && (solo(c.referencia).includes(qn) || solo(c.telefono).includes(qn))));

  /* el cliente ya elegido nunca se pierde, aunque no coincida con lo escrito */
  const yaEsta = lista.some((c) => String(c.id) === String(antes));
  const mostrar = (antes && !yaEsta)
    ? [S.clientes.find((c) => String(c.id) === String(antes)), ...lista].filter(Boolean)
    : lista;

  sel.innerHTML = `<option value="">— Selecciona —</option>` +
    mostrar.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");

  /* si la búsqueda dejó un solo cliente, ya no hay que elegirlo a mano */
  const nuevo = (q && lista.length === 1) ? String(lista[0].id) : String(antes || "");
  sel.value = nuevo;
  sel.dataset.sel = sel.value;
  if (String(antes) !== sel.value) sel.dispatchEvent(new Event("change", { bubbles: true }));

  const cuenta = $("#" + idSel + "Cuenta");
  if (cuenta) cuenta.textContent = q ? `${lista.length} de ${S.clientes.length}` : "";
}

function refrescarSelectoresCliente(idNuevo = null) {
  ["edCliente", "rpCliente", "rcCliente"].forEach((idSel) => {
    const sel = $("#" + idSel);
    if (!sel) return;
    if (idNuevo) sel.dataset.sel = String(idNuevo);
    const caja = $("#" + idSel + "Q");
    if (caja) caja.value = "";
    pintarOpcionesCliente(idSel);
  });
}

function activarBuscadorCliente(idSel) {
  pintarOpcionesCliente(idSel);
  const caja = $("#" + idSel + "Q");
  if (caja) {
    const pintar = () => pintarOpcionesCliente(idSel);
    caja.addEventListener("input", pintar);
    caja.addEventListener("search", pintar);
  }
  const sel = $("#" + idSel);
  if (sel) sel.addEventListener("change", () => { sel.dataset.sel = sel.value; });
}

/* ---------------- clientes ---------------- */

async function verClientes() {
  pintarClientes();
}

function pintarClientes() {
  if (!S.clientes.length) {
    $("#listaCli").innerHTML = '<div class="vacio">Sin clientes todavía.<br>Toca <b>+</b> para agregar el primero.</div>';
    if ($("#qCliCuenta")) $("#qCliCuenta").textContent = "";
    return;
  }
  const q = paraBuscar($("#qCli") ? $("#qCli").value : "").trim();
  const solo = (v) => String(v || "").replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
  const qn = solo(q);
  const lista = !q ? S.clientes : S.clientes.filter((c) =>
    paraBuscar([c.nombre, c.contacto, c.telefono, c.correo, c.direccion, c.referencia]
      .filter(Boolean).join(" ")).includes(q) ||
    (qn.length >= 3 && (solo(c.referencia).includes(qn) || solo(c.telefono).includes(qn))));

  const cuenta = $("#qCliCuenta");
  if (cuenta) cuenta.textContent = q ? `${lista.length} de ${S.clientes.length}` : "";

  $("#listaCli").innerHTML = !lista.length
    ? `<div class="sin-resultados">Ningún cliente coincide con <b>${esc($("#qCli").value)}</b>.<br>
         Se busca por nombre, número de servicio (RPU), teléfono y correo.</div>`
    : lista.map((c) => {
        const n = Number(c.cotizaciones || 0);   /* lo cuenta la base de datos */
        return `
      <div class="item" onclick='formCliente(${c.id})'>
        <div class="m"><b>${esc(c.nombre)}</b>
        <span>${esc(c.telefono || c.correo || c.direccion || "Sin datos de contacto")}</span>
        ${c.referencia ? `<span>RPU ${esc(c.referencia)}</span>` : ""}</div>
        <div class="r">
          ${n ? `<span class="badge b-enviada">${n} ${n === 1 ? "cotización" : "cotizaciones"}</span>` : ""}
          <span style="color:var(--slate);font-size:19px">›</span>
        </div>
      </div>`;
      }).join("");
}

function formCliente(id = null) {
  /* Si llega un evento de clic en vez de un id (le pasaba al botón +), se
     trata como cliente nuevo: si no, se mandaba una actualización de un
     cliente inexistente y el servidor contestaba «Cliente no encontrado». */
  if (id !== null && typeof id !== "number" && typeof id !== "string") id = null;
  const c = id ? S.clientes.find((x) => String(x.id) === String(id)) || {} : {};
  const campo = (k, etq, tipo = "text") =>
    `<label class="f"><span>${etq}</span><input name="${k}" type="${tipo}" value="${esc(c[k] || "")}"></label>`;
  /* El almacenista consulta la ficha y el material entregado; no edita. */
  if (esAlmacen()) {
    if (!id) return;
    abrirModal("Cliente", `
      <div class="spec" style="margin-bottom:6px">
        <div><span>Nombre</span><b style="white-space:normal">${esc(c.nombre || "")}</b></div>
        ${c.contacto ? `<div><span>Contacto</span><b>${esc(c.contacto)}</b></div>` : ""}
        ${c.telefono ? `<div><span>Teléfono</span><b>${esc(c.telefono)}</b></div>` : ""}
        ${c.direccion ? `<div><span>Dirección</span><b style="white-space:normal">${esc(c.direccion)}</b></div>` : ""}
      </div>
      <div class="cotcli" id="valCli"><div class="cargando">Cargando vales…</div></div>`);
    pintarValesDeCliente(id);
    return;
  }
  abrirModal(id ? "Editar cliente" : "Nuevo cliente", `
    ${id ? `<div class="cotcli arriba" id="cotCli"><div class="cargando">Cargando cotizaciones…</div></div>` : ""}
    ${id && esDueno() ? `<div class="cotcli arriba" id="valCli"><div class="cargando">Cargando vales…</div></div>` : ""}
    <form id="fCli">
      <label class="f"><span>Nombre o razón social *</span><input name="nombre" required value="${esc(c.nombre || "")}"></label>
      ${campo("contacto", "Persona de contacto")}
      ${campo("telefono", "Teléfono", "tel")}
      ${campo("correo", "Correo", "email")}
      ${campo("direccion", "Dirección")}
      ${campo("referencia", "No. de servicio (RPU)")}
      <label class="f"><span>Notas</span><textarea name="notas">${esc(c.notas || "")}</textarea></label>
      <button class="btn pri full" type="submit">Guardar</button>
    </form>`);
  if (id) pintarCotizacionesDeCliente(id);
  if (id && esDueno()) pintarValesDeCliente(id);
  $("#fCli").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    const boton = ev.target.querySelector("button[type=submit]");
    await conBoton(boton, async () => {
      try {
        let creado = null;
        if (id) await api("clientes", { method: "PATCH", body: { id, ...d } });
        else creado = await api("clientes", { method: "POST", body: d });
        await cargarClientes();
        cerrarModal();
        if (vistaActual === "cli") verClientes();
        /* Si se estaba capturando una cotización, el cliente recién dado de
           alta aparece ya elegido, sin volver a dibujar la pantalla (así no
           se pierde lo que el vendedor llevaba escrito). */
        refrescarSelectoresCliente(creado && creado.cliente ? creado.cliente.id : null);
      } catch (x) {
        /* Si el servidor avisa que el cliente ya existe, se ofrece abrirlo en
           lugar de crear otro. Es la causa de los clientes repetidos. */
        const ya = x.status === 409 ? (x.datos || {}) : null;
        if (ya && ya.cliente) {
          aviso("#modalError", x.message + " " + (ya.mensaje_extra || ""));
          const caja = $("#modalError");
          const b = document.createElement("button");
          b.className = "btn sec sm";
          b.style.cssText = "margin-top:10px;display:flex";
          b.type = "button";
          b.textContent = "Abrir «" + ya.cliente.nombre + "»";
          b.onclick = () => formCliente(ya.cliente.id);
          caja.appendChild(b);
        } else if (ya) {
          aviso("#modalError", x.message + " " + (ya.mensaje_extra || ""));
        } else {
          aviso("#modalError", x.message);
        }
      }
    });
  });
}

/* Dentro de la ficha del cliente: todas sus cotizaciones, de la más nueva a
   la más vieja, con su importe y su estatus. Un toque abre cualquiera. */
async function pintarCotizacionesDeCliente(clienteId) {
  const caja = $("#cotCli");
  if (!caja) return;

  /* Se le preguntan al servidor las de ESTE cliente. Antes se filtraban de la
     lista general, que viene recortada a las más recientes, y un cliente con
     40 cotizaciones podía aparecer con 0. */
  let lista = [];
  try {
    const r = await api("cotizaciones?cliente=" + clienteId + "&tope=500");
    lista = r.cotizaciones || [];
  } catch (e) {
    if ($("#cotCli")) $("#cotCli").innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
    return;
  }
  if (!$("#cotCli")) return;          // cerró la ficha mientras cargaba
  const ganado = lista.filter((c) => c.estatus === "ganada")
                      .reduce((s, c) => s + Number(c.total || 0), 0);
  const total = lista.reduce((s, c) => s + Number(c.total || 0), 0);

  const resumen = !lista.length ? "" :
    `<div class="resumen">${lista.length} ${lista.length === 1 ? "cotización" : "cotizaciones"}
       · ${money(total)} cotizado${ganado > 0 ? ` · ${money(ganado)} ganado` : ""}</div>`;

  const filas = !lista.length
    ? `<div class="vacio" style="padding:14px 0">Este cliente todavía no tiene cotizaciones.</div>`
    : lista.map((c) => `
      <div class="item" onclick="abrirDesdeCliente(${c.id})">
        <div class="m"><b>${esc(c.folio)}</b>
          <span>${fecha(c.creado_en)} · ${LINEAS[c.linea] || ""}${c.tipo === "rapida" ? " · rápida" : ""}${esDueno() && c.vendedor ? " · " + esc(c.vendedor) : ""}</span>
        </div>
        <div class="r"><b>${money(c.total)}</b>
          <span class="badge b-${c.estatus}">${ESTATUS[c.estatus] || c.estatus}</span>
        </div>
      </div>`).join("");

  $("#cotCli").innerHTML = `
    <h4>Cotizaciones de este cliente</h4>
    ${resumen}
    ${filas}
    <button class="btn sec full" type="button" style="margin-top:10px"
            onclick="nuevaParaCliente(${clienteId})">+ Nueva cotización para este cliente</button>`;
}

/* Abre una cotización desde la ficha del cliente: cierra la ficha primero. */
function abrirDesdeCliente(id) {
  cerrarModal();
  abrirCotizacion(id);
}

/* Empieza una cotización con este cliente ya elegido. */
function nuevaParaCliente(clienteId) {
  cerrarModal();
  S.editor = {
    id: null, folio: "(nueva)", cliente_id: String(clienteId), estatus: "borrador",
    tecnico: {}, partidas: [], ahorro: {}, comentarios: "",
  };
  editor();
}

/* ---------------- clientes repetidos (solo administrador) ----------------
   Se listan agrupados. El administrador marca cuál se queda y al unir, las
   cotizaciones y los movimientos de los otros se le pasan a ése antes de
   borrarlos: no se pierde trabajo. */
async function verDuplicados() {
  abrirModal("Clientes repetidos", '<div class="cargando">Buscando repetidos…</div>');
  try {
    const { grupos, total } = await api("clientes/duplicados");
    S.duplicados = grupos;
    pintarDuplicados(total);
  } catch (e) {
    $("#modalCuerpo").innerHTML = `<div class="vacio">${esc(e.message)}</div>`;
  }
}

function pintarDuplicados(total) {
  const grupos = S.duplicados || [];
  if (!grupos.length) {
    $("#modalCuerpo").innerHTML = `
      <div class="vacio">No hay clientes repetidos.<br>
        Los ${total} clientes del directorio están cada uno una sola vez.</div>`;
    return;
  }
  const cuantos = grupos.reduce((n, g) => n + g.clientes.length - 1, 0);
  $("#modalCuerpo").innerHTML = `
    <p style="font-size:13px;color:var(--slate);margin-bottom:14px">
      ${grupos.length} ${grupos.length === 1 ? "grupo repetido" : "grupos repetidos"}
      · ${cuantos} ${cuantos === 1 ? "registro de más" : "registros de más"}.
      En cada grupo, marca el que se queda y toca <b>Unir</b>. Las cotizaciones de los otros
      pasan al que elijas y los datos vacíos se completan entre ellos.</p>
    ${grupos.map((g, i) => tarjetaDuplicado(g, i)).join("")}`;
}

function tarjetaDuplicado(g, i) {
  const filas = g.clientes.map((c, j) => `
    <label class="dupfila">
      <input type="radio" name="dup${i}" value="${c.id}" ${j === 0 ? "checked" : ""}>
      <span class="dupdatos">
        <b>${esc(c.nombre)}</b>
        <span>${[c.telefono, c.correo, c.direccion].filter(Boolean).map(esc).join(" · ") || "Sin datos de contacto"}</span>
        ${c.referencia ? `<span>RPU ${esc(c.referencia)}</span>` : ""}
        <span>Alta ${fecha(c.creado_en)}${c.creador ? " · " + esc(c.creador) : ""}</span>
      </span>
      <span class="dupcuenta">
        <b>${c.cotizaciones}</b>
        <span>${c.cotizaciones === 1 ? "cotización" : "cotizaciones"}</span>
      </span>
    </label>`).join("");

  return `
    <div class="dupgrupo" id="dup${i}">
      <div class="dupmotivo">${g.motivo === "nombre"
        ? "Mismo nombre escrito de distinta forma"
        : "Distinto nombre, pero el mismo número de servicio"}</div>
      ${filas}
      <div class="acciones" style="margin-top:10px">
        <button class="btn pri sm" onclick="unirDuplicados(${i}, this)">Unir en el marcado</button>
      </div>
    </div>`;
}

async function unirDuplicados(i, boton) {
  const g = (S.duplicados || [])[i];
  if (!g) return;
  const marcado = document.querySelector(`input[name="dup${i}"]:checked`);
  if (!marcado) return aviso("#modalError", "Marca cuál cliente se queda.");
  const conservar = Number(marcado.value);
  const quitar = g.clientes.map((c) => c.id).filter((id) => id !== conservar);
  const sequeda = g.clientes.find((c) => c.id === conservar);
  const mueven = g.clientes.filter((c) => c.id !== conservar)
                           .reduce((n, c) => n + c.cotizaciones, 0);

  const aviso1 = `Se queda «${sequeda.nombre}».\n\n` +
    (mueven ? `Se le pasan ${mueven} ${mueven === 1 ? "cotización" : "cotizaciones"} y ` : "") +
    `se borran ${quitar.length} ${quitar.length === 1 ? "registro repetido" : "registros repetidos"}.\n\n` +
    `Esto no se puede deshacer. ¿Continuamos?`;
  if (!confirm(aviso1)) return;

  await conBoton(boton, async () => {
    try {
      const r = await api("clientes/fusionar", { method: "POST", body: { conservar, quitar } });
      await cargarClientes();
      S.cotCargadas = false;
      S.duplicados = (S.duplicados || []).filter((_, k) => k !== i);
      pintarDuplicados();
      aviso("#modalError", `Listo: ${r.movidas} ${r.movidas === 1 ? "cotización quedó" : "cotizaciones quedaron"} ` +
        `a nombre de ${r.cliente.nombre} y se borraron ${r.borrados} ` +
        `${r.borrados === 1 ? "registro repetido" : "registros repetidos"}.`, "ok");
      if (vistaActual === "cli") verClientes();
    } catch (e) { aviso("#modalError", e.message); }
  }, "Uniendo…");
}

/* ---------------- inventario ---------------- */
/* ======================================================================
   ALMACÉN: existencias, vales de entrada/salida/devolución y kardex.
   El administrador y el usuario de almacén mueven material; el vendedor
   sólo consulta existencias. Toda salida se documenta con un vale que dice
   a qué cliente y obra se fue, cuándo, quién lo entregó y quién lo recibió.
   ====================================================================== */

async function verInventario() {
  S.invSeg ||= "exist";
  $("#invDes").textContent = mueveAlmacen()
    ? "Existencias, vales de entrada y salida, y kardex"
    : "Perfiles y herrajes en existencia";
  $("#invSeg").hidden = !mueveAlmacen();
  if (!mueveAlmacen()) S.invSeg = "exist";
  pintarSegInv();
}

$$("#invSeg button").forEach((b) => b.addEventListener("click", () => {
  S.invSeg = b.dataset.s;
  pintarSegInv();
}));

function pintarSegInv() {
  $$("#invSeg button").forEach((b) => b.classList.toggle("on", b.dataset.s === S.invSeg));
  $("#invExist").hidden = S.invSeg !== "exist";
  $("#invVales").hidden = S.invSeg !== "vales";
  $("#invKardex").hidden = S.invSeg !== "kardex";
  if (S.invSeg === "exist") pintarExistencias();
  if (S.invSeg === "vales") verVales();
  if (S.invSeg === "kardex") verKardex();
}

/* ---------- existencias ---------- */
async function pintarExistencias() {
  $("#invExist").innerHTML = '<div class="cargando">Cargando…</div>';
  await cargarCatalogo();
  const items = S.catalogo.filter((c) => c.controla_inventario && c.activo !== false);
  const puede = mueveAlmacen();
  $("#invExist").innerHTML = !items.length
    ? '<div class="vacio">No hay conceptos con control de inventario.</div>'
    : `${puede ? `<p class="ayuda-inv">Toca un concepto para registrar una <b>entrada rápida</b> o un <b>ajuste de conteo</b>.
         Las salidas se hacen con un vale: botón <b>+</b>.</p>` : ""}` +
      items.map((i) => {
        const bajo = Number(i.existencia) <= Number(i.minimo);
        return `<div class="item" ${puede ? `onclick="formMovimiento(${i.id})"` : 'style="cursor:default"'}>
          <div class="m"><b>${esc(i.descripcion)}</b><span>${esc(i.clave)} · mínimo ${Number(i.minimo)} ${esc(i.unidad)}</span></div>
          <div class="r"><b>${Number(i.existencia).toLocaleString("es-MX")}</b>
          <span class="badge ${bajo ? "b-bajo" : "b-ok"}">${bajo ? "Bajo" : "OK"}</span></div>
        </div>`;
      }).join("");
}

/* Entrada rápida o ajuste de conteo sobre un solo concepto. Las salidas ya
   no pasan por aquí: van en un vale, que es lo que deja rastro. */
function formMovimiento(id) {
  const i = S.catalogo.find((x) => x.id === id);
  if (!i) return;
  abrirModal("Movimiento rápido", `
    <p style="font-size:13px;color:var(--slate);margin-bottom:14px">
      <b style="color:var(--ink)">${esc(i.descripcion)}</b><br>
      ${esc(i.clave)} · existencia actual <b style="color:var(--ink)">${Number(i.existencia)} ${esc(i.unidad)}</b></p>
    <form id="fMov">
      <label class="f"><span>Tipo</span><select name="tipo" id="movTipo">
        <option value="entrada">Entrada rápida (sin vale)</option>
        <option value="ajuste">Ajuste (fijar la existencia real)</option>
      </select></label>
      <label class="f"><span id="movEtq">Cantidad que entra</span>
        <input name="cantidad" type="number" min="0" step="0.01" required inputmode="decimal"></label>
      <label class="f"><span>Motivo o referencia</span>
        <input name="motivo" id="movMotivo" placeholder="Compra a proveedor, conteo físico, merma…"></label>
      <p class="ayuda-inv" style="margin-top:-2px">Para una salida a obra o a un cliente usa
        <b>Nuevo vale de salida</b>: ahí se registra a quién se entregó y quién recibió.</p>
      <button class="btn pri full" type="submit">Registrar</button>
    </form>`);
  $("#movTipo").addEventListener("change", (ev) => {
    const ajuste = ev.target.value === "ajuste";
    $("#movEtq").textContent = ajuste ? "Existencia real contada" : "Cantidad que entra";
    $("#movMotivo").required = ajuste && esAlmacen();
  });
  $("#fMov").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    const boton = ev.target.querySelector("button[type=submit]");
    await conBoton(boton, async () => {
      try {
        await api("inventario/movimiento", { method: "POST", body: { item_id: id, ...d } });
        cerrarModal(); pintarExistencias();
      } catch (x) { aviso("#modalError", x.message); }
    });
  });
}

/* ---------- lista de vales ---------- */
async function verVales() {
  const caja = $("#invVales");
  if (!caja.querySelector("#qVale")) {
    caja.innerHTML = `
      <div class="buscador">
        <input id="qVale" type="search" autocomplete="off" inputmode="search"
               placeholder="Buscar por folio, cliente, obra o quien recibió">
        <span id="qValeCuenta"></span>
      </div>
      <div class="filtros-linea">
        <select id="fValeTipo">
          <option value="">Todos los tipos</option>
          <option value="salida">Salidas</option>
          <option value="entrada">Entradas</option>
          <option value="devolucion">Devoluciones</option>
        </select>
      </div>
      <div id="listaVales"></div>`;
    let reloj = null;
    const buscar = () => { clearTimeout(reloj); reloj = setTimeout(pintarVales, 350); };
    $("#qVale").addEventListener("input", buscar);
    $("#qVale").addEventListener("search", buscar);
    $("#fValeTipo").addEventListener("change", pintarVales);
  }
  pintarVales();
}

async function pintarVales() {
  const lista = $("#listaVales");
  if (!lista) return;
  lista.innerHTML = '<div class="cargando">Cargando…</div>';
  const q = ($("#qVale")?.value || "").trim();
  const tipo = $("#fValeTipo")?.value || "";
  try {
    const r = await api(`vales?q=${encodeURIComponent(q)}&tipo=${tipo}&tope=150`);
    const vales = r.vales || [];
    $("#qValeCuenta").textContent = q || tipo ? `${r.encontradas ?? vales.length}` : "";
    if (!vales.length) {
      lista.innerHTML = q || tipo
        ? `<div class="sin-resultados">Ningún vale coincide.</div>`
        : `<div class="vacio">Todavía no hay vales.<br>Toca <b>+</b> para registrar la primera salida o entrada.</div>`;
      return;
    }
    lista.innerHTML = vales.map(tarjetaVale).join("") +
      (r.recortada ? `<div class="nota-tope">Se muestran ${vales.length} de ${r.encontradas}. Afina la búsqueda para ver los demás.</div>` : "");
  } catch (e) { lista.innerHTML = `<div class="vacio">${esc(e.message)}</div>`; }
}

function tarjetaVale(v) {
  const cancelado = !!v.cancelado_en;
  const signo = v.tipo === "salida" ? "−" : "+";
  return `
    <div class="item vale-item ${cancelado ? "cancelado" : ""}" onclick="abrirVale(${v.id})">
      <div class="m">
        <b>${esc(v.folio)} <span class="badge b-${v.tipo}">${TIPO_VALE[v.tipo] || v.tipo}</span>
           ${cancelado ? '<span class="badge b-perdida">Cancelado</span>' : ""}
           ${v.firmado ? '<span class="badge b-ganada">Firmado</span>' : ""}</b>
        <span>${fecha(v.fecha)} · ${esc(v.cliente || v.obra)}${v.cliente ? " · " + esc(v.obra) : ""}</span>
        <span>${v.tipo === "entrada" ? "Entregó" : "Recibió"}: ${esc(v.tipo === "entrada" ? v.entrego_nombre : v.recibio_nombre)}${v.cotizacion ? " · " + esc(v.cotizacion) : ""}</span>
      </div>
      <div class="r"><b style="color:${v.tipo === "salida" ? "var(--bad)" : "var(--ok)"}">${signo}${Number(v.piezas).toLocaleString("es-MX")}</b>
        <span style="font-size:11px;color:var(--slate)">${v.renglones} ${v.renglones === 1 ? "concepto" : "conceptos"}</span></div>
    </div>`;
}

/* ---------- menú + ---------- */
function menuVale() {
  const opcion = (tipo, t, d) => `
    <div class="item" onclick="nuevoVale('${tipo}')">
      <div class="m"><b><span class="badge b-${tipo}" style="margin-right:6px">${TIPO_VALE[tipo]}</span>${t}</b><span>${d}</span></div>
      <div class="r" style="color:var(--slate);font-size:19px">›</div>
    </div>`;
  abrirModal("Nuevo vale", `
    ${opcion("salida", "A obra o cliente", "Descuenta del almacén. Registra a quién se entregó y quién recibió.")}
    ${opcion("entrada", "De proveedor", "Suma al almacén. Con la remisión o factura del proveedor.")}
    ${opcion("devolucion", "Sobrante de obra", "Regresa al almacén. Se liga al vale de salida original.")}`);
}

/* ---------- editor de vale ---------- */
function nuevoVale(tipo, base = {}) {
  cerrarModal();
  S.vale = {
    tipo, fecha: hoyISO(),
    cliente_id: base.cliente_id ? String(base.cliente_id) : "",
    cotizacion_id: base.cotizacion_id ? String(base.cotizacion_id) : "",
    obra: base.obra || "",
    referencia: "",
    entrego_nombre: tipo === "entrada" ? "" : S.yo.nombre,
    recibio_nombre: tipo === "entrada" ? S.yo.nombre : "",
    recibio_tel: base.recibio_tel || "",
    vale_origen_id: base.vale_origen_id ? String(base.vale_origen_id) : "",
    vale_origen_folio: base.vale_origen_folio || "",
    notas: "",
    partidas: (base.partidas || []).map((p) => ({ ...p })),
    obras: [], firma: null,
  };
  pintarEditorVale();
  if (S.vale.cliente_id) valeCargarObras(S.vale.cliente_id);
}

function tituloVale(tipo) {
  return tipo === "salida" ? "Vale de salida" : tipo === "entrada" ? "Vale de entrada" : "Vale de devolución";
}

function pintarEditorVale() {
  const v = S.vale;
  const entrada = v.tipo === "entrada";
  const devol = v.tipo === "devolucion";
  $$(".vista").forEach((s) => (s.hidden = true));
  $$("#tabs button").forEach((b) => b.classList.remove("on"));
  $("#fab").hidden = true;
  const sec = $("#v-vale");
  sec.hidden = false;
  window.scrollTo(0, 0);

  sec.innerHTML = `
    <div class="row between" style="margin-bottom:10px">
      <button class="btn sec sm" onclick="cerrarEditorVale()">← Cancelar</button>
      <span class="badge b-${v.tipo}" style="font-size:11.5px">${TIPO_VALE[v.tipo]}</span>
    </div>
    <h2 class="tit">${tituloVale(v.tipo)}</h2>
    <p class="des">${entrada ? "Material que llega al almacén." : devol
      ? "Material que regresa de una obra al almacén." : "Material que sale del almacén a una obra o a un cliente."}</p>

    <div class="card">
      <h3>${entrada ? "Origen" : "Destino"}</h3>
      <div class="grid2">
        <label class="f"><span>Fecha</span><input type="date" id="vlFecha" value="${esc(v.fecha)}"></label>
        <label class="f"><span>${entrada ? "Remisión o factura" : "Referencia"}</span>
          <input id="vlRef" value="${esc(v.referencia)}" placeholder="${entrada ? "Remisión AX-4471" : "Pedido, orden de compra…"}"></label>
      </div>
      ${!entrada ? campoCliente("vlCliente", v.cliente_id, "Cliente (opcional)") : ""}
      ${!entrada ? `
      <label class="f"><span>Cotización / obra del cliente</span>
        <select id="vlObra"><option value="">— Sin cotización —</option></select></label>` : ""}
      <label class="f"><span>${entrada ? "Proveedor u origen *" : "Obra o destino *"}</span>
        <input id="vlObraTxt" value="${esc(v.obra)}" placeholder="${entrada ? "Alyex · extrusión de perfiles" : "Nave Iztapalapa · techo lámina"}"></label>
      ${devol ? `
      <label class="f"><span>Vale de salida original</span>
        <select id="vlOrigen"><option value="">— Elige el vale —</option></select></label>` : ""}
    </div>

    <div class="card">
      <div class="row between" style="margin-bottom:8px">
        <h3 style="margin:0">Material</h3>
        <button class="btn pri sm" type="button" onclick="elegirConceptoVale()">+ Agregar</button>
      </div>
      <div id="vlPartidas"></div>
      <div id="vlPrecarga"></div>
    </div>

    <div class="card">
      <h3>Personas</h3>
      <div class="grid2">
        <label class="f"><span>Entregó *</span>
          <input id="vlEntrego" value="${esc(v.entrego_nombre)}" placeholder="${entrada ? "Chofer o proveedor" : "Almacenista o chofer"}"></label>
        <label class="f"><span>Recibió *</span>
          <input id="vlRecibio" value="${esc(v.recibio_nombre)}" placeholder="${entrada ? "Quien recibe en almacén" : "Instalador, cliente o transportista"}"></label>
      </div>
      <label class="f"><span>Teléfono de quien recibe</span>
        <input id="vlTel" type="tel" value="${esc(v.recibio_tel)}" placeholder="55 0000 0000"></label>
      <!-- Va en un div, no en un label: un toque dentro de un label "activa" su
           primer botón, que aquí sería Limpiar, y borraría la firma al empezarla. -->
      <div class="f"><span>Firma de quien recibe (opcional)</span>
        <div class="firma-caja">
          <canvas id="vlFirma" class="firma" width="600" height="220"></canvas>
          <button class="btn sec sm" type="button" onclick="limpiarFirma('vlFirma')">Limpiar</button>
        </div></div>
      <label class="f"><span>Notas</span>
        <textarea id="vlNotas" placeholder="Condiciones del material, faltantes, observaciones…">${esc(v.notas)}</textarea></label>
    </div>

    <button class="btn pri full" id="vlGuardar" onclick="guardarVale(this)">Guardar ${tituloVale(v.tipo).toLowerCase()}</button>
    <p class="ayuda-inv" style="text-align:center;margin-top:8px">Al guardar se ${entrada || devol ? "suma" : "descuenta"} el material del almacén y se genera el folio para imprimir.</p>`;

  if (!entrada) {
    activarBuscadorCliente("vlCliente");
    $("#vlCliente").addEventListener("change", (ev) => {
      v.cliente_id = ev.target.value;
      v.cotizacion_id = "";
      valeCargarObras(v.cliente_id);
      if (devol) valeCargarOrigenes(v.cliente_id);
    });
    $("#vlObra").addEventListener("change", (ev) => {
      v.cotizacion_id = ev.target.value;
      const o = v.obras.find((x) => String(x.id) === String(v.cotizacion_id));
      if (o && !$("#vlObraTxt").value.trim()) {
        $("#vlObraTxt").value = o.ubicacion || (`Cotización ${o.folio}`);
        v.obra = $("#vlObraTxt").value;
      }
      pintarPrecarga();
    });
    if (devol) valeCargarOrigenes(v.cliente_id);
  }
  ["vlFecha", "vlRef", "vlObraTxt", "vlEntrego", "vlRecibio", "vlTel", "vlNotas"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.addEventListener("input", leerVale);
  });
  iniciarFirma("vlFirma");
  pintarPartidasVale();
}

function leerVale() {
  const v = S.vale;
  if (!v) return;
  v.fecha = $("#vlFecha")?.value || v.fecha;
  v.referencia = $("#vlRef")?.value || "";
  v.obra = $("#vlObraTxt")?.value || "";
  v.entrego_nombre = $("#vlEntrego")?.value || "";
  v.recibio_nombre = $("#vlRecibio")?.value || "";
  v.recibio_tel = $("#vlTel")?.value || "";
  v.notas = $("#vlNotas")?.value || "";
  if ($("#vlOrigen")) v.vale_origen_id = $("#vlOrigen").value;
}

async function valeCargarObras(clienteId) {
  const sel = $("#vlObra");
  if (!sel) return;
  S.vale.obras = [];
  sel.innerHTML = `<option value="">— Sin cotización —</option>`;
  if (!clienteId) { pintarPrecarga(); return; }
  try {
    const { obras } = await api("obras?cliente=" + clienteId);
    S.vale.obras = obras || [];
    sel.innerHTML = `<option value="">— Sin cotización —</option>` +
      S.vale.obras.map((o) => `<option value="${o.id}">${esc(o.folio)} · ${ESTATUS[o.estatus] || o.estatus}${o.ubicacion ? " · " + esc(o.ubicacion) : ""}${o.partidas.length ? ` · ${o.partidas.length} conceptos de almacén` : ""}</option>`).join("");
    sel.value = S.vale.cotizacion_id || "";
  } catch { /* sin obras */ }
  pintarPrecarga();
}

async function valeCargarOrigenes(clienteId) {
  const sel = $("#vlOrigen");
  if (!sel) return;
  try {
    const r = await api(`vales?tipo=salida&tope=60${clienteId ? "&cliente=" + clienteId : ""}`);
    const lista = (r.vales || []).filter((x) => !x.cancelado_en);
    sel.innerHTML = `<option value="">— Elige el vale —</option>` +
      lista.map((x) => `<option value="${x.id}">${esc(x.folio)} · ${fecha(x.fecha)} · ${esc(x.cliente || x.obra)}</option>`).join("");
    sel.value = S.vale.vale_origen_id || "";
  } catch { /* nada */ }
}

/* Si el vale viene de una cotización, se ofrece precargar las cantidades de
   estructura que ésta lleva; el almacenista ajusta lo que realmente sale. */
function pintarPrecarga() {
  const caja = $("#vlPrecarga");
  if (!caja) return;
  const o = (S.vale.obras || []).find((x) => String(x.id) === String(S.vale.cotizacion_id));
  caja.innerHTML = o && o.partidas.length
    ? `<button class="btn sec sm" type="button" style="margin-top:8px" onclick="precargarDeCotizacion()">
         ⤓ Precargar ${o.partidas.length} conceptos de ${esc(o.folio)}</button>`
    : "";
}

function precargarDeCotizacion() {
  const o = (S.vale.obras || []).find((x) => String(x.id) === String(S.vale.cotizacion_id));
  if (!o) return;
  o.partidas.forEach((p) => {
    const ya = S.vale.partidas.find((x) => x.item_id === p.item_id);
    if (ya) ya.cantidad = p.cantidad; else S.vale.partidas.push({ ...p });
  });
  pintarPartidasVale();
}

function pintarPartidasVale() {
  const v = S.vale;
  const caja = $("#vlPartidas");
  if (!caja) return;
  if (!v.partidas.length) {
    caja.innerHTML = `<div class="vacio" style="padding:16px 0">Sin conceptos todavía.<br>Toca <b>+ Agregar</b> para elegir perfiles y herrajes.</div>`;
    return;
  }
  const salida = v.tipo === "salida";
  caja.innerHTML = v.partidas.map((p, i) => {
    const falta = salida && Number(p.cantidad) > Number(p.existencia);
    return `
    <div class="vale-partida ${falta ? "falta" : ""}">
      <div class="d"><b>${esc(p.clave)} · ${esc(p.descripcion)}</b>
        <span>Existencia ${Number(p.existencia).toLocaleString("es-MX")} ${esc(p.unidad)}${falta ? " · <b>no alcanza</b>" : ""}</span></div>
      <input type="number" min="0" step="0.01" inputmode="decimal" value="${Number(p.cantidad) || ""}"
             oninput="cantidadVale(${i}, this.value)" placeholder="0">
      <span class="u">${esc(p.unidad)}</span>
      <button class="x" type="button" onclick="quitarPartidaVale(${i})" aria-label="Quitar">×</button>
    </div>`;
  }).join("") + `<div class="total-row"><span>Total de piezas</span>
      <b>${v.partidas.reduce((a, p) => a + (Number(p.cantidad) || 0), 0).toLocaleString("es-MX")}</b></div>`;
}

function cantidadVale(i, valor) {
  const p = S.vale.partidas[i];
  if (!p) return;
  p.cantidad = numero(valor);
  /* Sólo se repinta el aviso de existencia, no el campo (o se pierde el foco). */
  const fila = $$("#vlPartidas .vale-partida")[i];
  if (fila) fila.classList.toggle("falta", S.vale.tipo === "salida" && p.cantidad > Number(p.existencia));
  const tot = $("#vlPartidas .total-row b");
  if (tot) tot.textContent = S.vale.partidas.reduce((a, x) => a + (Number(x.cantidad) || 0), 0).toLocaleString("es-MX");
}

function quitarPartidaVale(i) {
  S.vale.partidas.splice(i, 1);
  pintarPartidasVale();
}

/* Selector de conceptos con buscador. Sólo los que llevan inventario. */
function elegirConceptoVale() {
  const items = S.catalogo.filter((c) => c.controla_inventario && c.activo !== false);
  abrirModal("Agregar concepto", `
    <div class="buscador"><input id="qConcepto" type="search" autocomplete="off" placeholder="Clave o descripción"></div>
    <div id="listaConceptos" style="max-height:60vh;overflow:auto"></div>`);
  const pintar = () => {
    const q = paraBuscar($("#qConcepto").value).trim();
    const lista = !q ? items : items.filter((c) => paraBuscar(c.clave + " " + c.descripcion).includes(q));
    $("#listaConceptos").innerHTML = !lista.length
      ? `<div class="sin-resultados">Nada coincide con <b>${esc($("#qConcepto").value)}</b>.</div>`
      : lista.map((c) => {
          const ya = S.vale.partidas.some((p) => p.item_id === c.id);
          return `<div class="item" onclick="agregarConceptoVale(${c.id})">
            <div class="m"><b>${esc(c.clave)} · ${esc(c.descripcion)}</b>
              <span>Existencia ${Number(c.existencia).toLocaleString("es-MX")} ${esc(c.unidad)}${ya ? " · ya está en el vale" : ""}</span></div>
            <div class="r"><span style="color:var(--blue);font-size:22px;font-weight:700">+</span></div></div>`;
        }).join("");
  };
  $("#qConcepto").addEventListener("input", pintar);
  pintar();
  setTimeout(() => $("#qConcepto").focus(), 50);
}

function agregarConceptoVale(id) {
  const c = S.catalogo.find((x) => x.id === id);
  if (!c) return;
  if (!S.vale.partidas.some((p) => p.item_id === id))
    S.vale.partidas.push({ item_id: c.id, clave: c.clave, descripcion: c.descripcion, unidad: c.unidad,
                           existencia: Number(c.existencia), cantidad: 0 });
  cerrarModal();
  pintarPartidasVale();
  const filas = $$("#vlPartidas input");
  const ultima = filas[filas.length - 1];
  if (ultima) ultima.focus();
}

async function guardarVale(boton) {
  leerVale();
  const v = S.vale;
  const partidas = v.partidas.filter((p) => Number(p.cantidad) > 0).map((p) => ({ item_id: p.item_id, cantidad: Number(p.cantidad) }));
  const entrada = v.tipo === "entrada";
  if (!v.obra.trim()) return alert(entrada ? "Escribe el proveedor u origen del material." : "Escribe la obra o el destino del material.");
  if (!partidas.length) return alert("Agrega al menos un concepto con cantidad.");
  if (!v.entrego_nombre.trim() || !v.recibio_nombre.trim()) return alert("Falta quién entregó o quién recibió.");
  if (v.tipo === "devolucion" && !v.vale_origen_id && !confirm("No elegiste el vale de salida original. ¿Registrar la devolución sin ligarla?")) return;

  await conBoton(boton, async () => {
    try {
      const { vale } = await api("vales", { method: "POST", body: {
        tipo: v.tipo, fecha: v.fecha, cliente_id: v.cliente_id || null, cotizacion_id: v.cotizacion_id || null,
        obra: v.obra, referencia: v.referencia, entrego_nombre: v.entrego_nombre, recibio_nombre: v.recibio_nombre,
        recibio_tel: v.recibio_tel, recibio_firma: firmaDataUrl("vlFirma"), vale_origen_id: v.vale_origen_id || null,
        notas: v.notas, partidas,
      }});
      S.vale = null;
      await cargarCatalogo();
      S.invSeg = "vales";
      ir("inv");
      abrirVale(vale.id, vale);
    } catch (x) { alert(x.message); }
  }, "Guardando…");
}

function cerrarEditorVale() {
  if (S.vale && S.vale.partidas.length && !confirm("¿Descartar este vale sin guardar?")) return;
  S.vale = null;
  ir("inv");
}

/* ---------- ficha del vale ---------- */
async function abrirVale(id, precargado = null) {
  let v = precargado;
  if (!v) {
    abrirModal("Vale", '<div class="cargando">Cargando…</div>');
    try { v = (await api("vale/" + id)).vale; }
    catch (e) { $("#modalCuerpo").innerHTML = `<div class="vacio">${esc(e.message)}</div>`; return; }
  }
  S.valeAbierto = v;
  const cancelado = !!v.cancelado_en;
  const total = v.partidas.reduce((a, p) => a + Number(p.cantidad), 0);
  const dato = (etq, val) => val ? `<div><span>${etq}</span><b>${esc(val)}</b></div>` : "";
  abrirModal(`${v.folio}`, `
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span class="badge b-${v.tipo}">${TIPO_VALE[v.tipo]}</span>
      ${cancelado ? '<span class="badge b-perdida">Cancelado</span>' : ""}
      ${v.recibio_firma ? '<span class="badge b-ganada">Firmado</span>' : ""}
      <span style="font-size:12.5px;color:var(--slate)">${fecha(v.fecha)}</span>
    </div>
    ${cancelado ? `<div class="aviso err on">Cancelado el ${fecha(v.cancelado_en)} por ${esc(v.cancelo || "")}: ${esc(v.motivo_cancelacion || "")}.
      El material se regresó al almacén con movimientos inversos.</div>` : ""}
    <div class="spec vale-spec" style="margin-bottom:12px">
      ${dato("Cliente", v.cliente)}
      ${dato(v.tipo === "entrada" ? "Proveedor / origen" : "Obra / destino", v.obra)}
      ${dato("Cotización", v.cotizacion)}
      ${dato("Referencia", v.referencia)}
      ${dato("Vale de origen", v.vale_origen)}
      ${dato("Entregó", v.entrego_nombre)}
      ${dato("Recibió", v.recibio_nombre + (v.recibio_tel ? " · " + v.recibio_tel : ""))}
      ${dato("Capturó", (v.capturo || "") + " · " + fecha(v.creado_en))}
    </div>
    <table class="tabla-vale">
      <tr><th>Clave</th><th>Descripción</th><th class="n">Cant.</th></tr>
      ${v.partidas.map((p) => `<tr><td><b>${esc(p.clave)}</b></td><td>${esc(p.descripcion)}</td>
        <td class="n"><b>${Number(p.cantidad).toLocaleString("es-MX")}</b> ${esc(p.unidad)}</td></tr>`).join("")}
      <tr class="tot"><td colspan="2">Total de piezas</td><td class="n">${total.toLocaleString("es-MX")}</td></tr>
    </table>
    ${v.notas ? `<p style="font-size:12.5px;color:var(--slate);margin-top:10px"><b>Notas:</b> ${esc(v.notas)}</p>` : ""}
    ${v.recibio_firma ? `<div class="firma-vista"><span>Firma de ${esc(v.recibio_nombre)}</span><img src="${v.recibio_firma}" alt="Firma"></div>` : ""}
    <div class="acciones" style="margin-top:14px">
      <button class="btn pri sm" onclick="imprimirVale()">Imprimir o PDF</button>
      ${!cancelado ? `<button class="btn sec sm" onclick="formEntregaVale()">${v.recibio_firma ? "Editar entrega" : "Firmar / editar entrega"}</button>` : ""}
      ${!cancelado && v.tipo === "salida" ? `<button class="btn sec sm" onclick="devolverDeVale()">Registrar devolución</button>` : ""}
      ${!cancelado && esDueno() ? `<button class="btn dan sm" onclick="cancelarVale()">Cancelar vale</button>` : ""}
    </div>`);
}

/* Corregir personas, teléfono, firma y notas. Las cantidades no se tocan:
   para eso se cancela y se hace otro, y así el kardex siempre cuadra. */
function formEntregaVale() {
  const v = S.valeAbierto;
  abrirModal(`${v.folio} · datos de entrega`, `
    <form id="fEnt">
      <div class="grid2">
        <label class="f"><span>Entregó</span><input name="entrego_nombre" value="${esc(v.entrego_nombre)}" required></label>
        <label class="f"><span>Recibió</span><input name="recibio_nombre" value="${esc(v.recibio_nombre)}" required></label>
      </div>
      <label class="f"><span>Teléfono de quien recibe</span><input name="recibio_tel" type="tel" value="${esc(v.recibio_tel || "")}"></label>
      <div class="f"><span>Firma de quien recibe</span>
        <div class="firma-caja">
          <canvas id="enFirma" class="firma" width="600" height="220"></canvas>
          <button class="btn sec sm" type="button" onclick="limpiarFirma('enFirma')">Limpiar</button>
        </div>
        ${v.recibio_firma ? `<small style="font-size:11px;color:var(--slate)">Ya hay una firma guardada. Si trazas otra, la sustituye; si dejas el recuadro vacío, se conserva.</small>` : ""}</div>
      <label class="f"><span>Referencia</span><input name="referencia" value="${esc(v.referencia || "")}"></label>
      <label class="f"><span>Notas</span><textarea name="notas">${esc(v.notas || "")}</textarea></label>
      <button class="btn pri full" type="submit">Guardar</button>
    </form>`);
  iniciarFirma("enFirma");
  $("#fEnt").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    const firma = firmaDataUrl("enFirma");
    if (firma) d.recibio_firma = firma;
    const boton = ev.target.querySelector("button[type=submit]");
    await conBoton(boton, async () => {
      try {
        const { vale } = await api("vale/" + v.id, { method: "PATCH", body: d });
        abrirVale(vale.id, vale);
        if (vistaActual === "inv" && S.invSeg === "vales") pintarVales();
      } catch (x) { aviso("#modalError", x.message); }
    });
  });
}

function devolverDeVale() {
  const v = S.valeAbierto;
  nuevoVale("devolucion", {
    cliente_id: v.cliente_id, cotizacion_id: v.cotizacion_id, obra: v.obra,
    vale_origen_id: v.id, vale_origen_folio: v.folio, recibio_tel: "",
    partidas: v.partidas.map((p) => {
      const c = S.catalogo.find((x) => x.id === p.item_id) || {};
      return { item_id: p.item_id, clave: p.clave, descripcion: p.descripcion, unidad: p.unidad,
               existencia: Number(c.existencia || 0), cantidad: 0 };
    }),
  });
}

async function cancelarVale() {
  const v = S.valeAbierto;
  const motivo = prompt(`¿Cancelar el vale ${v.folio}?\nEl material se regresa al almacén con movimientos inversos y el vale queda marcado.\n\nEscribe el motivo:`);
  if (motivo === null) return;
  if (!motivo.trim()) return alert("Escribe el motivo de la cancelación.");
  try {
    const { vale } = await api(`vale/${v.id}/cancelar`, { method: "POST", body: { motivo } });
    await cargarCatalogo();
    abrirVale(vale.id, vale);
    if (vistaActual === "inv") pintarSegInv();
  } catch (x) { alert(x.message); }
}

/* ---------- documento imprimible del vale ----------
   Documento INTERNO de Marcelestial: sí lleva su marca. Es el papel que se
   firma en la entrega y el que se archiva por obra. */
function imprimirVale() {
  const v = S.valeAbierto;
  if (!v) return;
  cerrarModal();
  $("#doc").innerHTML = hojaVale(v) + (S.demo ? '<div class="pie-demo">Documento generado en el sitio de demostración · datos ficticios</div>' : "");
  abrirPrevia(v.folio);
}

function hojaVale(v) {
  const total = v.partidas.reduce((a, p) => a + Number(p.cantidad), 0);
  const entrada = v.tipo === "entrada";
  const fila = (etq, val) => val ? `<div><span>${etq}</span><b>${esc(val)}</b></div>` : "";
  const titulo = { salida: "VALE DE SALIDA DE ALMACÉN", entrada: "VALE DE ENTRADA DE ALMACÉN", devolucion: "VALE DE DEVOLUCIÓN A ALMACÉN" }[v.tipo];
  const leyenda = {
    salida: "Quien recibe declara haber revisado y recibido el material descrito, en la cantidad y condiciones indicadas. A partir de este momento el material queda bajo su resguardo y responsabilidad. Cualquier faltante o daño debe reportarse al momento de la entrega.",
    entrada: `Se hace constar la recepción del material descrito en el almacén de ${empresa().razon_social}, en la cantidad indicada. Las diferencias contra la remisión o factura del proveedor se anotan en observaciones.`,
    devolucion: "Se hace constar la devolución al almacén del material sobrante de la obra indicada, en la cantidad y condiciones descritas.",
  }[v.tipo];
  return `
    <div class="hoja vale ${v.cancelado_en ? "cancelado" : ""}"${selloDemo()}>
      <div class="dh">
        <div>
          <h1>${titulo}</h1>
          <div style="font-size:11.5px;color:#6b7280;margin-top:4px">${esc(empresa().razon_social)}${empresa().giro ? " · " + esc(empresa().giro) : ""}</div>
        </div>
        ${imgLogo()}
      </div>

      <div class="vale-folio">
        <div><span>Folio</span><b>${esc(v.folio)}</b></div>
        <div><span>Fecha</span><b>${fecha(v.fecha)}</b></div>
        <div><span>Tipo</span><b>${TIPO_VALE[v.tipo]}</b></div>
      </div>
      ${v.cancelado_en ? `<div class="sello">CANCELADO</div>` : ""}

      <h2>${entrada ? "Origen" : "Destino"}</h2>
      <div class="campos">
        ${fila("Cliente", v.cliente)}
        ${fila(entrada ? "Proveedor / origen" : "Obra / destino", v.obra)}
        ${fila("Dirección del cliente", v.cliente_direccion)}
        ${fila("Cotización", v.cotizacion)}
        ${fila(entrada ? "Remisión / factura" : "Referencia", v.referencia)}
        ${fila("Vale de salida original", v.vale_origen)}
      </div>

      <h2>Material</h2>
      <table>
        <tr><th style="width:26px">#</th><th style="width:80px">Clave</th><th>Descripción</th><th class="n" style="width:80px">Cantidad</th><th style="width:52px">Unidad</th></tr>
        ${v.partidas.map((p, i) => `<tr>
          <td>${i + 1}</td><td><b>${esc(p.clave)}</b></td><td>${esc(p.descripcion)}</td>
          <td class="n"><b>${Number(p.cantidad).toLocaleString("es-MX")}</b></td><td>${esc(p.unidad)}</td></tr>`).join("")}
        <tr class="tot"><td colspan="3">TOTAL DE PIEZAS · ${v.partidas.length} ${v.partidas.length === 1 ? "concepto" : "conceptos"}</td>
          <td class="n">${total.toLocaleString("es-MX")}</td><td></td></tr>
      </table>

      ${v.notas ? `<h2>Observaciones</h2><p style="font-size:11.5px;line-height:1.55">${esc(v.notas)}</p>` : ""}

      <p class="vale-leyenda">${leyenda}</p>

      <div class="firmas">
        <div class="firma-bloque">
          <div class="linea">${entrada ? "" : ""}</div>
          <b>Entregó</b>
          <span>${esc(v.entrego_nombre)}</span>
        </div>
        <div class="firma-bloque">
          <div class="linea">${v.recibio_firma ? `<img src="${v.recibio_firma}" alt="Firma">` : ""}</div>
          <b>Recibió</b>
          <span>${esc(v.recibio_nombre)}${v.recibio_tel ? " · " + esc(v.recibio_tel) : ""}</span>
        </div>
      </div>

      <div class="pie">
        <b>${esc(empresa().razon_social)}</b> · ${contactoEmpresa()}<br>
        Capturó ${esc(v.capturo || "")} · ${fecha(v.creado_en)}${v.creado_en ? " " + new Date(v.creado_en).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : ""} ·
        Original: almacén · Copia: quien recibe
      </div>
    </div>`;
}

/* ---------- firma en pantalla ----------
   Un lienzo blanco donde quien recibe firma con el dedo. Se guarda como PNG
   chico dentro del vale. Si nadie firma, no se manda nada. */
function iniciarFirma(id) {
  const cv = $("#" + id);
  if (!cv) return;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0A2A5E";
  cv.dataset.trazos = "0";
  let dibujando = false;
  const punto = (ev) => {
    const r = cv.getBoundingClientRect();
    return [(ev.clientX - r.left) * (cv.width / r.width), (ev.clientY - r.top) * (cv.height / r.height)];
  };
  cv.addEventListener("pointerdown", (ev) => {
    ev.preventDefault(); dibujando = true; cv.setPointerCapture(ev.pointerId);
    const [x, y] = punto(ev); ctx.beginPath(); ctx.moveTo(x, y);
  });
  cv.addEventListener("pointermove", (ev) => {
    if (!dibujando) return; ev.preventDefault();
    const [x, y] = punto(ev); ctx.lineTo(x, y); ctx.stroke();
    cv.dataset.trazos = String(Number(cv.dataset.trazos) + 1);
  });
  const fin = () => { dibujando = false; };
  cv.addEventListener("pointerup", fin);
  cv.addEventListener("pointercancel", fin);
  cv.addEventListener("pointerleave", fin);
}

function limpiarFirma(id) {
  const cv = $("#" + id);
  if (!cv) return;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  cv.dataset.trazos = "0";
}

function firmaDataUrl(id) {
  const cv = $("#" + id);
  if (!cv || Number(cv.dataset.trazos || 0) < 3) return null;
  return cv.toDataURL("image/png");
}

/* ---------- kardex ---------- */
async function verKardex() {
  const caja = $("#invKardex");
  if (!caja.querySelector("#kxItem")) {
    const items = S.catalogo.filter((c) => c.controla_inventario);
    caja.innerHTML = `
      <div class="card" style="padding:12px 14px">
        <div class="grid2">
          <label class="f"><span>Concepto</span><select id="kxItem"><option value="">Todos</option>
            ${items.map((c) => `<option value="${c.id}">${esc(c.clave)} · ${esc(c.descripcion)}</option>`).join("")}</select></label>
          <label class="f"><span>Tipo</span><select id="kxTipo"><option value="">Todos</option>
            <option value="salida">Salidas</option><option value="entrada">Entradas</option>
            <option value="devolucion">Devoluciones</option><option value="ajuste">Ajustes</option></select></label>
        </div>
        ${campoCliente("kxCliente", "", "Cliente")}
        <div class="grid2">
          <label class="f"><span>Desde</span><input type="date" id="kxDesde"></label>
          <label class="f"><span>Hasta</span><input type="date" id="kxHasta"></label>
        </div>
        <label class="f" style="margin-bottom:6px"><span>Texto</span>
          <input id="kxQ" type="search" placeholder="Obra, folio de vale, quien recibió…"></label>
        <button class="btn pri sm full" onclick="pintarKardex()">Consultar</button>
      </div>
      <div id="kxTotales"></div>
      <div id="kxLista"></div>`;
    activarBuscadorCliente("kxCliente");
    $("#kxCliente").addEventListener("change", pintarKardex);
    ["kxItem", "kxTipo"].forEach((id) => $("#" + id).addEventListener("change", pintarKardex));
    $("#kxQ").addEventListener("keydown", (ev) => { if (ev.key === "Enter") pintarKardex(); });
  }
  pintarKardex();
}

async function pintarKardex() {
  const lista = $("#kxLista");
  if (!lista) return;
  lista.innerHTML = '<div class="cargando">Consultando…</div>';
  const q = new URLSearchParams({
    item: $("#kxItem").value || "", tipo: $("#kxTipo").value || "", cliente: $("#kxCliente").value || "",
    desde: $("#kxDesde").value || "", hasta: $("#kxHasta").value || "", q: $("#kxQ").value.trim(), tope: "300",
  });
  try {
    const r = await api("inventario/movimientos?" + q.toString());
    const movs = r.movimientos || [];
    const filtrado = [...q.values()].some((x) => x && x !== "300");
    $("#kxTotales").innerHTML = !movs.length ? "" : `
      <div class="card" style="padding:12px 14px">
        <h3 style="margin-bottom:6px">${filtrado ? "Totales de lo filtrado" : "Totales de los últimos movimientos"}</h3>
        ${r.totales.map((t) => `<div class="row between" style="padding:6px 0;border-bottom:1px dashed var(--line);font-size:13px">
          <div style="min-width:0;flex:1"><b>${esc(t.clave)}</b> <span style="color:var(--slate)">${esc(t.descripcion)}</span></div>
          <div style="text-align:right;white-space:nowrap;flex:none">
            <span style="color:var(--ok)">+${t.entradas.toLocaleString("es-MX")}</span> ·
            <span style="color:var(--bad)">−${t.salidas.toLocaleString("es-MX")}</span>
            <span style="color:var(--slate);font-size:11px"> ${esc(t.unidad)}</span></div></div>`).join("")}
      </div>`;
    lista.innerHTML = !movs.length
      ? `<div class="sin-resultados">No hay movimientos que coincidan.</div>`
      : movs.map((m) => {
          const sale = m.tipo === "salida";
          const ajuste = m.tipo === "ajuste";
          return `<div class="item" ${m.vale_id ? `onclick="abrirVale(${m.vale_id})"` : 'style="cursor:default"'}>
            <div class="m"><b>${esc(m.clave)} · ${TIPO_MOV[m.tipo] || m.tipo}${m.vale ? " · " + esc(m.vale) : ""}${m.vale_cancelado ? " · vale cancelado" : ""}</b>
              <span>${fecha(m.fecha)}${m.cliente ? " · " + esc(m.cliente) : ""}${m.obra ? " · " + esc(m.obra) : ""}</span>
              <span>${m.recibio_nombre ? (m.tipo === "entrada" && !m.vale_origen_id ? "Entregó " + esc(m.entrego_nombre) + " · recibió " : "Recibió ") + esc(m.recibio_nombre) : (m.motivo ? esc(m.motivo) : "")}</span></div>
            <div class="r"><b style="color:${sale ? "var(--bad)" : ajuste ? "var(--slate)" : "var(--ok)"}">${ajuste ? "=" : sale ? "−" : "+"}${Number(m.cantidad).toLocaleString("es-MX")}</b>
              <span style="font-size:11px;color:var(--slate)">saldo ${Number(m.saldo).toLocaleString("es-MX")}</span></div>
          </div>`;
        }).join("") +
        (r.recortada ? `<div class="nota-tope">Se muestran ${movs.length} de ${r.encontradas}. Acota por fechas o concepto para ver el resto.</div>` : "");
  } catch (e) { lista.innerHTML = `<div class="vacio">${esc(e.message)}</div>`; }
}

/* Dentro de la ficha del cliente: el material que se le ha entregado. */
async function pintarValesDeCliente(clienteId) {
  const caja = $("#valCli");
  if (!caja) return;
  try {
    const r = await api(`vales?cliente=${clienteId}&tope=100`);
    if (!$("#valCli")) return;
    const lista = (r.vales || []);
    const piezas = lista.filter((v) => v.tipo === "salida" && !v.cancelado_en).reduce((a, v) => a + Number(v.piezas), 0);
    $("#valCli").innerHTML = `
      <h4>Material entregado</h4>
      ${lista.length ? `<div class="resumen">${lista.length} ${lista.length === 1 ? "vale" : "vales"} · ${piezas.toLocaleString("es-MX")} piezas entregadas</div>` : ""}
      ${lista.length ? lista.map(tarjetaVale).join("")
        : `<div class="vacio" style="padding:14px 0">Todavía no se le ha entregado material.</div>`}
      ${mueveAlmacen() ? `<button class="btn sec full" type="button" style="margin-top:10px"
        onclick="cerrarModal(); nuevoVale('salida', { cliente_id: ${clienteId} })">+ Nuevo vale de salida para este cliente</button>` : ""}`;
  } catch (e) { if ($("#valCli")) $("#valCli").innerHTML = `<div class="vacio">${esc(e.message)}</div>`; }
}


/* ---------------- ayuda dentro de la app ----------------
   Vive aquí, en el código, no en un servidor: en un techo sin señal la ayuda
   sigue estando. Cada tema se abre desde el signo de interrogación que está
   junto al campo que lo necesita, que es donde nace la duda; un manual aparte
   nadie lo va a buscar. */
const AYUDA = {
  tarifa: {
    titulo: "¿Qué tarifa es?",
    texto: `<p>Viene impresa arriba del recibo, junto al número de servicio. Las más comunes
      son <b>GDMTH</b> y <b>GDMTO</b> en negocios e industria, <b>PDBT</b> en comercios chicos
      y <b>01 o 02</b> en casas.</p>
      <p>Si le atinas mal a la tarifa, el precio del proyecto sale mal: cada tarifa tiene su
      propia tabla de precios por módulo.</p>`,
  },
  servicio: {
    titulo: "Número de servicio",
    texto: `<p>Son doce dígitos y vienen arriba a la izquierda del recibo, como
      <b>NO. DE SERVICIO</b>. Es el identificador del medidor ante CFE.</p>
      <p>No es obligatorio para cotizar, pero guárdalo: cuando el cliente te pida la propuesta
      otra vez, lo buscas por ese número y lo encuentras al instante.</p>`,
  },
  tension: {
    titulo: "Tensión de interconexión",
    texto: `<p>Es a cuántos volts está conectado el servicio. En media tensión casi siempre es
      <b>220</b> o <b>440</b>.</p>
      <p>El recibo no siempre lo dice. Si no viene, pregúntalo en obra o revisa la placa del
      tablero. En caso de duda, la mayoría de los servicios trifásicos comerciales en México
      son 220.</p>
      <p>Importa porque el precio por módulo cambia según la tensión.</p>`,
  },
  consumo: {
    titulo: "Base, intermedia y punta",
    texto: `<p>Son los kWh del recibo partidos por horario del día. Cópialos tal como vienen,
      sin sumarlos.</p>
      <p>La <b>intermedia</b> es la que más pesa y es donde trabajan los paneles: es la energía
      que se consume con luz de día.</p>
      <p>Si tu recibo trae un solo número de consumo, ponlo todo en intermedia.</p>`,
  },
  periodo: {
    titulo: "El periodo facturado",
    texto: `<p>Las dos fechas del recibo: del día que empezó al día que terminó la medición.</p>
      <p>La aplicación cuenta los días sola y de ahí saca el consumo diario, que es la base de
      todo el cálculo. Un recibo bimestral y uno mensual se tratan distinto por eso.</p>`,
  },
  modulos: {
    titulo: "Módulos a cotizar",
    texto: `<p><b>Déjalo vacío</b> y la aplicación calcula cuántos paneles se necesitan para
      cubrir todo el consumo.</p>
      <p>Escribe un número solo cuando quieras cotizar <b>menos</b>: porque no cabe más en el
      techo, o porque el cliente quiere empezar chico e ir creciendo.</p>
      <p>Al bajarlos, abajo te dice cuánto va a seguir pagando el cliente a CFE.</p>`,
  },
  precio: {
    titulo: "Precio por panel",
    texto: `<p>Déjalo vacío y sale de tu tabla de tarifas, con el escalón que corresponda a la
      cantidad de módulos.</p>
      <p>Escríbelo solo para dar un precio distinto en esta cotización. La aplicación te avisa
      cuánto marcaba la tarifa, para que sepas cuánto estás moviendo.</p>
      <p>Si el campo no te deja escribir, es porque eres vendedor: los precios los define el
      administrador.</p>`,
  },
  hileras: {
    titulo: "¿Por qué preguntamos las hileras?",
    texto: `<p>Porque el material no es proporcional al número de paneles.</p>
      <p>El clamp que queda <b>entre dos paneles sujeta a los dos a la vez</b>: detiene el
      borde de uno y el del siguiente. Solo los de las orillas sujetan un panel solo.</p>
      <p>Por eso la cuenta es <b>2 piezas por panel más 2 por hilera</b>. Un panel solo lleva
      4 piezas; dos en línea llevan 6, no 8. Entre más hileras, más orillas, más material.</p>
      <p>Cuenta las hileras en el techo: 51 paneles en 3 hileras llevan 108 piezas; los mismos
      51 en 5 hileras llevan 112.</p>`,
  },
  ganada: {
    titulo: "El estatus de la cotización",
    texto: `<p><b>Borrador</b> mientras la armas. <b>Enviada</b> cuando ya se la mandaste al
      cliente. <b>En negociación</b> si están afinando. <b>Ganada</b> cuando la autorizó.
      <b>Perdida</b> si se cayó.</p>
      <p>Sirve para dos cosas: el panel te dice cuánto llevas ganado en el mes, y al marcar
      <b>Ganada</b> aparece la tarjeta para pedir el material de montaje.</p>`,
  },
  logo: {
    titulo: "Tu logo",
    texto: `<p>Sale en la portada de cada propuesta, en la pantalla de acceso y en los vales
      de almacén.</p>
      <p>Lo mejor es un <b>PNG con fondo transparente</b>. Si es JPG con fondo blanco también
      sirve, pero sobre la barra azul se va a ver el cuadro blanco.</p>
      <p>Mientras más grande el archivo, mejor se imprime. Si mandas una captura borrosa de
      redes sociales, así va a salir en todas tus cotizaciones.</p>`,
  },
  usuarios: {
    titulo: "Dar de alta a tu gente",
    texto: `<p>Captura su nombre y su correo, y <b>deja la contraseña vacía</b>. Sale un enlace
      que le mandas por WhatsApp; al abrirlo elige su propia contraseña y nadie más la conoce.</p>
      <p>El enlace vale 7 días y sirve una sola vez. Si se pierde, usa <b>Volver a invitar</b>
      en su ficha: genera uno nuevo y anula el anterior.</p>
      <p>Ese mismo botón resuelve el «olvidé mi contraseña».</p>
      <p><b>Si se pierde un teléfono</b>, cámbiale la contraseña a esa cuenta: su sesión se
      cierra al instante en todos lados.</p>`,
  },
  puestos: {
    titulo: "Qué puede hacer cada puesto",
    texto: `<p><b>Administrador:</b> todo, incluidos precios, usuarios y datos de la empresa.</p>
      <p><b>Vendedor:</b> cotiza, ve precios y atiende clientes. No mueve el almacén ni cambia
      tarifas.</p>
      <p><b>Almacén:</b> entradas, salidas, devoluciones y conteos. Ve el catálogo
      <b>sin precios</b> y no puede cotizar.</p>`,
  },
  vales: {
    titulo: "Nada sale del almacén sin vale",
    texto: `<p>Un vale registra qué material se fue, a qué cliente y a qué obra, con fecha,
      quién entregó y quién recibió, con su firma en la pantalla.</p>
      <p><b>Salida</b> descuenta, <b>entrada</b> suma, <b>devolución</b> suma el sobrante que
      regresa de obra y se liga al vale de salida original.</p>
      <p>Las cantidades de un vale <b>no se editan</b>: si te equivocaste, se cancela con motivo
      y se hace otro. Así el kardex nunca miente.</p>`,
  },
  respaldo: {
    titulo: "Tu información es tuya",
    texto: `<p>El respaldo baja en un archivo todo lo capturado: clientes, cotizaciones,
      catálogo, almacén y vales.</p>
      <p>Lo puedes descargar cuando quieras, <b>también si la licencia ya venció</b>.</p>
      <p>No incluye contraseñas ni fotografías. Las fotos se conservan imprimiendo cada
      cotización o guardándola como PDF.</p>`,
  },
};

/* El signo de interrogación que se pone junto a una etiqueta. */
const pista = (clave) =>
  `<button type="button" class="pista" title="Ayuda" onclick="ayuda('${clave}')">?</button>`;

window.ayuda = (clave) => {
  const t = AYUDA[clave];
  if (!t) return;
  abrirModal(t.titulo, `
    <div class="ayuda-texto">${t.texto}</div>
    <div class="ayuda-pie">
      ¿No resolviste la duda? Escríbenos por WhatsApp
      <a href="https://wa.me/525576574769" target="_blank" rel="noopener">55 7657 4769</a>.
    </div>
    <button class="btn sec full" style="margin-top:14px" onclick="cerrarModal()">Entendido</button>`);
};

/* Índice completo, para quien quiere leer de corrido. */
window.verAyuda = () => {
  abrirModal("Cómo se usa", `
    <p style="font-size:13px;color:var(--slate);margin-bottom:14px">
      También encuentras estas explicaciones como <b>?</b> junto a cada campo, mientras
      capturas.</p>
    ${Object.entries(AYUDA).map(([k, t]) => `
      <div class="item" onclick="ayuda('${k}')"><b>${esc(t.titulo)}</b></div>`).join("")}`);
};

/* ---------------- más ---------------- */
function verMas() {
  $("#masContenido").innerHTML = `
    <div class="card">
      <h3>Mi cuenta</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        ${esc(S.yo.nombre)} · ${esc(S.yo.correo)}<br>Perfil: ${esDueno() ? "Administrador general" : ROL_NOMBRE[S.yo.rol] || "Vendedor"}<br>
        <span style="font-size:11.5px">Versión ${VERSION}</span></p>
      <div class="acciones">
        <button class="btn sec sm" onclick="formCorreo()">Cambiar correo</button>
        <button class="btn sec sm" onclick="formPassword()">Cambiar contraseña</button>
      </div>
    </div>

    <div class="card">
      <h3>Cómo se usa</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Explicaciones cortas de cada parte. Las mismas aparecen como <b>?</b> junto a los
        campos mientras capturas, y funcionan aunque no tengas internet.</p>
      <button class="btn pri sm" onclick="verAyuda()">Ver la ayuda</button>
    </div>

    <!-- Firma del desarrollador: se queda igual aunque la instalación lleve
         la marca de otra empresa. -->
    <div class="card hecho-por">
      <img src="/icons/logo.png" alt="">
      <div>
        <b>Comercializadora Marcelestial S.A.S.</b>
        <span>Desarrollo del cotizador · Perfiles de aluminio y sistemas fotovoltaicos</span>
        <a href="https://wa.me/525576574769" target="_blank" rel="noopener">WhatsApp 55 7657 4769</a>
      </div>
    </div>
    ${esDueno() ? `
    <div class="card">
      <h3>Datos de la empresa</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Nombre, logo y contacto que salen impresos en las cotizaciones y en los vales.</p>
      <button class="btn pri sm" onclick="formEmpresa()">Configurar empresa</button>
    </div>
    <div class="card">
      <h3>Catálogo y precios</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Los precios que definas aquí son los que usan todos los vendedores.</p>
      <button class="btn pri sm" onclick="verCatalogo()">Administrar catálogo</button>
    </div>
    <div class="card">
      <h3>Cotizador rápido</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Precios unitarios que usa el cálculo rápido de fotovoltaico.</p>
      <button class="btn pri sm" onclick="formRapido()">Configurar precios</button>
    </div>
    <div class="card">
      <h3>Dimensionamiento desde el recibo</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Precio por panel, m² por módulo, enganche, plazo y las características de cada tipo de panel.</p>
      <button class="btn pri sm" onclick="formDimensionamiento()">Configurar parámetros</button>
    </div>
    <div class="card">
      <h3>Tarifas y precio por panel</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        GDMTH, GDMTO y doméstica, con su precio por tensión y por cantidad de módulos.</p>
      <button class="btn pri sm" onclick="formTarifas()">Configurar tarifas</button>
    </div>
    <div class="card">
      <h3>Guía de inversores</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Cuántos inversores lleva cada rango de paneles y qué modelo. Hoy el inversor va incluido en
        el precio por panel; si cambias de marca o suben los precios, aquí lo cobras por separado.</p>
      <button class="btn pri sm" onclick="formInversores()">Configurar inversores</button>
    </div>
    <div class="card">
      <h3>Usuarios ${pista("usuarios")}</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Vendedores, almacén y administradores: da de alta al equipo y controla quién tiene acceso.</p>
      <button class="btn pri sm" onclick="verUsuarios()">Administrar usuarios</button>
    </div>
    <div class="card">
      <h3>Clientes repetidos</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Los que se dieron de alta dos o tres veces antes de que la app avisara. Aquí los ves
        juntos, eliges cuál se queda y a ése se le pasan todas las cotizaciones de los otros.</p>
      <button class="btn pri sm" onclick="verDuplicados()">Revisar repetidos</button>
    </div>` : ""}
    ${S.demo ? `
    <div class="card" style="border:2px solid var(--amber)">
      <h3>Sitio de demostración</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Éste no es el sitio de trabajo: todo lo que hay aquí es ficticio y los precios son
        de referencia, no los reales. Cuando la demostración quede sucia de tanto probar,
        este botón la deja como nueva: <b>borra todo lo capturado</b> y vuelve a sembrar los
        clientes y las cotizaciones de ejemplo.</p>
      <button class="btn dan sm" onclick="reiniciarDemo(this)">Reiniciar la demostración</button>
    </div>` : ""}
    ${S.demo && S.licencia && S.licencia.topes && (S.licencia.topes.usuarios || S.licencia.topes.cotizaciones) ? `
    <div class="card">
      <h3>Versión de prueba</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Trabaja con <b>${S.licencia.topes.usuarios || "las"} cuentas</b> y
        <b>${S.licencia.topes.cotizaciones || "las"} cotizaciones</b>.
        ${S.licencia.vence ? `Vence el <b>${fechaLarga(S.licencia.vence)}</b>.` : ""}
        En la versión completa no hay topes ni marca de agua en los PDF.</p>
      ${S.licencia.contacto ? `<a class="btn pri sm" target="_blank" rel="noopener"
         href="https://wa.me/${String(S.licencia.contacto).replace(/\D/g, "")}?text=${
           encodeURIComponent("Hola, uso la versión de prueba del cotizador y quiero la versión completa.")
         }">Quiero la versión completa</a>` : ""}
    </div>` : ""}
    ${esDueno() ? `<div class="card">
      <h3>Respaldo de tu información ${pista("respaldo")}</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Descarga en un archivo todo lo que has capturado: clientes, cotizaciones, catálogo,
        almacén y vales. <b>Es tuyo y lo puedes bajar cuando quieras</b>, también si la
        licencia ya venció. No incluye contraseñas ni fotografías; las fotos se guardan
        desde el botón de imprimir de cada cotización.</p>
      <button class="btn pri sm" onclick="descargarRespaldo(this)">Descargar respaldo</button>
    </div>` : ""}
    ${esDueno() ? `<div class="card">
      <h3>Datos de ejemplo</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Carga clientes, cotizaciones y movimientos ficticios para ver cómo se ve la app trabajando
        o para entrenar a un vendedor. Se borran cuando quieras, sin tocar tu información real.</p>
      <div class="acciones">
        <button class="btn pri sm" onclick="datosEjemplo('cargar')">Cargar ejemplos</button>
        <button class="btn dan sm" onclick="datosEjemplo('borrar')">Borrar ejemplos</button>
      </div>
    </div>` : ""}
    <div class="card">
      <h3>Instalar en el celular</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Android: menú del navegador → <b>Instalar aplicación</b>.<br>
        iPhone: botón compartir → <b>Agregar a inicio</b>.</p>
      <button class="btn sec sm" onclick="buscarActualizacion()">Buscar actualización</button>
    </div>`;
}

function formCorreo() {
  abrirModal("Cambiar mi correo", `
    <p style="font-size:13px;color:var(--slate);margin-bottom:14px">
      Correo actual: <b style="color:var(--ink)">${esc(S.yo.correo)}</b><br>
      Con el correo nuevo entrarás la próxima vez. La contraseña no cambia.</p>
    <form id="fCorreo">
      <label class="f"><span>Correo nuevo</span><input type="email" name="correo" required></label>
      <label class="f"><span>Tu contraseña actual</span><input type="password" name="password" required></label>
      <button class="btn pri full" type="submit">Actualizar correo</button>
    </form>`);
  $("#fCorreo").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const r = await api("cambiar-correo", { method: "POST", body: Object.fromEntries(new FormData(ev.target)) });
      S.yo.correo = r.correo;
      cerrarModal();
      verMas();
      alert("Listo. Tu correo ahora es " + r.correo);
    } catch (x) { aviso("#modalError", x.message); }
  });
}

function formPassword() {
  abrirModal("Cambiar contraseña", `
    <form id="fPass">
      <label class="f"><span>Contraseña actual</span><input type="password" name="actual" required></label>
      <label class="f"><span>Nueva contraseña (mínimo 8)</span><input type="password" name="nueva" minlength="8" required></label>
      <button class="btn pri full" type="submit">Actualizar</button>
    </form>`);
  $("#fPass").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      /* Cambiar la contraseña cierra las otras sesiones de la cuenta. El
         servidor devuelve un token nuevo para no tirar la sesión de aquí. */
      const r = await api("cambiar-password", { method: "POST", body: Object.fromEntries(new FormData(ev.target)) });
      if (r?.token) { S.token = r.token; localStorage.setItem("mc_token", r.token); }
      cerrarModal();
      alert("Contraseña actualizada. Si habías iniciado sesión en otro teléfono, ahí ya se cerró.");
    } catch (x) { aviso("#modalError", x.message); }
  });
}

async function verCatalogo() {
  await cargarCatalogo();
  abrirModal("Catálogo y precios", `
    <button class="btn pri sm" style="margin-bottom:12px" onclick="formConcepto()">+ Nuevo concepto</button>
    <div style="max-height:62vh;overflow:auto">
      ${S.catalogo.map((c) => `
        <div class="item" onclick="formConcepto(${c.id})">
          <div class="m"><b>${esc(c.descripcion)}</b>
          <span>${esc(c.clave)} · ${esc(c.categoria)}${c.activo ? "" : " · INACTIVO"}</span></div>
          <div class="r"><b>${money(c.precio)}</b>
          <span style="font-size:11px;color:var(--slate)">${esc(c.unidad)}</span></div>
        </div>`).join("")}
    </div>`);
}

function formConcepto(id = null) {
  const c = id ? S.catalogo.find((x) => x.id === id) || {} : {};
  const cats = ["panel", "inversor", "estructura", "perfil", "herraje", "electrico", "mano_obra", "servicio"];
  abrirModal(id ? "Editar concepto" : "Nuevo concepto", `
    <form id="fCat">
      <label class="f"><span>Clave *</span><input name="clave" required value="${esc(c.clave || "")}" ${id ? "readonly" : ""}></label>
      <label class="f"><span>Descripción *</span><input name="descripcion" required value="${esc(c.descripcion || "")}"></label>
      <div class="grid2">
        <label class="f"><span>Categoría</span><select name="categoria">
          ${cats.map((x) => `<option ${c.categoria === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label class="f"><span>Unidad</span><input name="unidad" value="${esc(c.unidad || "PZA")}"></label>
        <label class="f"><span>Precio unitario</span><input name="precio" type="number" step="0.01" value="${Number(c.precio || 0)}"></label>
        <label class="f"><span>Mínimo en almacén</span><input name="minimo" type="number" step="0.01" value="${Number(c.minimo || 0)}"></label>
      </div>
      <label class="f"><span>Línea de negocio</span><select name="linea">
        ${Object.entries(LINEAS).map(([k, v]) => `<option value="${k}" ${(c.linea || "fotovoltaico") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f"><span>Control de inventario</span><select name="controla_inventario">
        <option value="true" ${c.controla_inventario ? "selected" : ""}>Sí, llevar existencias</option>
        <option value="false" ${c.controla_inventario ? "" : "selected"}>No</option></select></label>
      ${id ? `<label class="f"><span>Estado</span><select name="activo">
        <option value="true" ${c.activo ? "selected" : ""}>Activo</option>
        <option value="false" ${c.activo ? "" : "selected"}>Inactivo</option></select></label>` : ""}
      <button class="btn pri full" type="submit">Guardar</button>
    </form>`);
  $("#fCat").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    d.controla_inventario = d.controla_inventario === "true";
    if ("activo" in d) d.activo = d.activo === "true";
    try {
      if (id) await api("catalogo", { method: "PATCH", body: { id, ...d } });
      else await api("catalogo", { method: "POST", body: d });
      await cargarCatalogo(); verCatalogo();
    } catch (x) { aviso("#modalError", x.message); }
  });
}

async function verUsuarios() {
  try {
    const { usuarios } = await api("usuarios");
    abrirModal("Usuarios", `
      <button class="btn pri sm" style="margin-bottom:12px" onclick="formUsuario()">+ Nuevo usuario</button>
      ${usuarios.map((u) => `
        <div class="item" onclick="formUsuario(${u.id})">
          <div class="m"><b>${esc(u.nombre)}</b>
          <span>${esc(u.correo)} · ${ROL_NOMBRE[u.rol] || u.rol}</span></div>
          <div class="r"><b>${u.rol === "almacen" ? u.vales : u.cotizaciones}</b>
          <span style="display:block;font-size:10px;color:var(--slate)">${u.rol === "almacen" ? "vales" : "cotizaciones"}</span>
          <span class="badge ${u.activo ? "b-ok" : "b-bajo"}">${u.activo ? "Activo" : "Inactivo"}</span></div>
        </div>`).join("")}`);
    window._usuarios = usuarios;
  } catch (e) { alert(e.message); }
}

function formUsuario(id = null) {
  const u = id ? (window._usuarios || []).find((x) => x.id === id) || {} : {};
  const rolActual = u.rol || "vendedor";
  abrirModal(id ? "Editar usuario" : "Nuevo usuario", `
    <form id="fUsr">
      <label class="f"><span>Nombre *</span><input name="nombre" required value="${esc(u.nombre || "")}"></label>
      <label class="f"><span>Puesto</span><select name="rol">
        <option value="vendedor" ${rolActual === "vendedor" ? "selected" : ""}>Vendedor · cotiza y lleva sus clientes</option>
        <option value="almacen" ${rolActual === "almacen" ? "selected" : ""}>Almacén · entradas, salidas y kardex; sin precios</option>
        <option value="owner" ${rolActual === "owner" ? "selected" : ""}>Administrador · todo</option>
      </select></label>
      <label class="f"><span>Correo *</span>
        <input name="correo" type="email" ${id ? "" : "required"} value="${esc(u.correo || "")}"></label>
      <label class="f"><span>Teléfono</span><input name="telefono" value="${esc(u.telefono || "")}"></label>
      <label class="f"><span>${id ? "Nueva contraseña (opcional)" : "Contraseña (opcional)"}</span>
        <input name="password" type="password" minlength="8"
               placeholder="${id ? "" : "Déjala vacía para invitarlo"}"></label>
      ${id ? "" : `<small style="display:block;color:var(--slate);margin:-6px 0 14px">
        Si la dejas vacía se genera un <b>enlace de invitación</b> y esa persona elige su
        propia contraseña. Es lo recomendado: así nadie más la conoce.</small>`}
      ${id ? `<label class="f"><span>Estado</span><select name="activo">
        <option value="true" ${u.activo ? "selected" : ""}>Activo</option>
        <option value="false" ${u.activo ? "" : "selected"}>Inactivo (sin acceso)</option></select></label>` : ""}
      <button class="btn pri full" type="submit">Guardar</button>
    </form>
    ${id && id !== S.yo.id ? `<div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)">
      <button class="btn sec full" style="margin-bottom:10px" onclick="reinvitar(${id})">Volver a invitar</button>
      <p style="font-size:11.5px;color:var(--slate);margin:-4px 0 14px">
        Genera un enlace nuevo para que elija otra vez su contraseña. El anterior deja de servir
        y su sesión abierta se cierra. Sirve si perdió el enlace o si olvidó la contraseña.</p>
      <button class="btn dan full" onclick="eliminarUsuario(${id})">Eliminar usuario</button>
      <p style="font-size:11.5px;color:var(--slate);margin-top:8px">
        Si solo quieres quitarle el acceso sin borrar nada, ponlo como Inactivo arriba.</p>
    </div>` : ""}`);
  $("#fUsr").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    if (!d.password) delete d.password;
    if ("activo" in d) d.activo = d.activo === "true";
    try {
      if (id) {
        await api("usuarios", { method: "PATCH", body: { id, ...d } });
        verUsuarios();
      } else {
        const r = await api("usuarios", { method: "POST", body: d });
        if (r.invitacion) return verInvitacion(r.usuario, r.invitacion);
        verUsuarios();
      }
    } catch (x) { aviso("#modalError", x.message); }
  });
}


/* El enlace de invitación, listo para copiar o mandar por WhatsApp. Se muestra
   una sola vez: el código no se guarda en claro, así que si se pierde hay que
   volver a invitar. */
function verInvitacion(u, codigo) {
  const liga = location.origin + location.pathname + "?activar=" + encodeURIComponent(codigo);
  const texto = `Hola ${u.nombre}. Aquí está tu acceso al cotizador. ` +
                `Abre este enlace y elige tu contraseña: ${liga}`;
  abrirModal("Invitación lista", `
    <p style="font-size:13.5px;color:var(--slate);line-height:1.6">
      Se dio de alta a <b>${esc(u.nombre)}</b> (${esc(u.correo)}) sin contraseña.
      Mándale este enlace: al abrirlo elige la suya y entra.</p>
    <div class="dato-fijo" style="word-break:break-all;font-weight:500;font-size:12.5px">${esc(liga)}</div>
    <p style="font-size:12px;color:var(--slate);margin:12px 0 16px">
      Vale <b>7 días</b> y sirve <b>una sola vez</b>. Este enlace no se vuelve a mostrar;
      si se pierde, usa «Volver a invitar» en su ficha.</p>
    <div class="acciones">
      <button class="btn pri sm" onclick="copiarTexto(${JSON.stringify(liga).replace(/"/g, "&quot;")}, this)">Copiar enlace</button>
      <a class="btn sec sm" target="_blank" rel="noopener"
         href="https://wa.me/?text=${encodeURIComponent(texto)}">Enviar por WhatsApp</a>
    </div>
    <button class="btn sec full" style="margin-top:16px" onclick="cerrarModal(); verUsuarios()">Listo</button>`);
}

window.copiarTexto = async (t, btn) => {
  const antes = btn.textContent;
  try { await navigator.clipboard.writeText(t); btn.textContent = "Copiado"; }
  catch { btn.textContent = "Selecciona y copia a mano"; }
  setTimeout(() => { btn.textContent = antes; }, 2500);
};

window.reinvitar = async (id) => {
  try {
    const r = await api("usuarios", { method: "PATCH", body: { id, reinvitar: true } });
    verInvitacion(r.usuario, r.invitacion);
  } catch (x) { alert(x.message); }
};

function formRapido() {
  const P = paramFV();
  const campo = (k, etq, ayuda) => `<label class="f"><span>${etq}</span>
    <input name="${k}" type="number" step="0.01" value="${Number(P[k] || 0)}">
    ${ayuda ? `<small style="font-size:11px;color:var(--slate)">${ayuda}</small>` : ""}</label>`;
  abrirModal("Precios del cotizador rápido", `
    <form id="fRap">
      ${campo("panel_precio", "Precio por panel", "Costo al cliente de cada panel instalado")}
      ${campo("inversor_precio", "Precio por inversor", "")}
      ${campo("estructura_por_panel", "Estructura por panel", "Riel, abrazaderas y tornillería de cada panel")}
      ${campo("electrico_por_kwp", "Material eléctrico por kWp", "")}
      ${campo("manobra_por_kwp", "Mano de obra por kWp", "")}
      ${campo("paneles_por_inversor", "Paneles por inversor", "Para sugerir cuántos inversores lleva")}
      ${campo("produccion_kwh_kwp_bim", "kWh bimestrales por kWp", "Factor de producción de la zona")}
      ${campo("precio_kwh_default", "Precio por kWh de arranque",
        "Lo que se propone cuando no hay recibo a la mano. El vendedor lo puede cambiar en cada cotización.")}
      <button class="btn pri full" type="submit">Guardar precios</button>
    </form>`);
  $("#fRap").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    Object.keys(d).forEach((k) => (d[k] = numero(d[k])));
    try {
      await api("config", { method: "PATCH", body: { clave: "rapido_fotovoltaico", valor: d } });
      await cargarConfig();
      cerrarModal();
      alert("Precios actualizados.");
    } catch (x) { aviso("#modalError", x.message); }
  });
}

/* ---------------- bitácora de seguimiento ---------------- */
async function verSeguimiento(id) {
  try {
    const { seguimiento } = await api("seguimiento/" + id);
    abrirModal("Seguimiento", `
      <form id="fSeg" style="margin-bottom:16px">
        <label class="f"><span>Nueva nota</span>
          <textarea name="nota" required placeholder="Le llamé, quedó de revisarlo el viernes…"></textarea></label>
        <label class="f"><span>Cambiar estatus (opcional)</span>
          <select name="estatus"><option value="">— Sin cambio —</option>
          ${Object.entries(ESTATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <button class="btn pri full" type="submit">Registrar</button>
      </form>
      <div style="max-height:40vh;overflow:auto">
      ${seguimiento.length ? seguimiento.map((x) => `
        <div style="padding:10px 0;border-bottom:1px dashed var(--line)">
          <div style="font-size:13px">${esc(x.nota)}</div>
          <div style="font-size:11px;color:var(--slate);margin-top:3px">
            ${fecha(x.fecha)} · ${esc(x.usuario || "")}${x.estatus ? " · marcó " + (ESTATUS[x.estatus] || x.estatus) : ""}</div>
        </div>`).join("") : '<div class="vacio">Sin notas todavía.</div>'}
      </div>`);
    $("#fSeg").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(ev.target));
      try { await api("seguimiento/" + id, { method: "POST", body: d }); verSeguimiento(id); }
      catch (x) { aviso("#modalError", x.message); }
    });
  } catch (e) { alert(e.message); }
}

/* Deja la demostración como recién instalada. El servidor sólo acepta esto si
   Netlify tiene MODO_DEMO = 1, así que en el sitio de trabajo ni existe. */
async function reiniciarDemo(boton) {
  if (!confirm("Se borra TODO lo capturado en este sitio de demostración —clientes, " +
               "cotizaciones y movimientos— y se vuelven a sembrar los ejemplos.\n\n" +
               "Esto no afecta al sitio de trabajo de Marcelestial.\n\n¿Continuamos?")) return;
  await conBoton(boton, async () => {
    try {
      const r = await api("demo", { method: "POST", body: { accion: "reiniciar", confirmar: "REINICIAR" } });
      S.cotCargadas = false;
      await cargarClientes(); await cargarCatalogo(); await cargarConfig();
      alert(r.mensaje || "La demostración quedó como nueva.");
      ir("panel");
    } catch (e) { alert(e.message); }
  }, "Reiniciando…");
}

async function datosEjemplo(accion) {
  if (accion === "borrar" && !confirm("¿Borrar todos los clientes y cotizaciones de ejemplo? Tus datos reales no se tocan."))
    return;
  try {
    const r = await api("demo", { method: "POST", body: { accion } });
    await Promise.all([cargarClientes(), cargarCatalogo()]);
    alert(r.mensaje || "Listo.");
    ir("panel");
  } catch (x) { alert(x.message); }
}

async function eliminarUsuario(id) {
  const lista = window._usuarios || [];
  const u = lista.find((x) => x.id === id);
  if (!u) return;
  const otros = lista.filter((x) => x.id !== id && x.activo);
  const n = u.cotizaciones || 0;

  abrirModal(`Eliminar a ${esc(u.nombre)}`, `
    <p style="font-size:13.5px;line-height:1.6;margin-bottom:14px">
      ${n > 0
        ? `Esta persona tiene <b>${n} ${n === 1 ? "cotización" : "cotizaciones"}</b> a su nombre. Decide qué pasa con ${n === 1 ? "ella" : "ellas"}.`
        : "No tiene cotizaciones a su nombre. Se puede eliminar sin más."}
    </p>
    ${n > 0 ? `<label class="f"><span>Su trabajo pasa a</span>
      <select id="elTransfer">
        <option value="">Dejarlo sin vendedor asignado</option>
        ${otros.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join("")}
      </select></label>
      <p style="font-size:11.5px;color:var(--slate);margin-bottom:16px">
        Las cotizaciones y clientes no se borran nunca. Si los dejas sin vendedor, solo tú los verás.</p>` : ""}
    <div class="acciones">
      <button class="btn dan" onclick="confirmarEliminar(${id})">Sí, eliminar</button>
      <button class="btn sec" onclick="cerrarModal()">Cancelar</button>
    </div>`);
}

async function confirmarEliminar(id) {
  const t = $("#elTransfer")?.value;
  try {
    const r = await api(`usuarios?id=${id}${t ? "&transferir=" + t : ""}`, { method: "DELETE" });
    cerrarModal();
    await verUsuarios();
    alert(r.mensaje || "Vendedor eliminado.");
  } catch (x) { aviso("#modalError", x.message); }
}

async function buscarActualizacion() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const llaves = await caches.keys();
      await Promise.all(llaves.map((k) => caches.delete(k)));
    }
  } catch {}
  alert("Buscando la versión más reciente. La app se va a recargar.");
  location.reload(true);
}

/* ---------------- modal ---------------- */
function abrirModal(titulo, html) {
  $("#modalTitulo").textContent = titulo;
  $("#modalCuerpo").innerHTML = html;
  aviso("#modalError", "");
  $("#modal").hidden = false;
}
function cerrarModal() { $("#modal").hidden = true; }

/* El buscador de CLIENTES filtra lo que ya está cargado: la lista de clientes
   viene completa, así que responde al instante. */
{
  const caja = $("#qCli");
  if (caja) {
    caja.addEventListener("input", () => pintarClientes());
    caja.addEventListener("search", () => pintarClientes());
  }
}

/* El buscador de COTIZACIONES trabaja en dos tiempos:
   1. filtra al instante lo que ya está en el teléfono, para que se sienta vivo;
   2. medio segundo después le pregunta al servidor, que sí revisa TODO el
      historial —incluidas las viejas que no cabían en la lista descargada—.
   Las respuestas viejas se descartan: si el vendedor siguió escribiendo, sólo
   vale la última búsqueda. */
{
  const caja = $("#qCot");
  if (caja) {
    let reloj = null, turno = 0;

    const preguntarAlServidor = async () => {
      const q = caja.value.trim();
      const mio = ++turno;
      if (q.length < 2) {                 // con una letra no vale la pena
        S.buscando = false;
        if (!q && !S.cotCargadas) { await verCotizaciones(); return; }
        pintarCotizaciones();
        return;
      }
      S.buscando = true;
      pintarCotizaciones();
      try {
        const r = await api("cotizaciones?q=" + encodeURIComponent(q));
        if (mio !== turno) return;        // llegó tarde: ya se escribió otra cosa
        S.cotizaciones = r.cotizaciones || [];
        S.cotEncontradas = r.encontradas ?? S.cotizaciones.length;
        S.cotRecortada = !!r.recortada;
        S.cotCargadas = false;            // la lista en memoria ya no es la general
      } catch { /* sin señal: se queda con lo que ya filtró en el teléfono */ }
      if (mio !== turno) return;
      S.buscando = false;
      pintarCotizaciones();
    };

    const alEscribir = () => {
      pintarCotizaciones();               // respuesta inmediata con lo que hay
      clearTimeout(reloj);
      reloj = setTimeout(preguntarAlServidor, 450);
      if (!caja.value.trim()) { clearTimeout(reloj); preguntarAlServidor(); }
    };
    caja.addEventListener("input", alEscribir);
    caja.addEventListener("search", alEscribir);
  }
}
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") cerrarModal(); });

/* ---------------- exponer al HTML ---------------- */
Object.assign(window, {
  ir, abrirCotizacion, nuevaCotizacion, agregarPartida, guardarCotizacion,
  borrarCotizacion, imprimirCotizacion, cerrarPrevia, imprimirAhora,
  formCliente, formMovimiento,
  formPassword, verCatalogo, formConcepto, verUsuarios, formUsuario, cerrarModal,
  formRapido, verSeguimiento, datosEjemplo, formCorreo, eliminarUsuario, confirmarEliminar,
  buscarActualizacion, formTarifas,
  abrirDesdeCliente, nuevaParaCliente, verDuplicados, unirDuplicados,
  reiniciarDemo,
  menuVale, nuevoVale, cerrarEditorVale, elegirConceptoVale, agregarConceptoVale, cantidadVale,
  quitarPartidaVale, precargarDeCotizacion, guardarVale, abrirVale, formEntregaVale, devolverDeVale,
  cancelarVale, imprimirVale, limpiarFirma, pintarKardex, pintarVales,
});

/* ---------------- service worker ---------------- */
if ("serviceWorker" in navigator)
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

arrancar();
