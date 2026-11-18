"use strict";
// ============================================================
// EDITOR VISUAL — mapeo de ediciones del Navegador a la fuente
// (función pedida por Luis, estilo Lovable: doble clic sobre
// un texto en la vista previa y el cambio se guarda solo en
// el archivo del proyecto).
//
// Este módulo es PURO (solo fs/path): el proceso principal lo
// expone por IPC y las baterías lo prueban sin Electron.
//
// Reglas de honestidad del mapeo:
//  - Texto: se busca el texto literal en los archivos de
//    plantillas/marcado del proyecto (con una segunda pasada
//    tolerante a espacios/saltos). Si no aparece, NO se finge
//    el guardado: se devuelve ok:false (ese texto se genera
//    desde datos o desde código, no vive en una plantilla).
//  - Foto: se reemplaza el valor literal del src en la fuente.
//  - Color: se localiza la etiqueta del elemento por su texto
//    (o por su id) y se le pone/actualiza el style en línea.
//    Si la etiqueta no se localiza, ok:false.
// ============================================================
const fs = require("fs");
const path = require("path");

const EXTS_FUENTE = new Set([".html", ".htm", ".jsx", ".tsx", ".ts", ".js", ".json", ".vue", ".svelte", ".php", ".erb", ".hbs", ".ejs"]);
const DIRS_FUERA = new Set(["node_modules", ".git", "dist", "build", ".next", ".editcore", "vendor", "__pycache__"]);
const MAX_ARCHIVOS = 800;
const MAX_BYTES_ARCHIVO = 4 * 1024 * 1024;

function listarFuentes(root) {
  const salida = [];
  const pila = [root];
  while (pila.length && salida.length < MAX_ARCHIVOS) {
    const dir = pila.pop();
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entradas) {
      const completa = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!DIRS_FUERA.has(e.name)) pila.push(completa);
      } else if (e.isFile() && EXTS_FUENTE.has(path.extname(e.name).toLowerCase())) {
        salida.push(completa);
      }
    }
  }
  return salida.sort();
}

function leerSiCabe(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > MAX_BYTES_ARCHIVO) return null;
    return fs.readFileSync(file, "utf8");
  } catch { return null; }
}

function escaparRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Busca un patrón en las fuentes y devuelve la primera
// coincidencia cuya longitud no exceda lo buscado + topeExtra
// (la guarda evita que un separador «pegamento» cruce media
// página y el reemplazo se lleve texto ajeno por delante).
function buscarPatron(fuentes, patron, buscado, topeExtra) {
  const global = new RegExp(patron.source, "gi");
  for (const file of fuentes) {
    const contenido = leerSiCabe(file);
    if (contenido == null) continue;
    global.lastIndex = 0;
    let m;
    while ((m = global.exec(contenido)) !== null) {
      if (m[0].length <= buscado.length + topeExtra) {
        return { file, contenido, indice: m.index, longitud: m[0].length, texto: m[0] };
      }
      if (m[0].length === 0) global.lastIndex++;
    }
  }
  return null;
}

// Localiza `texto` en las fuentes: primero literal; si no,
// tolerante a espacios (el HTML renderizado colapsa saltos y
// sangrías que en la fuente sí existen); después, tolerante al
// «pegamento» JSX/HTML que puede vivir ENTRE las palabras en la
// fuente aunque el navegador lo pinte como un solo texto:
// expresiones {" "}, entidades &nbsp; y, como último recurso,
// etiquetas (el texto partido en dos <span> o con un <br/>).
// Devuelve { file, contenido, indice, longitud } o null.
function localizarTexto(root, texto) {
  const buscado = String(texto || "").trim();
  if (!buscado) return null;
  const fuentes = listarFuentes(root);
  const buscadoMin = buscado.toLowerCase();
  for (const file of fuentes) {
    const contenido = leerSiCabe(file);
    if (contenido == null) continue;
    const i = contenido.toLowerCase().indexOf(buscadoMin);
    if (i >= 0) return { file, contenido, indice: i, longitud: buscado.length, texto: contenido.slice(i, i + buscado.length) };
  }
  const porEspacios = buscarPatron(fuentes,
    new RegExp(escaparRegex(buscado).replace(/\s+/g, "\\s+")), buscado, 200);
  if (porEspacios) return porEspacios;
  const palabras = buscado.split(/\s+/).filter(Boolean);
  if (palabras.length > 1) {
    const sepSuave = "(?:\\s|&nbsp;|\\{\\s*[\"']\\s*[\"']\\s*\\})+";
    const porPegamento = buscarPatron(fuentes,
      new RegExp(palabras.map(escaparRegex).join(sepSuave)), buscado, 120);
    if (porPegamento) return porPegamento;
    const sepFuerte = "(?:\\s|&nbsp;|\\{\\s*[\"']\\s*[\"']\\s*\\}|<[^>]+>)+";
    // Las etiquetas también viven DENTRO de la palabra renderizada:
    // «transmisión <strong>DCT/DSG</strong>, aceites» se pinta
    // «transmisión DCT/DSG, aceites» — la coma queda tras la
    // etiqueta de cierre. Por eso cada palabra admite pegamento
    // opcional entre su núcleo y su puntuación final (y entre la
    // puntuación inicial y el núcleo).
    const palabraFuerte = (w) => {
      const m = /^(.*?)([\p{L}\p{N}][\p{L}\p{N}/._-]*)([^\p{L}\p{N}]*)$/u.exec(w);
      if (!m) return escaparRegex(w);
      const [, pre, nucleo, post] = m;
      return (pre ? escaparRegex(pre) + `(?:${sepFuerte})?` : "")
        + escaparRegex(nucleo)
        + (post ? `(?:${sepFuerte})?` + escaparRegex(post) : "");
    };
    const porEtiquetas = buscarPatron(fuentes,
      new RegExp(palabras.map(palabraFuerte).join(sepFuerte)), buscado, 120);
    if (porEtiquetas) return porEtiquetas;
  }
  return localizarPorEsqueleto(fuentes, buscado);
}

