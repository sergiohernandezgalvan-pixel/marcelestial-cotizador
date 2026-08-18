/* Cotizador Marcelestial — app cliente */
const VERSION = "2026.08.18-2";
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
const fecha = (f) => f ? new Date(f).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "";
const esDueno = () => S.yo?.rol === "owner";

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
  if (!r.ok) throw new Error(datos.error || "Error " + r.status);
  return datos;
}

/* ---------------- avisos ---------------- */
function aviso(el, texto, tipo = "err") {
  const n = $(el);
  n.className = "aviso " + tipo + (texto ? " on" : "");
  n.textContent = texto || "";
}

/* ---------------- acceso ---------------- */
async function arrancar() {
  if (S.token) {
    try {
      const { usuario } = await api("yo");
      S.yo = usuario;
      return entrar();
    } catch { localStorage.removeItem("mc_token"); S.token = null; }
  }
  try {
    const { instalado } = await api("estado");
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
  $("#quienSoy").textContent = `${S.yo.nombre} · ${esDueno() ? "Administrador" : "Vendedor"}`;
  await Promise.all([cargarCatalogo(), cargarClientes(), cargarConfig()]);
  ir("panel");
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
  $("#fab").hidden = !["cot", "cli"].includes(v);
  $("#fab").onclick = v === "cot" ? menuNueva : v === "cli" ? formCliente : null;
  if (v === "panel") verPanel();
  if (v === "cot") verCotizaciones();
  if (v === "cli") verClientes();
  if (v === "inv") verInventario();
  if (v === "mas") verMas();
}

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
const paramFV = () => S.config.rapido_fotovoltaico || {};
const paramDim = () => S.config.dimensionamiento || {};

/* ---------------- panel ---------------- */
async function verPanel() {
  $("#panelDes").textContent = esDueno() ? "Actividad de todo el equipo" : "Resumen de tu actividad";
  $("#panelKpis").innerHTML = '<div class="cargando">Cargando…</div>';
  $("#panelExtra").innerHTML = "";
  try {
    const { resumen, bajoMinimo, porVendedor } = await api("panel");
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
    S.cotizaciones = (await api("cotizaciones")).cotizaciones || [];
    if (!S.cotizaciones.length) {
      $("#listaCot").innerHTML = `<div class="vacio">Todavía no hay cotizaciones.<br>Toca el botón <b>+</b> para crear la primera.</div>`;
      return;
    }
    $("#listaCot").innerHTML = S.cotizaciones.map((c) => `
      <div class="item" onclick="abrirCotizacion(${c.id})">
        <div class="m">
          <b>${esc(c.cliente || "Sin cliente")}</b>
          <span>${esc(c.folio)} · ${LINEAS[c.linea] || ""}${c.tipo === "rapida" ? " · rápida" : ""} · ${fecha(c.creado_en)}${esDueno() ? " · " + esc(c.vendedor || "") : ""}</span>
        </div>
        <div class="r">
          <b>${money(c.total)}</b>
          <span class="badge b-${c.estatus}">${ESTATUS[c.estatus] || c.estatus}</span>
        </div>
      </div>`).join("");
  } catch (e) { $("#listaCot").innerHTML = `<div class="vacio">${esc(e.message)}</div>`; }
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
      <label class="f"><span>Cliente</span>
        <select id="edCliente"><option value="">— Selecciona —</option>${opcCli}</select></label>
      <button class="btn sec sm" onclick="formCliente()">+ Nuevo cliente</button>
      <label class="f" style="margin-top:12px"><span>Estatus</span><select id="edEstatus">${opcEst}</select></label>
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
      <button class="btn pri" onclick="guardarCotizacion()">Guardar</button>
      ${e.id ? `<button class="btn sec" onclick="imprimirCotizacion()">Ver / PDF</button>
                ${e._full && e._full.recibo_foto
                  ? `<button class="btn sec" onclick="imprimirCotizacion(true)"
                       title="Uso interno: incluye la foto del recibo">PDF con recibo</button>` : ""}
                <button class="btn sec" onclick="verSeguimiento(${e.id})">Seguimiento</button>
                <button class="btn dan" onclick="borrarCotizacion()">Borrar</button>` : ""}
    </div>`;

  $$(".vista").forEach((s) => (s.hidden = true));
  $("#v-editor").hidden = false;
  $("#fab").hidden = true;
  window.scrollTo(0, 0);
  pintarPartidas();
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

function pintarPartidas() {
  const cont = $("#edPartidas");
  if (!cont) return;
  const p = S.editor.partidas;
  if (!p.length) { cont.innerHTML = '<div class="vacio" style="padding:18px">Sin conceptos todavía.</div>'; }
  else {
    cont.innerHTML = p.map((x, i) => `
      <div class="partida">
        <div class="d"><b>${esc(x.descripcion)}</b><span>${esc(x.clave)} · ${esc(x.unidad || "PZA")} · ${money(x.precio)}</span></div>
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

async function guardarCotizacion() {
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

  $("#doc").innerHTML = `
    <div class="hoja">
      <div class="dh">
        <div>
          <h1>Propuesta técnica-económica</h1>
          <div style="font-size:11.5px;color:#6b7280;margin-top:4px">
            Sistema de autogeneración de energía fotovoltaica solar</div>
        </div>
        <img src="/icons/logo.png" alt="">
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
        ${campo("Número de paneles", t.paneles)}${campo("Capacidad por panel", t.wpanel ? t.wpanel + " W" : "")}
        ${campo("Marca y modelo del panel", t.marcapanel)}${campo("Número de inversores", t.inversores)}
        ${campo("Capacidad del inversor", t.capinversor)}${campo("Marca del inversor", t.marcainversor)}
      </div>` : ""}

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
        <b>Comercializadora Marcelestial S.A.S.</b> · Perfiles de aluminio · Sistemas fotovoltaicos · Soluciones eléctricas<br>
        WhatsApp 55 7657 4769 · contacto@marcelestial.net · www.marcelestial.net · CDMX y Estado de México<br><br>
        Los precios son indicativos y están sujetos a revisión técnica en sitio y a confirmación por escrito.
        Vigencia de la oferta: 30 días. Cifras de ahorro estimadas con base en el consumo histórico reportado
        y en las tarifas vigentes de CFE.
      </div>
    </div>
    ${tablaRecuperacion(c, total)}`;
  setTimeout(() => window.print(), 120);
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
    <div class="hoja recuperacion">
      <div class="dh">
        <div><h1>Recuperación de la inversión</h1>
          <div style="font-size:11.5px;color:#6b7280;margin-top:4px">
            Folio ${esc(c.folio || "")} · ${esc(c.cliente_nombre || "")}</div></div>
        <img src="/icons/logo.png" alt="">
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
        <b>Comercializadora Marcelestial S.A.S.</b> · Perfiles de aluminio · Sistemas fotovoltaicos · Soluciones eléctricas<br>
        WhatsApp 55 7657 4769 · contacto@marcelestial.net · www.marcelestial.net · CDMX y Estado de México
      </div>
    </div>`;
}


/* ---------------- nueva cotización: rápida o formal ---------------- */
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
      <label class="f"><span>Cliente</span>
        <select id="rpCliente"><option value="">— Selecciona —</option>${opcCli}</select></label>
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
      <button class="btn pri" onclick="guardarRapida()">Guardar y generar PDF</button>
    </div>`;

  $$(".vista").forEach((x) => (x.hidden = true));
  $("#v-editor").hidden = false;
  $("#fab").hidden = true;
  window.scrollTo(0, 0);
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

async function guardarRapida() {
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
    S.editor = { id: cotizacion.id, folio: cotizacion.folio };
    aviso("#rpAviso", "Guardada como " + cotizacion.folio, "ok");
    setTimeout(imprimirCotizacion, 400);
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
      <label class="f"><span>Cliente</span>
        <select id="rpCliente"><option value="">— Selecciona —</option>${opcCli}</select></label>
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
      <button class="btn pri" onclick="guardarRapidaCat()">Guardar y generar PDF</button>
    </div>`;
  $$(".vista").forEach((x) => (x.hidden = true));
  $("#v-editor").hidden = false;
  $("#fab").hidden = true;
  window.scrollTo(0, 0);
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

async function guardarRapidaCat() {
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
    S.editor = { id: cotizacion.id, folio: cotizacion.folio };
    aviso("#rpAviso", "Guardada como " + cotizacion.folio, "ok");
    setTimeout(imprimirCotizacion, 400);
  } catch (x) { aviso("#rpAviso", x.message); }
}

