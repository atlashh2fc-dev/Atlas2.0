/**
 * La propuesta comercial Equifax: asunto, correo HTML y mensaje de WhatsApp,
 * armados desde las mismas líneas cotizadas. La ficha la usa para la vista
 * previa y el servidor para enviar, así que el cliente recibe exactamente lo
 * que vio el ejecutivo. El diseño sigue al cotizador original: cabecera roja,
 * precio grande, documentos para contratar y la firma del ejecutivo.
 */

import {
  DATOS_TRANSFERENCIA,
  DESCRIPCION_BASE_DE_DATOS,
  DESCRIPCION_PUBLICACION,
  DOCUMENTOS_CONTRATACION,
  DOCUMENTOS_PUBLICACION,
  REQUISITOS_PUBLICACION,
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

const ROJO = "#6e1220";
const ROJO_MEDIO = "#9b1c2e";
const OSCURO = "#16090e";
const AMBAR = "#f0c040";
const DORADO = "#c8960a";
const TINTA = "#1f1a1c";
const GRIS = "#6b6266";
const LINEA = "#eadfe1";
const FONDO = "#f4eff0";
const FUENTE = "font-family:Arial,Helvetica,sans-serif;";

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

function tituloSeccion(texto: string): string {
  return `<p style="margin:0 0 10px;${FUENTE}font-size:11px;letter-spacing:1.5px;font-weight:bold;color:${ROJO_MEDIO};">${esc(texto)}</p>`;
}

function listaEnDosColumnas(items: string[]): string {
  const mitad = Math.ceil(items.length / 2);
  const columna = (parte: string[]) =>
    parte
      .map((item) => `<p style="margin:0 0 8px;${FUENTE}font-size:13px;line-height:18px;color:${TINTA};"><span style="color:${ROJO_MEDIO};font-weight:bold;">✓</span>&nbsp; ${esc(item)}</p>`)
      .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="50%" valign="top" style="padding-right:10px;">${columna(items.slice(0, mitad))}</td>
    <td width="50%" valign="top" style="padding-left:10px;">${columna(items.slice(mitad))}</td>
  </tr></table>`;
}

function bloquePrecio(linea: LineaCotizada, valorUf: number): string {
  if (linea.ufVenta == null) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${OSCURO}" style="background:${OSCURO};border-radius:10px;padding:18px 20px;">
      <p style="margin:0;${FUENTE}font-size:14px;color:#ffffff;">${esc(linea.nota ?? "Valor por confirmar.")}</p>
    </td></tr></table>`;
  }
  const lista =
    linea.descuento > 0 && linea.ufLista
      ? `<p style="margin:0 0 4px;${FUENTE}font-size:13px;color:#d9c9cc;">Precio lista <span style="text-decoration:line-through;">${formatoUf(linea.ufLista)} UF</span> &nbsp;<span style="background:${ROJO_MEDIO};color:#ffffff;border-radius:4px;padding:2px 6px;font-weight:bold;">−${linea.descuento}%</span></p>`
      : "";
  const aplicado =
    linea.descuento > 0
      ? `<p style="margin:6px 0 0;${FUENTE}font-size:12px;color:#d9c9cc;">✓ Precio final con ${linea.descuento}% de descuento ya aplicado</p>`
      : "";
  const periodo = linea.cobro === "mensual" ? " mensual" : linea.cobro === "anual" ? " al año" : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${OSCURO}" style="background:${OSCURO};border-radius:10px;padding:18px 20px;">
    <p style="margin:0 0 6px;${FUENTE}font-size:11px;letter-spacing:1.5px;font-weight:bold;color:${DORADO};">${esc(etiquetaCobro(linea).toUpperCase())}</p>
    ${lista}
    <p style="margin:0;${FUENTE}font-size:40px;line-height:46px;font-weight:bold;color:${AMBAR};">${formatoUf(linea.ufVenta)} UF <span style="font-size:16px;color:#ffffff;">+ IVA</span></p>
    ${aplicado}
    <p style="margin:6px 0 0;${FUENTE}font-size:13px;color:#ffffff;">Aprox. ${formatoPesos(linea.ufVenta * valorUf)}${periodo} + IVA</p>
    ${linea.nota ? `<p style="margin:6px 0 0;${FUENTE}font-size:12px;color:#d9c9cc;">${esc(linea.nota)}</p>` : ""}
  </td></tr></table>`;
}

function franjaContrato(linea: LineaCotizada): string {
  if (linea.cobro !== "mensual" && linea.cobro !== "anual") return "";
  const celda = (titulo: string, valor: string) =>
    `<td valign="top" style="padding:10px 12px;border-right:1px solid ${LINEA};"><p style="margin:0;${FUENTE}font-size:10px;letter-spacing:1px;color:${GRIS};">${titulo}</p><p style="margin:2px 0 0;${FUENTE}font-size:13px;font-weight:bold;color:${TINTA};">${valor}</p></td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;border:1px solid ${LINEA};border-radius:8px;"><tr>
    ${celda("CONTRATO", "12 meses")}${celda("MODALIDAD", "Postpago · 30 días")}
  </tr></table>`;
}

function tablaPublicacion(linea: LineaCotizada): string {
  const pub = linea.publicacion!;
  const th = (texto: string) => `<th align="right" style="padding:6px 8px;${FUENTE}font-size:11px;color:${GRIS};border-bottom:1px solid ${LINEA};">${texto}</th>`;
  const td = (texto: string, negrita = false) => `<td align="right" style="padding:6px 8px;${FUENTE}font-size:12px;color:${TINTA};${negrita ? "font-weight:bold;" : ""}border-bottom:1px solid ${LINEA};">${texto}</td>`;
  const filas = pub.documentos
    .map((doc, i) => `<tr><td style="padding:6px 8px;${FUENTE}font-size:12px;color:${TINTA};border-bottom:1px solid ${LINEA};white-space:nowrap;">Doc. ${i + 1}</td>${td(formatoPesos(doc.monto))}${td(formatoPesos(doc.abonos))}${td(formatoPesos(doc.publicar))}${td(formatoPesos(doc.neto))}${td(formatoPesos(doc.iva))}${td(formatoPesos(doc.total), true)}</tr>`)
    .join("");
  const totalesFila = pub.documentos.length > 1
    ? `<tr><td style="padding:6px 8px;${FUENTE}font-size:12px;font-weight:bold;color:${TINTA};">Totales</td>${td("")}${td("")}${td(formatoPesos(pub.publicar), true)}${td(formatoPesos(pub.neto), true)}${td(formatoPesos(pub.iva), true)}${td(formatoPesos(pub.total), true)}</tr>`
    : "";
  const banco = DATOS_TRANSFERENCIA.map(([campo, valor]) => `<p style="margin:0 0 4px;${FUENTE}font-size:13px;color:#ffffff;"><span style="color:#d9c9cc;">${campo}:</span> <strong>${valor}</strong></p>`).join("");
  return `
    ${DESCRIPCION_PUBLICACION.map((parrafo) => `<p style="margin:0 0 10px;${FUENTE}font-size:13px;line-height:19px;color:${TINTA};">${esc(parrafo)}</p>`).join("")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 14px;">
      <tr><th align="left" style="padding:6px 8px;${FUENTE}font-size:11px;color:${GRIS};border-bottom:1px solid ${LINEA};">Documento</th>${th("Monto total")}${th("Abonos")}${th("A publicar")}${th(`Neto (${pub.pct}%)`)}${th("IVA")}${th("Total")}</tr>
      ${filas}${totalesFila}
    </table>
    ${tituloSeccion("REQUISITOS DE PUBLICACIÓN")}
    ${listaEnDosColumnas(REQUISITOS_PUBLICACION)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr><td bgcolor="${OSCURO}" style="background:${OSCURO};border-radius:10px;padding:18px 20px;">
      <p style="margin:0 0 6px;${FUENTE}font-size:11px;letter-spacing:1.5px;font-weight:bold;color:${DORADO};">MONTO A TRANSFERIR</p>
      <p style="margin:0 0 12px;${FUENTE}font-size:34px;line-height:40px;font-weight:bold;color:${AMBAR};">${formatoPesos(pub.total)} <span style="font-size:14px;color:#ffffff;">IVA incluido</span></p>
      ${banco}
    </td></tr></table>`;
}

function bloqueLinea(linea: LineaCotizada, valorUf: number): string {
  let cuerpo: string;
  if (linea.producto === "pub") {
    cuerpo = tablaPublicacion(linea);
  } else {
    const intro = linea.producto === "bdd"
      ? DESCRIPCION_BASE_DE_DATOS.map((parrafo) => `<p style="margin:0 0 10px;${FUENTE}font-size:13px;line-height:19px;color:${TINTA};">${esc(parrafo)}</p>`).join("")
      : "";
    cuerpo = `${intro}${listaEnDosColumnas(linea.beneficios)}<div style="height:8px;line-height:8px;">&nbsp;</div>${bloquePrecio(linea, valorUf)}${franjaContrato(linea)}`;
  }
  return `<tr><td style="padding:22px 28px 6px;">
    <p style="margin:0 0 4px;${FUENTE}font-size:11px;letter-spacing:1.5px;font-weight:bold;color:${ROJO_MEDIO};">PRODUCTO COTIZADO · ${esc(linea.badge)}</p>
    <p style="margin:0 0 2px;${FUENTE}font-size:20px;line-height:26px;font-weight:bold;color:${TINTA};">${esc(linea.nombre)}</p>
    <p style="margin:0 0 14px;${FUENTE}font-size:13px;color:${GRIS};">${esc(linea.detalle)}</p>
    ${cuerpo}
  </td></tr>`;
}

function bloqueTotal(lineas: LineaCotizada[]): string {
  if (lineas.length < 2) return "";
  const total = totales(lineas);
  const partes = [
    total.mensual > 0 ? `${formatoUf(total.mensual)} UF + IVA mensual` : null,
    total.unico > 0 ? `${formatoUf(total.unico)} UF + IVA pago único` : null,
    total.anual > 0 ? `${formatoUf(total.anual)} UF + IVA al año` : null,
    total.clp > 0 ? `${formatoPesos(total.clp)} IVA incluido (publicación)` : null,
  ].filter(Boolean);
  if (!partes.length) return "";
  return `<tr><td style="padding:18px 28px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${ROJO}" style="background:${ROJO};border-radius:10px;padding:16px 20px;">
      <p style="margin:0 0 4px;${FUENTE}font-size:11px;letter-spacing:1.5px;font-weight:bold;color:${AMBAR};">TOTAL DE LA PROPUESTA</p>
      ${partes.map((parte) => `<p style="margin:0;${FUENTE}font-size:18px;line-height:26px;font-weight:bold;color:#ffffff;">${parte}</p>`).join("")}
    </td></tr></table>
  </td></tr>`;
}

function bloqueDocumentos(lineas: LineaCotizada[]): string {
  const soloPublicacion = lineas.every((linea) => linea.producto === "pub");
  const conPublicacion = lineas.some((linea) => linea.producto === "pub");
  const documentos = soloPublicacion
    ? DOCUMENTOS_PUBLICACION
    : [...DOCUMENTOS_CONTRATACION, ...(conPublicacion ? ["DTE (Documento Tributario Electrónico) de los documentos a publicar"] : [])];
  return `<tr><td style="padding:18px 28px 8px;">
    ${tituloSeccion(soloPublicacion ? "DOCUMENTOS A SOLICITAR" : "DOCUMENTOS PARA CONTRATAR")}
    ${documentos.map((doc, i) => `<p style="margin:0 0 6px;${FUENTE}font-size:13px;line-height:18px;color:${TINTA};"><strong style="color:${ROJO_MEDIO};">${i + 1}.</strong> ${esc(doc)}</p>`).join("")}
  </td></tr>`;
}

function bloqueFirma(ejecutivo: EjecutivoFirma, fecha: Date): string {
  const contacto = [ejecutivo.whatsapp ? `WhatsApp ${esc(ejecutivo.whatsapp)}` : null, ejecutivo.correo ? esc(ejecutivo.correo) : null].filter(Boolean).join(" · ");
  return `<tr><td bgcolor="${OSCURO}" style="background:${OSCURO};padding:22px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="64" valign="middle">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="54" height="54" align="center" valign="middle" bgcolor="${ROJO_MEDIO}" style="background:${ROJO_MEDIO};border-radius:27px;${FUENTE}font-size:18px;font-weight:bold;color:${AMBAR};">${esc(iniciales(ejecutivo.nombre))}</td></tr></table>
      </td>
      <td valign="middle">
        <p style="margin:0;${FUENTE}font-size:10px;letter-spacing:1.5px;color:#d9c9cc;">${esc(ejecutivo.cargo.toUpperCase())}</p>
        <p style="margin:2px 0 0;${FUENTE}font-size:18px;font-weight:bold;color:#ffffff;">${esc(ejecutivo.nombre)}</p>
        <p style="margin:2px 0 0;${FUENTE}font-size:13px;font-weight:bold;color:${DORADO};">${EMPRESA_FIRMA}</p>
        ${ejecutivo.firma ? `<p style="margin:4px 0 0;${FUENTE}font-size:12px;font-style:italic;color:#d9c9cc;">${esc(ejecutivo.firma)}</p>` : ""}
        ${contacto ? `<p style="margin:6px 0 0;${FUENTE}font-size:12px;color:#ffffff;">${contacto}</p>` : ""}
      </td>
      <td align="right" valign="bottom" style="${FUENTE}font-size:11px;color:#d9c9cc;">${esc(fechaLarga(fecha))}<br>Valores en UF + IVA</td>
    </tr></table>
  </td></tr>`;
}

/**
 * El correo completo. `logoSrc` es `cid:…` al enviar (el logo va incrustado)
 * y un data URI en la vista previa.
 */
export function correoHtml(datos: DatosPropuesta, logoSrc: string): string {
  const { cliente, lineas, valorUf, fecha } = datos;
  const badge = lineas.length === 1 ? lineas[0].badge : "PROPUESTA MULTIPRODUCTO";
  const empresa = cliente.empresa?.trim().toUpperCase() || null;
  const destinatario = `<tr><td style="padding:24px 28px 6px;">
    ${empresa ? `<p style="margin:0 0 4px;${FUENTE}font-size:11px;letter-spacing:1.5px;font-weight:bold;color:${GRIS};">PROPUESTA PREPARADA PARA</p>
    <p style="margin:0;${FUENTE}font-size:22px;line-height:28px;font-weight:bold;color:${TINTA};">${esc(empresa)}</p>
    ${cliente.rut ? `<p style="margin:2px 0 0;${FUENTE}font-size:13px;color:${GRIS};">RUT ${esc(cliente.rut)}</p>` : ""}` : `<p style="margin:0;${FUENTE}font-size:22px;font-weight:bold;color:${TINTA};">Propuesta Comercial</p>`}
    <p style="margin:16px 0 0;${FUENTE}font-size:14px;line-height:21px;color:${TINTA};">${esc(vocativo(cliente.contacto))}<br>${saludoSegunHora(fecha)}. Le presento la siguiente propuesta comercial:</p>
  </td></tr>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Propuesta Comercial Equifax</title></head>
<body style="margin:0;padding:0;background:${FONDO};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FONDO}" style="background:${FONDO};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINEA};border-radius:12px;overflow:hidden;">
  <tr><td bgcolor="${ROJO}" style="background:${ROJO};padding:22px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle"><img src="${esc(logoSrc)}" width="150" alt="Equifax" style="display:block;width:150px;height:auto;border:0;">
        <p style="margin:8px 0 0;${FUENTE}font-size:10px;letter-spacing:2px;color:#f3d9dd;">CHILE · SOLUCIONES EMPRESARIALES</p></td>
      <td align="right" valign="middle"><span style="display:inline-block;background:${ROJO_MEDIO};border:1px solid #c0263b;border-radius:14px;padding:5px 12px;${FUENTE}font-size:11px;font-weight:bold;letter-spacing:1px;color:#ffffff;">${esc(badge)}</span>
        <p style="margin:8px 0 0;${FUENTE}font-size:11px;color:#f3d9dd;">${esc(fechaLarga(fecha))}</p></td>
    </tr></table>
  </td></tr>
  ${destinatario}
  ${lineas.map((linea) => bloqueLinea(linea, valorUf)).join(`<tr><td style="padding:10px 28px 0;"><div style="border-top:1px solid ${LINEA};font-size:0;line-height:0;">&nbsp;</div></td></tr>`)}
  ${bloqueTotal(lineas)}
  ${bloqueDocumentos(lineas)}
  <tr><td style="padding:10px 28px 22px;"><p style="margin:0;${FUENTE}font-size:13px;color:${TINTA};">Quedo a su disposición para cualquier consulta.</p></td></tr>
  ${bloqueFirma(datos.ejecutivo, fecha)}
  <tr><td align="center" style="padding:12px 28px;${FUENTE}font-size:10px;color:${GRIS};">${EMPRESA_FIRMA} · Información confidencial · Solo para el destinatario autorizado</td></tr>
</table>
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
    ejecutivo.correo ? `✉ ${ejecutivo.correo}` : null,
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
