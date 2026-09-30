/**
 * La propuesta comercial Equifax: asunto, correo HTML y mensaje de WhatsApp,
 * armados desde las mismas líneas cotizadas. La ficha la usa para la vista
 * previa y el servidor para enviar, así que el cliente recibe exactamente lo
 * que vio el ejecutivo.
 */

import {
  DATOS_TRANSFERENCIA,
  DOCUMENTOS_CONTRATACION,
  DOCUMENTOS_PUBLICACION,
  etiquetaCobro,
  formatoPesos,
  formatoUf,
  totales,
  type LineaCotizada,
} from "./catalogo.ts";

export type EjecutivoFirma = {
  nombre: string;
  cargo: string;
  correo: string | null;
  whatsapp: string | null;
  firma: string | null;
};

export type DatosPropuesta = {
  cliente: { empresa: string | null; rut: string | null; contacto: string | null };
  ejecutivo: EjecutivoFirma;
  lineas: LineaCotizada[];
  valorUf: number;
  fecha: Date;
  /**
   * El buzón de la cuenta, adonde vuelven las respuestas. La firma y el botón
   * de aceptar apuntan ahí y no al correo personal del ejecutivo, para que
   * todo quede en Atlas. Sin buzón, el correo de la firma.
   */
  correoRespuesta?: string | null;
  /** Número corto de la propuesta, cuando ya está registrada. */
  folio?: string | null;
};

export const EMPRESA_FIRMA = "Equifax Chile";

/** La firma a partir del perfil: sin cargo, "Ejecutivo Comercial"; sin correo comercial, el de acceso. */
export function firmaDesdePerfil(perfil: {
  nombre: string;
  cargo: string | null;
  whatsapp: string | null;
  correo: string | null;
  correoAcceso: string;
  firma: string | null;
}): EjecutivoFirma {
  return {
    nombre: perfil.nombre,
    cargo: perfil.cargo || "Ejecutivo Comercial",
    correo: perfil.correo || perfil.correoAcceso,
    whatsapp: perfil.whatsapp,
    firma: perfil.firma,
  };
}

const ZONA = "America/Santiago";

// ── Saludo ────────────────────────────────────────────────────────────────

const MASCULINOS_EN_A = new Set(["luca", "joshua", "borja", "nikita", "elia", "jona"]);

function primerNombre(contacto: string | null): string | null {
  const nombre = (contacto ?? "").trim().split(/\s+/)[0];
  if (!nombre || nombre.length < 2) return null;
  return nombre.charAt(0).toLocaleUpperCase("es-CL") + nombre.slice(1).toLocaleLowerCase("es-CL");
}

/** "Estimada Carolina:" / "Estimado Pedro:" / "Estimados:". */
export function vocativo(contacto: string | null): string {
  const nombre = primerNombre(contacto);
  if (!nombre) return "Estimados:";
  const minuscula = nombre.toLocaleLowerCase("es-CL");
  const femenino = minuscula.endsWith("a") && !MASCULINOS_EN_A.has(minuscula);
  return `${femenino ? "Estimada" : "Estimado"} ${nombre}:`;
}

export function saludoSegunHora(fecha: Date): string {
  const hora = Number(new Intl.DateTimeFormat("es-CL", { timeZone: ZONA, hour: "numeric", hourCycle: "h23" }).format(fecha));
  if (hora < 12) return "Buenos días";
  if (hora < 20) return "Buenas tardes";
  return "Buenas noches";
}

function fechaLarga(fecha: Date): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone: ZONA, day: "numeric", month: "long", year: "numeric" }).format(fecha);
}

// ── Asunto ────────────────────────────────────────────────────────────────

export function asuntoPropuesta(datos: Pick<DatosPropuesta, "cliente" | "lineas">): string {
  const empresa = datos.cliente.empresa?.trim().toUpperCase();
  const cola = empresa ? ` | ${empresa}` : "";
  if (datos.lineas.length === 1) {
    const [linea] = datos.lineas;
    return `Propuesta Comercial Equifax — ${linea.nombre} · ${linea.detalle}${cola}`;
  }
  return `Propuesta Multiproducto Equifax${cola}`;
}

