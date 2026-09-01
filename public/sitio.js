/* =========================================================================
   Vista previa del proyecto sobre la foto del techo
   =========================================================================
   Dibuja los módulos sobre la fotografía del techo, en perspectiva.
   La foto puede ser de dron o una imagen de satélite tomada de Google Maps
   (sitio.fuente = "dron" | "satelite"); con satélite se respeta la franja
   inferior donde Google imprime su crédito y se vuelve a escribir encima.

   Tres reglas que no se rompen:
     1. La foto del cliente NO se altera. Sólo se dibuja encima.
     2. El número de módulos es el de la cotización, no el que se vea bonito.
     3. Los kWp y los kWh salen de la misma fórmula que el PDF, para que la
        imagen y la propuesta nunca se contradigan.
   ========================================================================= */

/* La misma constante que usa el resto de la app: 4.48 kWh por kWp al día. */
const KWH_KWP_DIA = 4.48;

/* ---------- matriz que lleva el plano del techo (metros) a la foto ---------- */
function homografia(origen, destino) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = origen[i], [u, v] = destino[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  /* Gauss con pivoteo: son 8 incógnitas, no hace falta nada más pesado. */
  const M = A.map((f, i) => [...f, b[i]]);
  for (let c = 0; c < 8; c++) {
    let mejor = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[mejor][c])) mejor = r;
    if (Math.abs(M[mejor][c]) < 1e-12) return null;      // puntos degenerados
    [M[c], M[mejor]] = [M[mejor], M[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= 8; k++) M[r][k] -= f * M[c][k];
    }
  }
  const h = M.map((f, i) => f[8] / f[i]);
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