Object.assign(window, { menuNueva, rapidaFV, guardarRapida, guardarRapidaCat, calcFV });


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
  const precioMin = Number(P.precio_kwh_min) || 0;
  const precioMax = Number(P.precio_kwh_max) || 0;
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
      <label class="f"><span>Cliente</span>
        <select id="rcCliente"><option value="">— Selecciona —</option>${opcCli}</select></label>
      <button class="btn sec sm" onclick="formCliente()">+ Nuevo cliente</button>
    </div>

    <div class="card">
      <h3>Tarifa del recibo</h3>
      <label class="f"><span>Tarifa</span>
        <select id="rcTarifa" onchange="cambiarTarifa(this.value)">
          ${listaTarifas().map((t) => `<option value="${esc(t.clave)}" ${t.clave === tar.clave ? "selected" : ""}>${esc(t.nombre)}</option>`).join("")}
        </select></label>
      <label class="f"><span>Nº de servicio</span>
        <input id="rcServicio" inputmode="numeric" placeholder="viene arriba en el recibo"></label>

      ${esMedia ? `
        <div class="grid2">
          <label class="f"><span>Tensión de interconexión</span>
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
          Van siempre en esta tarifa y su costo ya está considerado en el precio por panel.</p>` : ""}
    </div>

    <div class="card">
      <h3>Consumo y pago</h3>
      ${tar.horaria ? `
        <div class="grid3">
          <label class="f"><span>Base (kWh)</span><input type="number" id="rcBase" value="0" inputmode="numeric"></label>
          <label class="f destaca"><span>Intermedia (kWh)</span><input type="number" id="rcInter" value="0" inputmode="numeric"></label>
          <label class="f"><span>Punta (kWh)</span><input type="number" id="rcPunta" value="0" inputmode="numeric"></label>
        </div>
        <p style="font-size:11.5px;color:var(--slate);margin-top:-4px;margin-bottom:10px">
          La <b style="color:var(--sky)">intermedia</b> es donde actúan los paneles.</p>`
      : `
        <label class="f"><span>Consumo del periodo (kWh)</span>
          <input type="number" id="rcConsumo" value="0" inputmode="numeric"></label>`}
      <div class="grid2">
        <label class="f"><span>Periodo facturado · del</span>
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
        <label class="f"><span>Módulos a cotizar</span>
          <input type="number" id="rcModulos" placeholder="automático" inputmode="numeric"></label>
        <label class="f"><span>Inversores</span>
          <input type="number" id="rcInversores" placeholder="automático" inputmode="numeric"></label>
        <label class="f"><span>Precio por panel ($)</span>
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

    <div class="card" id="rcResultado"></div>

    <div class="acciones" style="margin-bottom:30px">
      <button class="btn pri" onclick="guardarRecibo()">Guardar y generar PDF</button>
    </div>`;

  $$(".vista").forEach((x) => (x.hidden = true));
  $("#v-editor").hidden = false;
  $("#fab").hidden = true;
  window.scrollTo(0, 0);
  ["rcBase","rcInter","rcPunta","rcConsumo","rcDias","rcPago","rcModulos","rcInversores","rcPrecio","rcDemanda","rcServicio"]
    .forEach((id) => { const n = $("#" + id); if (n) n.addEventListener("input", () => { recordarRecibo(); calcRecibo(); }); });
  $("#rcFoto")?.addEventListener("change", tomarFoto);
  pintarFoto();
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

window.quitarFoto = () => { S.rcFoto = null; pintarFoto(); };

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
        ? ` · ${money(r.precioInv)} c/u` : " · incluido en el precio por panel"}</span></div>` : ""}

    <div class="spec" style="margin-bottom:6px">
      <div><span>Tarifa</span><b>${esc(r.tar.clave || "")} · ${esc(d.tension)} V</b></div>
      <div><span>Consumo total</span><b>${n(r.consumo, 0)} kWh</b></div>
      <div><span>Precio promedio</span><b>$${n(r.precioKwh, 4)} / kWh</b></div>
      <div><span>Consumo por día</span><b>${n(r.consumoDia)} kWh</b></div>
      <div><span>Genera un panel al día</span><b>${n(r.porPanelDia, 4)} kWh</b></div>
      <div><span>Producción mensual</span><b>${n(r.produccionMes, 0)} kWh</b></div>
      <div><span>Inversores</span><b>${r.inversores > 0 ? n(r.inversores, 0) : "por definir"}${
        r.guia && r.inversores === r.invSugeridos ? " · " + esc(r.guia.capacidad_ac) : ""}</b></div>
      <div><span>Precio por panel</span><b>${money(r.precioPanel)}</b></div>
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