// ── Correo HTML ───────────────────────────────────────────────────────────
//
// Con la marca de Equifax (rojo #9E1B32, rojo profundo #80001C, grafito
// #333E48 y Open Sans, como en equifax.cl), y en el
// orden en que el cliente decide: la inversión y lo que se ahorra frente al
// precio lista van primero y en grande, con el único botón (aceptar); luego
// cada servicio en una tarjeta corta con sus tres beneficios principales; los
// pasos para contratar en una fila; y quién lo atiende. Nada de urgencia
// inventada: el ahorro es la diferencia real con el precio lista.
//
// Tablas y estilos en línea para Outlook y Gmail; en pantallas chicas las
// columnas se apilan.

const ROJO = "#9e1b32";
const ROJO_OSCURO = "#80001c";
const ROSADO = "#fbeef1";
const GRAFITO = "#333e48";
const GRAFITO_OSCURO = "#262f37";
const TINTA = "#1f262d";
const TEXTO = "#46505a";
const GRIS = "#76808a";
const GRIS_CLARO = "#b9c1c9";
const LINEA = "#e3e6ea";
const FONDO = "#eef0f2";
const FUENTE = "font-family:'Open Sans','Helvetica Neue',Helvetica,Arial,sans-serif;";

function esc(texto: string | null | undefined): string {
  return (texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((parte) => parte[0]!.toUpperCase()).join("") || "EQ";
}

function primerNombreDe(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] || nombre;
}

/** +56912345678 → +56 9 1234 5678; lo que no calce se deja como vino. */
function telefonoLegible(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  if (digitos.length === 11 && digitos.startsWith("569")) return `+56 9 ${digitos.slice(3, 7)} ${digitos.slice(7)}`;
  return telefono;
}

function periodoCorto(linea: LineaCotizada): string {
  if (linea.producto === "bolsa") return "pago único · 12 meses";
  return linea.cobro === "mensual" ? "mensual" : linea.cobro === "anual" ? "anual" : linea.cobro === "unico" ? "pago único" : "";
}

function etiqueta(texto: string, color = GRIS): string {
  return `<p style="margin:0 0 10px;${FUENTE}font-size:11px;line-height:14px;letter-spacing:1.4px;font-weight:bold;text-transform:uppercase;color:${color};">${esc(texto)}</p>`;
}

function fila(contenido: string, padding = "0 36px"): string {
  return `<tr><td class="px" style="padding:${padding};">${contenido}</td></tr>`;
}

/** El total por forma de cobro: [monto, "+ IVA mensual"]. */
function partesTotal(lineas: LineaCotizada[]): Array<[string, string]> {
  const total = totales(lineas);
  return [
    total.mensual > 0 ? [`${formatoUf(total.mensual)} UF`, "+ IVA mensual"] : null,
    total.unico > 0 ? [`${formatoUf(total.unico)} UF`, "+ IVA pago único"] : null,
    total.anual > 0 ? [`${formatoUf(total.anual)} UF`, "+ IVA anual"] : null,
    total.clp > 0 ? [formatoPesos(total.clp), "IVA incluido"] : null,
  ].filter((parte): parte is [string, string] => parte !== null);
}

/**
 * Lo que se ahorra frente al precio lista en lo mensual, en UF al mes. Es neto:
 * una línea ofrecida sobre la lista resta, para no prometer un ahorro que el
 * total no tiene. Nunca es negativo; sin ahorro, la propuesta no lo menciona.
 */
function ahorroMensual(lineas: LineaCotizada[]): number {
  const ahorro = lineas
    .filter((linea) => linea.cobro === "mensual" && linea.ufLista != null && linea.ufVenta != null)
    .reduce((total, linea) => total + (linea.ufLista! - linea.ufVenta!), 0);
  return Math.max(0, Math.round(ahorro * 10000) / 10000);
}