const proyectar = (H, x, y) => {
  const w = H[2][0] * x + H[2][1] * y + 1;
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w,
          (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
};

/* ---------- cuántos módulos caben, y en qué acomodo ----------
   Devuelve el mejor acomodo que no pase del número de paneles cotizados. */
function acomodo(anchoM, fondoM, cuantos, panelAncho = 2.28, panelAlto = 1.13, margen = 0.6, sep = 0.03) {
  const util = (t, m) => Math.max(t - 2 * margen, 0);
  const cabenEn = (largo, medida) => Math.max(Math.floor((largo + sep) / (medida + sep)), 0);
  const opciones = [
    { columnas: cabenEn(util(anchoM), panelAncho), filas: cabenEn(util(fondoM), panelAlto), giro: false },
    { columnas: cabenEn(util(anchoM), panelAlto), filas: cabenEn(util(fondoM), panelAncho), giro: true },
  ];
  let mejor = { filas: 0, columnas: 0, giro: false, caben: 0 };
  for (const o of opciones) {
    const caben = o.filas * o.columnas;
    if (caben > mejor.caben) mejor = { ...o, caben };
  }
  if (!mejor.caben) return { filas: 0, columnas: 0, giro: false, caben: 0, dibujados: 0 };

  /* Si caben más de los cotizados, se recorta el arreglo a lo que se vende. */
  let filas = mejor.filas, columnas = mejor.columnas;
  if (cuantos > 0 && cuantos < filas * columnas) {
    columnas = Math.min(columnas, Math.ceil(cuantos / 1));
    filas = Math.ceil(cuantos / columnas);
    while (filas > mejor.filas) { columnas++; filas = Math.ceil(cuantos / columnas); }
    if (columnas > mejor.columnas) { columnas = mejor.columnas; filas = Math.ceil(cuantos / columnas); }
  }
  const dibujados = cuantos > 0 ? Math.min(cuantos, filas * columnas) : filas * columnas;
  return { filas, columnas, giro: mejor.giro, caben: mejor.caben, dibujados };
}

/* ---------- las áreas ----------
   Un techo a dos aguas, o una nave más su patio, son dos superficies planas
   distintas dentro de la misma foto. Cada una se marca por separado.
   Antes se guardaba una sola área suelta; esto lee las dos formas. */
const TOPE_AREAS = 4;

function areasDe(sitio) {
  if (!sitio) return [];
  if (Array.isArray(sitio.areas) && sitio.areas.length) return sitio.areas;
  if (Array.isArray(sitio.esquinas) && sitio.esquinas.length === 4)
    return [{
      esquinas: sitio.esquinas, ancho_m: sitio.ancho_m, fondo_m: sitio.fondo_m,
      filas: sitio.filas, columnas: sitio.columnas, giro: sitio.giro, paneles: 0,
    }];
  return [];
}

/* Cómo se reparten los módulos cotizados entre las áreas.
   Primero se respetan los que el vendedor fijó a mano; el resto se va llenando
   en orden, sin pasar nunca del total cotizado ni de lo que cabe en cada una. */
function repartir(areas, cotizados) {
  const cap = areas.map((a) => acomodo(Number(a.ancho_m) || 0, Number(a.fondo_m) || 0, 0).caben);
  const asignado = areas.map(() => 0);
  const aMano = areas.map((a) => Number(a.paneles) > 0);
  let quedan = cotizados > 0 ? cotizados : cap.reduce((s, c) => s + c, 0);

  areas.forEach((a, i) => {
    if (!aMano[i]) return;
    const n = Math.max(Math.min(Number(a.paneles), cap[i], quedan), 0);
    asignado[i] = n; quedan -= n;
  });
  areas.forEach((a, i) => {
    if (aMano[i]) return;
    const n = Math.max(Math.min(cap[i], quedan), 0);
    asignado[i] = n; quedan -= n;
  });
  return {
    asignado, cap,
    caben: cap.reduce((s, c) => s + c, 0),
    total: asignado.reduce((s, n) => s + n, 0),
  };
}

/* ---------- el dibujo ---------- */
function dibujarModulos(ctx, H, sitio, cuantos) {
  const { ancho_m: A, fondo_m: F, filas, columnas, giro } = sitio;
  const margen = 0.6, sep = 0.03;
  const pa = giro ? 1.13 : 2.28, pl = giro ? 2.28 : 1.13;
  const px = Math.min((A - 2 * margen - (columnas - 1) * sep) / columnas, pa);
  const py = Math.min((F - 2 * margen - (filas - 1) * sep) / filas, pl);
  if (!(px > 0) || !(py > 0)) return 0;
  const x0 = (A - (columnas * px + (columnas - 1) * sep)) / 2;
  const y0 = (F - (filas * py + (filas - 1) * sep)) / 2;

  let n = 0;
  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < columnas; c++) {
      if (cuantos > 0 && n >= cuantos) break;
      const ax = x0 + c * (px + sep), ay = y0 + f * (py + sep);
      const q = [proyectar(H, ax, ay), proyectar(H, ax + px, ay),
                 proyectar(H, ax + px, ay + py), proyectar(H, ax, ay + py)];

      ctx.beginPath();
      ctx.moveTo(q[0][0] + 3, q[0][1] + 4);
      for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0] + 3, q[i][1] + 4);
      ctx.closePath();
      ctx.fillStyle = "rgba(0,0,0,.30)";
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(q[0][0], q[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]);
      ctx.closePath();
      ctx.fillStyle = "rgba(20,33,60,.91)";
      ctx.fill();
      ctx.strokeStyle = "rgba(158,172,196,.95)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.strokeStyle = "rgba(96,114,146,.75)";
      for (const t of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(q[0][0] + (q[3][0] - q[0][0]) * t, q[0][1] + (q[3][1] - q[0][1]) * t);
        ctx.lineTo(q[1][0] + (q[2][0] - q[1][0]) * t, q[1][1] + (q[2][1] - q[1][1]) * t);
        ctx.stroke();
      }
      n++;
    }
  }
  return n;
}

/* ---------- rótulos ---------- */
function cajaRedonda(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function iconito(ctx, x, y, cual, color) {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2;
  if (cual === "panel") {
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 22); ctx.lineTo(x + 25, y + 22);
    ctx.lineTo(x + 21, y + 8); ctx.lineTo(x + 5, y + 8);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x + 3, y + 15); ctx.lineTo(x + 23, y + 15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 13, y + 8); ctx.lineTo(x + 13, y + 22); ctx.stroke();
  } else if (cual === "rayo") {
    ctx.beginPath();
    ctx.moveTo(x + 16, y - 10); ctx.lineTo(x + 4, y + 10); ctx.lineTo(x + 13, y + 10);
    ctx.lineTo(x + 9, y + 24); ctx.lineTo(x + 24, y + 4); ctx.lineTo(x + 15, y + 4);
    ctx.closePath(); ctx.fill();
  } else if (cual === "barras") {
    [8, 15, 22].forEach((h, i) => ctx.fillRect(x + 2 + i * 9, y + 22 - h, 6, h));
  } else if (cual === "hoja") {
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 20);
    ctx.quadraticCurveTo(x + 2, y - 6, x + 24, y - 8);
    ctx.quadraticCurveTo(x + 26, y + 16, x + 2, y + 20);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

const miles = (n) => Math.round(n).toLocaleString("es-MX");