async function guardarRecibo() {
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
    S.editor = { id: cotizacion.id, folio: cotizacion.folio };
    aviso("#rcAviso", "Guardada como " + cotizacion.folio, "ok");
    setTimeout(imprimirCotizacion, 400);
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

/* ---- tarifas y precios por panel (solo dueño) ---- */
function formTarifas() {
  const T = paramTar();
  const lista = T.lista || [];
  abrirModal("Tarifas y precio por panel", `
    <p style="font-size:12.5px;color:var(--slate);margin-bottom:14px">
      El precio se resuelve por tarifa, tensión y cantidad de módulos. "Hasta" es el tope de
      módulos de ese escalón.</p>
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

/* ---------------- clientes ---------------- */
function verClientes() {
  $("#listaCli").innerHTML = !S.clientes.length
    ? '<div class="vacio">Sin clientes todavía.<br>Toca <b>+</b> para agregar el primero.</div>'
    : S.clientes.map((c) => `
      <div class="item" onclick='formCliente(${c.id})'>
        <div class="m"><b>${esc(c.nombre)}</b>
        <span>${esc(c.telefono || c.correo || c.direccion || "Sin datos de contacto")}</span></div>
        <div class="r" style="color:var(--slate);font-size:19px">›</div>
      </div>`).join("");
}

function formCliente(id = null) {
  const c = id ? S.clientes.find((x) => x.id === id) || {} : {};
  const campo = (k, etq, tipo = "text") =>
    `<label class="f"><span>${etq}</span><input name="${k}" type="${tipo}" value="${esc(c[k] || "")}"></label>`;
  abrirModal(id ? "Editar cliente" : "Nuevo cliente", `
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
  $("#fCli").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    try {
      if (id) await api("clientes", { method: "PATCH", body: { id, ...d } });
      else await api("clientes", { method: "POST", body: d });
      await cargarClientes();
      cerrarModal();
      if (vistaActual === "cli") verClientes();
      if (S.editor && $("#edCliente")) editor();
    } catch (x) { aviso("#modalError", x.message); }
  });
}