function enlaceAceptar(datos: DatosPropuesta, asunto: string): string | null {
  const correo = datos.correoRespuesta || datos.ejecutivo.correo;
  if (!correo) return null;
  const empresa = datos.cliente.empresa?.trim() || "nuestra empresa";
  const cuerpo = `Hola ${primerNombreDe(datos.ejecutivo.nombre)}:\n\nQueremos avanzar con la propuesta de Equifax para ${empresa}. Quedamos atentos a los pasos para contratar.\n\nSaludos,`;
  return `mailto:${correo}?subject=${encodeURIComponent(`Acepto la propuesta — ${asunto}`)}&body=${encodeURIComponent(cuerpo)}`;
}

// ── La inversión ──

function bloqueInversion(datos: DatosPropuesta, asunto: string): string {
  const { lineas, valorUf } = datos;
  const [principal, ...resto] = partesTotal(lineas);
  const total = totales(lineas);
  const ahorro = ahorroMensual(lineas);
  const aceptar = enlaceAceptar(datos, asunto);
  const whatsapp = datos.ejecutivo.whatsapp?.replace(/\D/g, "") || null;

  const titulo = lineas.length > 1 ? "Su inversión total" : `Su inversión en ${lineas[0]?.nombre ?? "Equifax"}`;
  const cifra = principal
    ? `<p style="margin:0;${FUENTE}font-size:44px;line-height:50px;font-weight:bold;letter-spacing:-1px;color:#ffffff;" class="cifra">${esc(principal[0])} <span style="font-size:16px;font-weight:normal;letter-spacing:0;color:${GRIS_CLARO};">${esc(principal[1])}</span></p>`
    : `<p style="margin:0;${FUENTE}font-size:22px;line-height:30px;font-weight:bold;color:#ffffff;">Valor por confirmar</p>`;
  const otros = resto
    .map(([monto, cobro]) => `<p style="margin:6px 0 0;${FUENTE}font-size:18px;line-height:24px;font-weight:bold;color:#ffffff;">+ ${esc(monto)} <span style="font-size:13px;font-weight:normal;color:${GRIS_CLARO};">${esc(cobro)}</span></p>`)
    .join("");
  const pesos = total.mensual > 0
    ? `<p style="margin:10px 0 0;${FUENTE}font-size:13px;line-height:19px;color:${GRIS_CLARO};">Unos <strong style="color:#ffffff;">${formatoPesos(total.mensual * valorUf)} + IVA al mes</strong> con la UF de hoy (${formatoPesos(valorUf)}).</p>`
    : "";
  const chipAhorro = ahorro > 0
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr><td bgcolor="${GRAFITO_OSCURO}" style="background:${GRAFITO_OSCURO};border-left:3px solid #ffffff;border-radius:6px;padding:10px 14px;${FUENTE}font-size:13px;line-height:19px;color:#ffffff;">
        Ahorra <strong>${formatoUf(ahorro)} UF al mes</strong> frente al precio lista: unos <strong>${formatoPesos(ahorro * valorUf * 12)}</strong> en los 12 meses de contrato.
      </td></tr></table>`
    : "";
  const boton = aceptar
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr>
        <td align="center" bgcolor="#ffffff" style="background:#ffffff;border-radius:8px;">
          <a href="${esc(aceptar)}" style="display:inline-block;padding:15px 30px;${FUENTE}font-size:16px;line-height:20px;font-weight:bold;color:${ROJO};text-decoration:none;border-radius:8px;">Aceptar la propuesta &rarr;</a>
        </td></tr></table>`
    : "";
  const alternativa = [
    aceptar ? "o responda este correo" : null,
    whatsapp ? `<a href="https://wa.me/${whatsapp}" style="color:#ffffff;text-decoration:underline;">hable con ${esc(primerNombreDe(datos.ejecutivo.nombre))} por WhatsApp</a>` : null,
  ].filter(Boolean).join(" · ");

  return `<tr><td class="px" bgcolor="${GRAFITO}" style="background:${GRAFITO};padding:30px 36px 32px;">
    <p style="margin:0 0 8px;${FUENTE}font-size:11px;line-height:14px;letter-spacing:1.4px;font-weight:bold;text-transform:uppercase;color:#f3b4c0;">${esc(titulo)}</p>
    ${cifra}${otros}${pesos}${chipAhorro}${boton}
    ${alternativa ? `<p style="margin:12px 0 0;${FUENTE}font-size:13px;line-height:19px;color:${GRIS_CLARO};">${aceptar ? "" : "Para avanzar, "}${alternativa}</p>` : ""}
  </td></tr>`;
}