// Último recurso, el general: se construye el «esqueleto» de
// cada fuente — el texto que el navegador realmente pinta:
// sin etiquetas, con los espacios colapsados y las entidades
// &nbsp; / &amp; resueltas — guardando el mapa de cada
// posición del esqueleto a su posición en la fuente. Si el
// texto buscado (normalizado igual) aparece en el esqueleto,
// el tramo fuente correspondiente es el que se reemplaza.
// Así ninguna disposición de etiquetas o de saltos de línea
// en la fuente puede esconder un texto que sí se está viendo.
function localizarPorEsqueleto(fuentes, buscado) {
  const buscadoNorm = String(buscado).replace(/\s+/g, " ").trim().toLowerCase();
  if (!buscadoNorm) return null;
  for (const file of fuentes) {
    const contenido = leerSiCabe(file);
    if (contenido == null) continue;
    let esqueleto = "";
    const mapa = [];
    let enEtiqueta = false;
    let espacioPendiente = -1;
    for (let i = 0; i < contenido.length; i++) {
      const ch = contenido[i];
      if (enEtiqueta) { if (ch === ">") enEtiqueta = false; continue; }
      if (ch === "<") { enEtiqueta = true; continue; }
      if (ch === "&" && contenido.startsWith("&nbsp;", i)) {
        if (esqueleto && !esqueleto.endsWith(" ") && espacioPendiente < 0) espacioPendiente = i;
        i += 5;
        continue;
      }
      if (ch === "&" && contenido.startsWith("&amp;", i)) {
        if (espacioPendiente >= 0) { esqueleto += " "; mapa.push(espacioPendiente); espacioPendiente = -1; }
        esqueleto += "&";
        mapa.push(i);
        i += 4;
        continue;
      }
      if (/\s/.test(ch)) {
        if (esqueleto && !esqueleto.endsWith(" ") && espacioPendiente < 0) espacioPendiente = i;
        continue;
      }
      if (espacioPendiente >= 0) { esqueleto += " "; mapa.push(espacioPendiente); espacioPendiente = -1; }
      esqueleto += ch.toLowerCase();
      mapa.push(i);
    }
    const j = esqueleto.indexOf(buscadoNorm);
    if (j < 0) continue;
    const ini = mapa[j];
    const fin = mapa[j + buscadoNorm.length - 1] + 1;
    if (fin - ini > buscado.length + 400) continue;
    return { file, contenido, indice: ini, longitud: fin - ini, texto: contenido.slice(ini, fin) };
  }
  return null;
}