/* ---------------- inventario ---------------- */
async function verInventario() {
  await cargarCatalogo();
  const items = S.catalogo.filter((c) => c.controla_inventario);
  $("#listaInv").innerHTML = !items.length
    ? '<div class="vacio">No hay conceptos con control de inventario.</div>'
    : items.map((i) => {
        const bajo = Number(i.existencia) <= Number(i.minimo);
        return `<div class="item" onclick="formMovimiento(${i.id})">
          <div class="m"><b>${esc(i.descripcion)}</b><span>${esc(i.clave)} · mínimo ${Number(i.minimo)} ${esc(i.unidad)}</span></div>
          <div class="r"><b>${Number(i.existencia)}</b>
          <span class="badge ${bajo ? "b-bajo" : "b-ok"}">${bajo ? "Bajo" : "OK"}</span></div>
        </div>`;
      }).join("");
  try {
    const { movimientos } = await api("inventario/movimientos");
    $("#listaMov").innerHTML = !movimientos.length
      ? '<div class="vacio">Sin movimientos registrados.</div>'
      : movimientos.slice(0, 25).map((m) => `
        <div class="item" style="cursor:default">
          <div class="m"><b>${esc(m.clave)} · ${m.tipo === "entrada" ? "Entrada" : m.tipo === "salida" ? "Salida" : "Ajuste"}</b>
          <span>${fecha(m.fecha)}${m.cliente ? " · " + esc(m.cliente) : ""}${m.fecha_entrega ? " · entrega " + fecha(m.fecha_entrega) : ""}${m.motivo ? " · " + esc(m.motivo) : ""}</span></div>
          <div class="r"><b style="color:${m.tipo === "salida" ? "var(--bad)" : "var(--ok)"}">
            ${m.tipo === "salida" ? "−" : "+"}${Number(m.cantidad)}</b>
          <span style="font-size:11px;color:var(--slate)">saldo ${Number(m.saldo)}</span></div>
        </div>`).join("");
  } catch { $("#listaMov").innerHTML = ""; }
}