async function pintarRotulos(ctx, W, A, datos) {
  const AZUL = "#0A2A5E";
  const esc = A / 900;                       // el diseño se hizo para 1600×900
  const F = (t, negrita) => `${negrita ? "700 " : ""}${Math.round(t * esc)}px ` +
    `system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;

  /* rótulo de arriba a la izquierda */
  ctx.fillStyle = "rgba(10,42,94,.93)";
  cajaRedonda(ctx, -30 * esc, -30 * esc, W * 0.275 + 30 * esc, A * 0.155 + 30 * esc, 18 * esc);
  ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = F(47, true); ctx.textBaseline = "top";
  ctx.fillText("VISTA PREVIA", 26 * esc, 22 * esc);
  ctx.fillStyle = "#BAD0EC"; ctx.font = F(23);
  ctx.fillText(`${datos.paneles} PANELES DE ${datos.wpanel} W`, 28 * esc, 80 * esc);

  /* logo arriba a la derecha */
  if (datos.logo) {
    const alto = A * 0.125, ancho = alto * (datos.logo.width / datos.logo.height);
    const cw = ancho + 34 * esc, ch = alto + 20 * esc, cx = W - cw - 14 * esc, cy = 12 * esc;
    ctx.fillStyle = "rgba(255,255,255,.93)";
    cajaRedonda(ctx, cx, cy, cw, ch, 14 * esc); ctx.fill();
    ctx.drawImage(datos.logo, cx + 17 * esc, cy + 10 * esc, ancho, alto);
  }

  /* barra de datos abajo */
  const filas = [
    ["panel", `${datos.paneles} PANELES`, `DE ${datos.wpanel} W`],
    ["rayo", "POTENCIA TOTAL", `${datos.kwp.toFixed(2)} kWp`],
    ["barras", "ENERGÍA APROX.", `${miles(datos.kwh)} kWh/año*`],
    ["hoja", "ENERGÍA LIMPIA", "y ahorro comprobable"],
  ];
  /* Con una imagen de Google Maps, toda la franja de abajo se deja libre:
     ahí es donde Google imprime su logotipo y el crédito de la imagen, y
     taparlo no está permitido. La barra de datos sube para no invadirla. */
  const alza = datos.satelite ? A * 0.075 : 0;
  const bh = A * 0.075, bx = W * 0.435, by = A - bh - A * 0.055 - alza;
  ctx.fillStyle = "rgba(255,255,255,.94)";
  cajaRedonda(ctx, bx, by, W - 20 * esc - bx, bh, 14 * esc); ctx.fill();
  const col = (W - 20 * esc - bx) / filas.length;
  filas.forEach(([ic, l1, l2], i) => {
    const x = bx + i * col + 16 * esc;
    ctx.save(); ctx.translate(x, by + bh * 0.42); ctx.scale(esc, esc);
    iconito(ctx, 0, 0, ic, AZUL); ctx.restore();
    ctx.fillStyle = AZUL; ctx.font = F(19, true);
    ctx.fillText(l1, x + 36 * esc, by + bh * 0.20);
    ctx.fillStyle = "#5A6B85"; ctx.font = F(16);
    ctx.fillText(l2, x + 36 * esc, by + bh * 0.55);
    if (i) {
      ctx.strokeStyle = "#D6DEE9"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - 12 * esc, by + 12 * esc);
      ctx.lineTo(x - 12 * esc, by + bh - 12 * esc); ctx.stroke();
    }
  });

  /* la nota al pie va SIEMPRE: la imagen es de referencia, no un plano */
  const nota = "*Estimado sujeto a la visita técnica; la distribución final puede cambiar.";
  ctx.font = F(14);
  const an = ctx.measureText(nota).width;
  ctx.fillStyle = "rgba(10,42,94,.66)";
  cajaRedonda(ctx, W - 22 * esc - an - 10 * esc, by + bh + 5 * esc, an + 18 * esc, 24 * esc, 7 * esc);
  ctx.fill();
  ctx.fillStyle = "#E2EAF6";
  ctx.fillText(nota, W - 22 * esc - an, by + bh + 9 * esc);

  /* El crédito a Google se vuelve a escribir sobre el montaje, pegado a la
     imagen y no en un pie de página, como piden sus lineamientos. */
  if (datos.satelite) {
    const cr = "Imagen de satélite © Google";
    ctx.font = F(15, true);
    const ac = ctx.measureText(cr).width;
    const cy = by + bh + 37 * esc;
    ctx.fillStyle = "rgba(0,0,0,.52)";
    cajaRedonda(ctx, W - 22 * esc - ac - 10 * esc, cy - 4 * esc, ac + 18 * esc, 25 * esc, 7 * esc);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(cr, W - 22 * esc - ac, cy);
  }
}

/* La etiqueta con el número de módulos de cada área, cuando hay más de una. */
function pintarEtiquetaArea(ctx, puntos, texto, esc) {
  const cx = puntos.reduce((s, p) => s + p[0], 0) / 4;
  const cy = puntos.reduce((s, p) => s + p[1], 0) / 4;
  ctx.font = `700 ${Math.round(21 * esc)}px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;
  ctx.textBaseline = "top";
  const an = ctx.measureText(texto).width;
  const w = an + 26 * esc, h = 32 * esc;
  ctx.fillStyle = "rgba(10,42,94,.86)";
  cajaRedonda(ctx, cx - w / 2, cy - h / 2, w, h, 9 * esc); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = Math.max(1, 1.5 * esc); ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillText(texto, cx - an / 2, cy - h / 2 + 7 * esc);
}