// ── Servicios ──

function precioTarjeta(linea: LineaCotizada): string {
  if (linea.producto === "pub" && linea.publicacion) {
    return `<p style="margin:0;${FUENTE}font-size:20px;line-height:24px;font-weight:bold;color:${TINTA};white-space:nowrap;">${formatoPesos(linea.publicacion.total)}</p>
      <p style="margin:2px 0 0;${FUENTE}font-size:12px;line-height:16px;color:${GRIS};">IVA incluido</p>`;
  }
  if (linea.ufVenta == null) {
    return `<p style="margin:0;${FUENTE}font-size:14px;line-height:20px;font-weight:bold;color:${TINTA};">Por confirmar</p>`;
  }
  const lista = linea.descuento > 0 && linea.ufLista
    ? `<p style="margin:0 0 2px;${FUENTE}font-size:12px;line-height:16px;color:${GRIS};white-space:nowrap;"><span style="text-decoration:line-through;">${formatoUf(linea.ufLista)} UF</span>&nbsp;<span style="background:${ROSADO};color:${ROJO};border-radius:9px;padding:1px 7px;font-weight:bold;">−${linea.descuento}%</span></p>`
    : "";
  return `${lista}<p style="margin:0;${FUENTE}font-size:20px;line-height:24px;font-weight:bold;color:${TINTA};white-space:nowrap;">${formatoUf(linea.ufVenta)} UF</p>
    <p style="margin:2px 0 0;${FUENTE}font-size:12px;line-height:16px;color:${GRIS};">+ IVA ${esc(periodoCorto(linea))}</p>`;
}