function formMovimiento(id) {
  const i = S.catalogo.find((x) => x.id === id);
  abrirModal("Movimiento de inventario", `
    <p style="font-size:13px;color:var(--slate);margin-bottom:14px">
      <b style="color:var(--ink)">${esc(i.descripcion)}</b><br>
      ${esc(i.clave)} · existencia actual <b style="color:var(--ink)">${Number(i.existencia)} ${esc(i.unidad)}</b></p>
    <form id="fMov">
      <label class="f"><span>Tipo</span><select name="tipo">
        <option value="entrada">Entrada (compra o devolución)</option>
        <option value="salida">Salida (obra o venta)</option>
        <option value="ajuste">Ajuste (fijar existencia real)</option>
      </select></label>
      <label class="f"><span>Cantidad</span><input name="cantidad" type="number" min="0.01" step="0.01" required></label>
      <label class="f"><span>Cliente o empresa (para salidas)</span>
        <select name="cliente_id"><option value="">— No aplica —</option>
        ${S.clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</select></label>
      <label class="f"><span>Fecha de entrega</span><input name="fecha_entrega" type="date"></label>
      <label class="f"><span>Motivo o referencia</span><input name="motivo" placeholder="Obra Casa Rubio, compra a proveedor…"></label>
      <button class="btn pri full" type="submit">Registrar</button>
    </form>`);
  $("#fMov").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    try {
      await api("inventario/movimiento", { method: "POST", body: { item_id: id, ...d } });
      cerrarModal(); verInventario();
    } catch (x) { aviso("#modalError", x.message); }
  });
}