/* ---------- lo que usa el resto de la app ----------
   foto: data:image
   sitio: {fuente, ancho_foto, alto_foto, areas:[{esquinas, ancho_m, fondo_m, paneles}]}
          (también se acepta la forma vieja, de una sola área suelta)
   tecnico: el de la cotización (paneles y wpanel)                        */
async function generarVistaSitio(foto, sitio, tecnico, logoUrl) {
  const img = await cargarImagen(foto);
  const lienzo = document.createElement("canvas");
  lienzo.width = img.naturalWidth || img.width;
  lienzo.height = img.naturalHeight || img.height;
  const ctx = lienzo.getContext("2d");
  ctx.drawImage(img, 0, 0);

  /* las esquinas se guardaron sobre el tamaño de la foto original */
  const escX = lienzo.width / (sitio.ancho_foto || lienzo.width);
  const escY = lienzo.height / (sitio.alto_foto || lienzo.height);
  const areas = areasDe(sitio);
  if (!areas.length) throw new Error("Marca las cuatro esquinas del techo.");

  const paneles = Number(tecnico?.paneles) || 0;
  const wpanel = Number(tecnico?.wpanel) || 0;
  const rep = repartir(areas, paneles);

  const esc = lienzo.height / 900;
  let dibujados = 0, validas = 0;
  const etiquetas = [];
  areas.forEach((area, i) => {
    const destino = (area.esquinas || []).map(([x, y]) => [x * escX, y * escY]);
    if (destino.length !== 4) return;
    const A = Number(area.ancho_m) || 0, F = Number(area.fondo_m) || 0;
    if (!(A > 0 && F > 0)) return;
    const H = homografia([[0, 0], [A, 0], [A, F], [0, F]], destino);
    if (!H) return;
    validas++;
    /* Un área a la que no le tocó ningún módulo se queda vacía. Sin esto,
       dibujarModulos entendería el cero como «sin límite» y la llenaría. */
    if (!rep.asignado[i]) return;
    const ac = acomodo(A, F, rep.asignado[i]);
    const n = dibujarModulos(ctx, H, { ...area, ancho_m: A, fondo_m: F, ...ac }, rep.asignado[i]);
    dibujados += n;
    if (n) etiquetas.push({ puntos: destino, texto: `${n} módulos` });
  });
  if (!validas) throw new Error("Las cuatro esquinas del techo no forman una figura válida.");
  if (etiquetas.length > 1) etiquetas.forEach((e) => pintarEtiquetaArea(ctx, e.puntos, e.texto, esc));

  let logo = null;
  if (logoUrl) { try { logo = await cargarImagen(logoUrl); } catch { logo = null; } }
  await pintarRotulos(ctx, lienzo.width, lienzo.height, {
    paneles: dibujados, wpanel,
    kwp: dibujados * wpanel / 1000,
    kwh: (dibujados * wpanel / 1000) * KWH_KWP_DIA * 365,
    logo,
    satelite: sitio.fuente === "satelite",
  });
  return {
    url: lienzo.toDataURL("image/jpeg", 0.9), dibujados, cotizados: paneles,
    areas: areas.length, porArea: rep.asignado.slice(),
  };
}

function cargarImagen(src) {
  return new Promise((ok, mal) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => mal(new Error("No se pudo leer la imagen."));
    i.src = src;
  });
}

window.MCSitio = {
  generarVistaSitio, acomodo, homografia, proyectar,
  areasDe, repartir, KWH_KWP_DIA, TOPE_AREAS,
};