function beneficiosCortos(items: string[]): string {
  return items
    .slice(0, 3)
    .map((item) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 5px;"><tr>
      <td valign="top" width="20" style="${FUENTE}font-size:13px;line-height:19px;font-weight:bold;color:${ROJO};">✓</td>
      <td valign="top" style="${FUENTE}font-size:13px;line-height:19px;color:${TEXTO};">${esc(item)}</td>
    </tr></table>`)
    .join("");
}

function detallePublicacion(linea: LineaCotizada): string {
  const pub = linea.publicacion!;
  const documentos = pub.documentos
    .map((doc, i) => `<p style="margin:0 0 3px;${FUENTE}font-size:12px;line-height:17px;color:${TEXTO};">Documento ${i + 1}: ${formatoPesos(doc.monto)}${doc.abonos ? ` − abonos ${formatoPesos(doc.abonos)}` : ""} → a publicar <strong>${formatoPesos(doc.publicar)}</strong></p>`)
    .join("");
  const banco = DATOS_TRANSFERENCIA.map(([campo, valor]) => `<tr>
      <td style="padding:2px 12px 2px 0;${FUENTE}font-size:12px;line-height:17px;color:${GRIS};white-space:nowrap;">${campo}</td>
      <td style="padding:2px 0;${FUENTE}font-size:12px;line-height:17px;font-weight:bold;color:${TINTA};">${valor}</td>
    </tr>`).join("");
  return `<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
    ${documentos}
    <p style="margin:6px 0 12px;${FUENTE}font-size:12px;line-height:17px;color:${GRIS};">Neto ${pub.pct}%: ${formatoPesos(pub.neto)} + IVA ${formatoPesos(pub.iva)}. Documento con hasta 7 años de vencido (empresas) o 5 (personas), sin demanda judicial; facturas aceptadas por el SII.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#f6f7f8" style="background:#f6f7f8;border-radius:8px;padding:12px 14px;">
      ${etiqueta("Datos para transferir")}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">${banco}</table>
    </td></tr></table>`;
}

function tarjetaServicio(linea: LineaCotizada): string {
  const condiciones = linea.cobro === "mensual" || linea.cobro === "anual" ? "Contrato 12 meses · postpago a 30 días" : null;
  const cuerpo = linea.producto === "pub" && linea.publicacion
    ? detallePublicacion(linea)
    : `<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>${beneficiosCortos(linea.beneficios)}
       ${linea.nota ? `<p style="margin:6px 0 0;${FUENTE}font-size:12px;line-height:17px;color:${GRIS};">${esc(linea.nota)}</p>` : ""}`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;border:1px solid ${LINEA};border-left:4px solid ${ROJO};border-radius:10px;border-collapse:separate;"><tr><td style="padding:18px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="col" valign="top" style="padding-right:12px;">
        ${linea.badge.toLocaleLowerCase("es-CL") === linea.nombre.toLocaleLowerCase("es-CL") ? "" : `<p style="margin:0 0 4px;${FUENTE}font-size:10px;line-height:13px;letter-spacing:1.2px;font-weight:bold;text-transform:uppercase;color:${ROJO};">${esc(linea.badge)}</p>`}
        <p style="margin:0;${FUENTE}font-size:17px;line-height:22px;font-weight:bold;color:${TINTA};">${esc(linea.nombre)}</p>
        <p style="margin:3px 0 0;${FUENTE}font-size:12px;line-height:17px;color:${GRIS};">${esc(linea.detalle)}${condiciones ? ` · ${condiciones}` : ""}</p>
      </td>
      <td class="col precio-tarjeta" valign="top" align="right" width="130">${precioTarjeta(linea)}</td>
    </tr></table>
    ${cuerpo}
  </td></tr></table>`;
}

// ── Cómo contratar ──

function bloquePasos(datos: DatosPropuesta): string {
  const soloPublicacion = datos.lineas.every((linea) => linea.producto === "pub");
  const conPublicacion = datos.lineas.some((linea) => linea.producto === "pub");
  const documentos = soloPublicacion
    ? ["Cédula de los representantes legales", "Escritura o poderes de firma", "Documentos a publicar (facturas con DTE aceptada por el SII)", "Comprobante de transferencia"]
    : [...DOCUMENTOS_CONTRATACION, ...(conPublicacion ? ["DTE de los documentos a publicar"] : [])];
  const nombre = primerNombreDe(datos.ejecutivo.nombre);
  const pasos: Array<[string, string]> = [
    ["Acepte", "Con el botón o respondiendo este correo."],
    ["Envíe los documentos", "Adjúntelos en la respuesta."],
    [soloPublicacion ? "Publicamos" : "Activamos", `${nombre} coordina ${soloPublicacion ? "la publicación" : "la firma y la activación"}.`],
  ];
  const celda = ([titulo, texto]: [string, string], i: number) => `<td class="col" valign="top" width="33%" style="padding:0 ${i < 2 ? "10px" : "0"} 12px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="top" width="34"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="26" height="26" align="center" valign="middle" bgcolor="${ROJO}" style="background:${ROJO};border-radius:13px;${FUENTE}font-size:12px;font-weight:bold;color:#ffffff;">${i + 1}</td></tr></table></td>
        <td valign="top">
          <p style="margin:3px 0 2px;${FUENTE}font-size:13px;line-height:18px;font-weight:bold;color:${TINTA};">${esc(titulo)}</p>
          <p style="margin:0;${FUENTE}font-size:12px;line-height:17px;color:${GRIS};">${esc(texto)}</p>
        </td>
      </tr></table>
    </td>`;
  return fila(`${etiqueta("Cómo contratar")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${pasos.map(celda).join("")}</tr></table>
    <p style="margin:4px 0 0;${FUENTE}font-size:12px;line-height:18px;color:${GRIS};"><strong style="color:${TEXTO};">Documentos:</strong> ${documentos.map(esc).join(" · ")}.</p>`, "26px 36px 0");
}

// ── Firma ──

function bloqueFirma(datos: DatosPropuesta): string {
  const { ejecutivo } = datos;
  const correo = datos.correoRespuesta || ejecutivo.correo;
  const whatsapp = ejecutivo.whatsapp?.replace(/\D/g, "") || null;
  const contacto = [
    whatsapp ? `<a href="https://wa.me/${whatsapp}" style="color:${ROJO};font-weight:bold;text-decoration:none;">WhatsApp ${esc(telefonoLegible(ejecutivo.whatsapp!))}</a>` : null,
    correo ? `<a href="mailto:${esc(correo)}" style="color:${TINTA};text-decoration:none;">${esc(correo)}</a>` : null,
  ].filter(Boolean).join(`<span style="color:${GRIS_CLARO};">&nbsp; · &nbsp;</span>`);
  return fila(`<div style="border-top:1px solid ${LINEA};height:1px;line-height:1px;font-size:0;">&nbsp;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr>
      <td width="58" valign="top">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="46" height="46" align="center" valign="middle" bgcolor="${GRAFITO}" style="background:${GRAFITO};border-radius:23px;${FUENTE}font-size:15px;font-weight:bold;color:#ffffff;">${esc(iniciales(ejecutivo.nombre))}</td></tr></table>
      </td>
      <td valign="top">
        <p style="margin:0;${FUENTE}font-size:15px;line-height:21px;font-weight:bold;color:${TINTA};">${esc(ejecutivo.nombre)}</p>
        <p style="margin:0;${FUENTE}font-size:12px;line-height:18px;color:${GRIS};">${esc(ejecutivo.cargo)} · <strong style="color:${ROJO};">${EMPRESA_FIRMA}</strong>${ejecutivo.firma ? ` · ${esc(ejecutivo.firma)}` : ""}</p>
        ${contacto ? `<p style="margin:6px 0 0;${FUENTE}font-size:13px;line-height:19px;">${contacto}</p>` : ""}
      </td>
    </tr></table>`, "26px 36px 30px");
}

/** Nombre visible del remitente: el ejecutivo, sobre el buzón de la cuenta. */
export function remitenteDeEjecutivo(nombre: string): string {
  return `${nombre.trim()} · Equifax`;
}

/**
 * El correo completo. `logoSrc` es `cid:…` al enviar (el logo va incrustado)
 * y un data URI en la vista previa.
 */
export function correoHtml(datos: DatosPropuesta, logoSrc: string): string {
  const { cliente, lineas, fecha } = datos;
  const empresa = cliente.empresa?.trim() || null;
  const asunto = asuntoPropuesta(datos);
  const total = partesTotal(lineas);
  const ahorro = ahorroMensual(lineas);
  const preheader = [
    empresa ? `Propuesta para ${empresa}` : "Su propuesta Equifax",
    total.length ? total.map((parte) => parte.join(" ")).join(" · ") : null,
    ahorro > 0 ? `ahorro de ${formatoUf(ahorro)} UF al mes frente al precio lista` : null,
  ].filter(Boolean).join(" — ");
  const saludo = `${esc(vocativo(cliente.contacto))} ${saludoSegunHora(fecha).toLocaleLowerCase("es-CL")}. ${
    empresa
      ? `Esta es la propuesta que preparé para <strong style="color:${TINTA};">${esc(empresa)}</strong>${cliente.rut ? ` (RUT ${esc(cliente.rut)})` : ""}.`
      : "Esta es la propuesta que preparé para su empresa."
  }`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(asunto)}</title>
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
  a { text-decoration: none; }
  @media only screen and (max-width: 620px) {
    .marco { padding: 0 !important; }
    .px { padding-left: 20px !important; padding-right: 20px !important; }
    .col { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; }
    .cifra { font-size: 34px !important; line-height: 40px !important; }
    .cabecera-derecha { text-align: left !important; padding-top: 10px !important; }
    .precio-tarjeta { text-align: left !important; padding-top: 10px !important; }
  }
</style></head>
<body style="margin:0;padding:0;background:${FONDO};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${FONDO};">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FONDO}" style="background:${FONDO};"><tr><td class="marco" align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
  <tr><td class="px" bgcolor="${ROJO}" style="background:${ROJO};padding:22px 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="col" valign="middle"><img src="${esc(logoSrc)}" width="124" alt="Equifax" style="display:block;width:124px;height:auto;border:0;"></td>
      <td class="col cabecera-derecha" align="right" valign="middle">
        <p style="margin:0;${FUENTE}font-size:11px;line-height:14px;letter-spacing:1.4px;font-weight:bold;text-transform:uppercase;color:#ffffff;">Propuesta comercial</p>
        <p style="margin:3px 0 0;${FUENTE}font-size:12px;line-height:16px;color:#f3c9d1;">${datos.folio ? `N.º ${esc(datos.folio)} · ` : ""}${esc(fechaLarga(fecha))}</p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${ROJO_OSCURO}" style="background:${ROJO_OSCURO};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
  ${fila(`<p style="margin:0;${FUENTE}font-size:15px;line-height:23px;color:${TEXTO};">${saludo}</p>`, "26px 36px 24px")}
  ${bloqueInversion(datos, asunto)}
  ${fila(`${etiqueta(lineas.length > 1 ? `Qué incluye · ${lineas.length} servicios` : "Qué incluye")}${lineas.map(tarjetaServicio).join("")}`, "28px 36px 0")}
  ${bloquePasos(datos)}
  ${bloqueFirma(datos)}
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;"><tr><td class="px" style="padding:18px 36px 0;${FUENTE}font-size:11px;line-height:16px;color:${GRIS};text-align:center;">
  Valores en UF más IVA; el monto en pesos es referencial, con la UF del ${esc(fechaLarga(fecha))}.<br>
  ${EMPRESA_FIRMA} · Propuesta confidencial para ${empresa ? esc(empresa) : "su destinatario"}.