/* ---------------- más ---------------- */
function verMas() {
  $("#masContenido").innerHTML = `
    <div class="card">
      <h3>Mi cuenta</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        ${esc(S.yo.nombre)} · ${esc(S.yo.correo)}<br>Perfil: ${esDueno() ? "Administrador general" : "Vendedor"}<br>
        <span style="font-size:11.5px">Versión ${VERSION}</span></p>
      <div class="acciones">
        <button class="btn sec sm" onclick="formCorreo()">Cambiar correo</button>
        <button class="btn sec sm" onclick="formPassword()">Cambiar contraseña</button>
      </div>
    </div>
    ${esDueno() ? `
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
      <h3>Vendedores</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Da de alta al equipo y controla quién tiene acceso.</p>
      <button class="btn pri sm" onclick="verUsuarios()">Administrar vendedores</button>
    </div>` : ""}
    <div class="card">
      <h3>Datos de ejemplo</h3>
      <p style="font-size:13px;color:var(--slate);margin-bottom:12px">
        Carga clientes, cotizaciones y movimientos ficticios para ver cómo se ve la app trabajando
        o para entrenar a un vendedor. Se borran cuando quieras, sin tocar tu información real.</p>
      <div class="acciones">
        <button class="btn pri sm" onclick="datosEjemplo('cargar')">Cargar ejemplos</button>
        <button class="btn dan sm" onclick="datosEjemplo('borrar')">Borrar ejemplos</button>
      </div>
    </div>
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
      await api("cambiar-password", { method: "POST", body: Object.fromEntries(new FormData(ev.target)) });
      cerrarModal(); alert("Contraseña actualizada.");
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
    abrirModal("Vendedores", `
      <button class="btn pri sm" style="margin-bottom:12px" onclick="formUsuario()">+ Nuevo vendedor</button>
      ${usuarios.map((u) => `
        <div class="item" onclick="formUsuario(${u.id})">
          <div class="m"><b>${esc(u.nombre)}</b>
          <span>${esc(u.correo)} · ${u.rol === "owner" ? "Administrador" : "Vendedor"}</span></div>
          <div class="r"><b>${u.cotizaciones}</b>
          <span class="badge ${u.activo ? "b-ok" : "b-bajo"}">${u.activo ? "Activo" : "Inactivo"}</span></div>
        </div>`).join("")}`);
    window._usuarios = usuarios;
  } catch (e) { alert(e.message); }
}

function formUsuario(id = null) {
  const u = id ? (window._usuarios || []).find((x) => x.id === id) || {} : {};
  abrirModal(id ? "Editar vendedor" : "Nuevo vendedor", `
    <form id="fUsr">
      <label class="f"><span>Nombre *</span><input name="nombre" required value="${esc(u.nombre || "")}"></label>
      <label class="f"><span>Correo *</span>
        <input name="correo" type="email" ${id ? "" : "required"} value="${esc(u.correo || "")}"></label>
      <label class="f"><span>Teléfono</span><input name="telefono" value="${esc(u.telefono || "")}"></label>
      <label class="f"><span>${id ? "Nueva contraseña (opcional)" : "Contraseña * (mínimo 8)"}</span>
        <input name="password" type="password" ${id ? "" : "required minlength=8"}></label>
      ${id ? `<label class="f"><span>Estado</span><select name="activo">
        <option value="true" ${u.activo ? "selected" : ""}>Activo</option>
        <option value="false" ${u.activo ? "" : "selected"}>Inactivo (sin acceso)</option></select></label>` : ""}
      <button class="btn pri full" type="submit">Guardar</button>
    </form>
    ${id && id !== S.yo.id ? `<div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)">
      <button class="btn dan full" onclick="eliminarUsuario(${id})">Eliminar vendedor</button>
      <p style="font-size:11.5px;color:var(--slate);margin-top:8px">
        Si solo quieres quitarle el acceso sin borrar nada, ponlo como Inactivo arriba.</p>
    </div>` : ""}`);
  $("#fUsr").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(ev.target));
    if (!d.password) delete d.password;
    if ("activo" in d) d.activo = d.activo === "true";
    try {
      if (id) await api("usuarios", { method: "PATCH", body: { id, ...d } });
      else await api("usuarios", { method: "POST", body: d });
      verUsuarios();
    } catch (x) { aviso("#modalError", x.message); }
  });
}


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
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") cerrarModal(); });

/* ---------------- exponer al HTML ---------------- */
Object.assign(window, {
  ir, abrirCotizacion, nuevaCotizacion, agregarPartida, guardarCotizacion,
  borrarCotizacion, imprimirCotizacion, formCliente, formMovimiento,
  formPassword, verCatalogo, formConcepto, verUsuarios, formUsuario, cerrarModal,
  formRapido, verSeguimiento, datosEjemplo, formCorreo, eliminarUsuario, confirmarEliminar,
  buscarActualizacion, formTarifas,
});

/* ---------------- service worker ---------------- */
if ("serviceWorker" in navigator)
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

arrancar();