function relativo(root, file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

// La página puede MOSTRAR el texto en otro caso que el de la
// fuente (CSS text-transform: uppercase es lo habitual en los
// titulares): el editor captura el texto renderizado
// («SIN SORPRESAS») y la fuente guarda «sin sorpresas». Por eso
// la búsqueda es insensible a mayúsculas y el reemplazo se
// escribe con el patrón de caso DEL ORIGINAL, para no
// endurecer en la fuente un caso que solo era presentación.
function ajustarCasoAlOriginal(original, nuevo) {
  const letras = String(original || "").replace(/[^\p{L}]/gu, "");
  if (!letras) return nuevo;
  if (letras === letras.toLowerCase()) return String(nuevo).toLowerCase();
  if (letras === letras.toUpperCase()) return String(nuevo).toUpperCase();
  const primera = letras.charAt(0);
  const resto = letras.slice(1);
  if (primera === primera.toUpperCase() && resto === resto.toLowerCase()) {
    const n = String(nuevo);
    return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
  }
  return nuevo;
}

function reemplazarTexto(root, anterior, nuevo) {
  const ant = String(anterior || "").trim();
  const nue = String(nuevo || "").trim();
  if (!ant || ant === nue) return { ok: false, error: "Sin cambio de texto." };
  const hit = localizarTexto(root, ant);
  if (!hit) {
    return { ok: false, error: "Ese texto no vive en una plantilla del proyecto (se genera desde datos o código); no lo guardé en ningún archivo." };
  }
  const nueAjustado = ajustarCasoAlOriginal(hit.texto != null ? hit.texto : ant, nue);
  const actualizado = hit.contenido.slice(0, hit.indice) + nueAjustado + hit.contenido.slice(hit.indice + hit.longitud);
  fs.writeFileSync(hit.file, actualizado, "utf8");
  return { ok: true, archivo: relativo(root, hit.file), tipo: "texto" };
}

function reemplazarFoto(root, anterior, nuevo) {
  const ant = String(anterior || "").trim();
  const nue = String(nuevo || "").trim();
  if (!ant || !nue || ant === nue) return { ok: false, error: "Sin cambio de foto." };
  const hit = localizarTexto(root, ant);
  if (!hit) {
    return { ok: false, error: "La ruta de esa foto no aparece en las plantillas del proyecto; no la guardé." };
  }
  const actualizado = hit.contenido.slice(0, hit.indice) + nue + hit.contenido.slice(hit.indice + hit.longitud);
  fs.writeFileSync(hit.file, actualizado, "utf8");
  return { ok: true, archivo: relativo(root, hit.file), tipo: "foto" };
}

// Aplica un color (propiedad CSS color|background-color) como
// style en línea sobre la etiqueta del elemento. El ancla es
// el texto del elemento o su id (#selector).
function aplicarColor(root, { texto = "", idElemento = "", propiedad = "", valor = "" } = {}) {
  const prop = propiedad === "background-color" ? "background-color" : "color";
  const val = String(valor || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(val) && !/^[a-zA-Z]+$/.test(val)) {
    return { ok: false, error: "Color no válido." };
  }
  let hit = texto ? localizarTexto(root, texto) : null;
  let indiceTexto = hit ? hit.indice : -1;
  if (!hit && idElemento) {
    const id = String(idElemento).replace(/^#/, "").trim();
    if (id) hit = localizarTexto(root, `id="${id}"`), indiceTexto = hit ? hit.indice : -1;
    if (!hit && id) {
      const h2 = localizarTexto(root, `id='${id}'`);
      if (h2) { hit = h2; indiceTexto = h2.indice; }
    }
  }
  if (!hit) {
    return { ok: false, error: "No localicé la etiqueta de ese elemento en las plantillas; el color no se guardó en el archivo." };
  }
  const contenido = hit.contenido;
  // La etiqueta del elemento: si el ancla es el texto, es la
  // última etiqueta abierta antes de él; si el ancla es el id,
  // es la etiqueta que lo contiene. En ambos casos: el último
  // "<" hasta el ancla y el primer ">" desde ahí.
  const apertura = contenido.lastIndexOf("<", indiceTexto);
  if (apertura < 0) {
    return { ok: false, error: "No localicé la etiqueta de ese elemento en las plantillas; el color no se guardó en el archivo." };
  }
  const finEtiqueta = contenido.indexOf(">", apertura);
  if (finEtiqueta < 0) return { ok: false, error: "Etiqueta incompleta en la fuente." };
  const etiqueta = contenido.slice(apertura, finEtiqueta);
  if (/^<\//.test(etiqueta) || /^<!/.test(etiqueta)) {
    return { ok: false, error: "No localicé la etiqueta de ese elemento en las plantillas; el color no se guardó en el archivo." };
  }
  const mStyle = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(etiqueta);
  let nuevaEtiqueta;
  if (mStyle) {
    const previo = (mStyle[1] ?? mStyle[2] ?? "").trim();
    const sinProp = previo
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d && !new RegExp(`^${prop}\\s*:`, "i").test(d))
      .join("; ");
    const nuevoStyle = (sinProp ? sinProp + "; " : "") + `${prop}: ${val}`;
    nuevaEtiqueta = etiqueta.replace(mStyle[0], `style="${nuevoStyle}"`);
  } else {
    nuevaEtiqueta = etiqueta + ` style="${prop}: ${val}"`;
  }
  const actualizado = contenido.slice(0, apertura) + nuevaEtiqueta + contenido.slice(finEtiqueta);
  fs.writeFileSync(hit.file, actualizado, "utf8");
  return { ok: true, archivo: relativo(root, hit.file), tipo: "color" };
}

function aplicarEdicionVisual(root, edicion = {}) {
  const tipo = String(edicion.tipo || "");
  if (tipo === "texto") return reemplazarTexto(root, edicion.anterior, edicion.nuevo);
  if (tipo === "foto") return reemplazarFoto(root, edicion.anterior, edicion.nuevo);
  if (tipo === "color-texto") return aplicarColor(root, { texto: edicion.texto, idElemento: edicion.idElemento, propiedad: "color", valor: edicion.valor });
  if (tipo === "color-fondo") return aplicarColor(root, { texto: edicion.texto, idElemento: edicion.idElemento, propiedad: "background-color", valor: edicion.valor });
  return { ok: false, error: `Tipo de edición no soportado: ${tipo || "(vacío)"}` };
}

module.exports = { aplicarEdicionVisual, reemplazarTexto, reemplazarFoto, aplicarColor, listarFuentes };