</td></tr></table>
</td></tr></table>
</body></html>`;
}

// ── WhatsApp y texto plano ────────────────────────────────────────────────

const RAYA = "━━━━━━━━━━━━━━━━━━━━";

function textoLinea(linea: LineaCotizada, valorUf: number): string[] {
  const filas = [RAYA, `*${linea.nombre}*`, linea.detalle, RAYA, ""];
  if (linea.producto === "pub" && linea.publicacion) {
    const pub = linea.publicacion;
    pub.documentos.forEach((doc, i) => {
      filas.push(`📄 Documento ${i + 1}: monto ${formatoPesos(doc.monto)}${doc.abonos ? `, abonos ${formatoPesos(doc.abonos)}` : ""} → a publicar ${formatoPesos(doc.publicar)}`);
    });
    filas.push("", `Neto (${pub.pct}%): ${formatoPesos(pub.neto)}`, `IVA: ${formatoPesos(pub.iva)}`, `*Total a transferir: ${formatoPesos(pub.total)}*`, "", "*Datos de transferencia*");
    DATOS_TRANSFERENCIA.forEach(([campo, valor]) => filas.push(`${campo}: ${valor}`));
    return [...filas, ""];
  }
  filas.push(...linea.beneficios.slice(0, 5).map((beneficio) => `✔️ ${beneficio}`), "");
  if (linea.ufVenta == null) {
    filas.push(linea.nota ?? "Valor por confirmar.", "");
    return filas;
  }
  const periodo = linea.cobro === "mensual" ? " mensual" : linea.cobro === "anual" ? " al año" : "";
  if (linea.descuento > 0 && linea.ufLista) filas.push(`~Precio lista: ${formatoUf(linea.ufLista)} UF + IVA~`);
  filas.push(`*Precio ofrecido: ${formatoUf(linea.ufVenta)} UF* + IVA (${etiquetaCobro(linea).toLowerCase()})`);
  filas.push(`💰 _Aprox. ${formatoPesos(linea.ufVenta * valorUf)}${periodo} + IVA_`);
  if (linea.descuento > 0) filas.push(`🎯 *Descuento: −${linea.descuento}%*`);
  if (linea.nota) filas.push(linea.nota);
  if (linea.cobro === "mensual" || linea.cobro === "anual") filas.push("📅 Plazo: *12 meses*", "💳 Modalidad: _Postpago · 30 días_");
  return [...filas, ""];
}

/** El mensaje de WhatsApp, con el formato de WhatsApp (*negrita*, _cursiva_, ~tachado~). */
export function mensajeWhatsapp(datos: DatosPropuesta): string {
  const { cliente, lineas, valorUf, ejecutivo } = datos;
  const empresa = cliente.empresa?.trim().toUpperCase() || null;
  const encabezado = [
    cliente.contacto ? vocativo(cliente.contacto) : empresa ? `Señores *${empresa}*:` : "Estimados:",
    cliente.rut ? `RUT: ${cliente.rut}` : null,
    lineas.length === 1
      ? `${saludoSegunHora(datos.fecha)}. Le envío la propuesta comercial para el servicio *${lineas[0].nombre}*.`
      : `${saludoSegunHora(datos.fecha)}. Le envío la propuesta comercial de Equifax.`,
    cliente.contacto && empresa ? `Cotización para *${empresa}*.` : null,
    "",
  ].filter((fila): fila is string => fila !== null);

  const total = totales(lineas);
  const cierreTotal = lineas.length > 1
    ? [
        RAYA,
        "*TOTAL DE LA PROPUESTA*",
        RAYA,
        total.mensual > 0 ? `${formatoUf(total.mensual)} UF + IVA mensual` : null,
        total.unico > 0 ? `${formatoUf(total.unico)} UF + IVA pago único` : null,
        total.anual > 0 ? `${formatoUf(total.anual)} UF + IVA al año` : null,
        total.clp > 0 ? `${formatoPesos(total.clp)} IVA incluido (publicación)` : null,
        "",
      ].filter((fila): fila is string => fila !== null)
    : [];

  const soloPublicacion = lineas.every((linea) => linea.producto === "pub");
  const documentos = soloPublicacion ? DOCUMENTOS_PUBLICACION : DOCUMENTOS_CONTRATACION;
  const firma = [
    "—",
    `*${ejecutivo.nombre}*`,
    `_${ejecutivo.cargo} · ${EMPRESA_FIRMA}_`,
    ejecutivo.firma ? `_${ejecutivo.firma}_` : null,
    ejecutivo.whatsapp ? `📱 ${ejecutivo.whatsapp}` : null,
    datos.correoRespuesta || ejecutivo.correo ? `✉ ${datos.correoRespuesta || ejecutivo.correo}` : null,
  ].filter((fila): fila is string => fila !== null);

  return [
    ...encabezado,
    ...lineas.flatMap((linea) => textoLinea(linea, valorUf)),
    ...cierreTotal,
    RAYA,
    "*DOCUMENTOS*",
    RAYA,
    "",
    ...documentos.map((doc, i) => `${i + 1}. ${doc}`),
    "",
    "Quedo a su disposición 🤝",
    "",
    ...firma,
  ].join("\n");
}

/** La parte de texto del correo: el mismo mensaje sin las marcas de WhatsApp. */
export function correoTexto(datos: DatosPropuesta): string {
  return mensajeWhatsapp(datos)
    .replace(/~([^~\n]+)~/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1");
}
