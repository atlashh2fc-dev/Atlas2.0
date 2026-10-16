/**
 * La propuesta comercial de Secretaria Virtual («Servicio de Ejecutiva
 * Virtual» de Geimser): asunto, correo HTML y mensaje de WhatsApp. Lleva las
 * variables y los textos del documento (cliente, RUT, correo, teléfono, fecha,
 * N.º de propuesta, descripción, características, beneficios, condiciones y
 * compromiso), con la marca Geimser y el orden en que el cliente decide: la
 * inversión primero y el botón para aceptar. La ficha la usa para la vista
 * previa y el servidor para enviar, así que llega exactamente lo que se vio.
 */

import { formatoPesos, formatoUf } from "../equifax-cotizador/catalogo.ts";
import { saludoSegunHora, vocativo, type EjecutivoFirma } from "../equifax-cotizador/propuesta.ts";
import { PLAN_BASE, PLAZO_MINIMO, simular, tieneCondiciones, type CondicionesParticulares, type PlazoMeses } from "./plan.ts";

export const EMPRESA_SV = "Geimser";

export type DatosPropuestaSv = {
  cliente: {
    empresa: string | null;
    rut: string | null;
    contacto: string | null;
    correo: string | null;
    telefono: string | null;
  };
  ejecutivo: EjecutivoFirma;
  meses: PlazoMeses;
  valorUf: number;
  condiciones: CondicionesParticulares;
  fecha: Date;
  /** N.º de propuesta (20261001); null en la vista previa, antes de registrarla. */
  folio: string | null;
  /** El buzón de la empresa, adonde vuelven las respuestas. */
  correoRespuesta?: string | null;
};

// Textos del documento, con la ortografía corregida.

export const DESCRIPCION = [
  "GEIMSER pone a disposición de su empresa un servicio de Ejecutiva Virtual con atención 100 % humana, orientado a mejorar la experiencia de sus clientes, optimizar la gestión de comunicaciones y proyectar una imagen empresarial profesional.",
  "El servicio es prestado por una ejecutiva no exclusiva, bajo modalidad compartida, permitiendo acceder a una atención profesional sin asumir los costos de contratación de personal propio.",
];

export const CARACTERISTICAS: Array<[string, string]> = [
  ["Modalidad", "Ejecutiva virtual no exclusiva (compartida)"],
  ["Tipo de atención", "Telefónica, WhatsApp, correo y administrativa"],
  ["Días de atención", "Lunes a viernes"],
  ["Jornada de servicio", "42 horas semanales"],
  ["Recepción de llamadas", "Según capacidad y volumen contratado"],
  ["Gestión de consultas", "Respuestas, clasificación y filtro de información"],
  ["Derivación", "Según protocolos definidos por el cliente"],
  ["Registro de llamadas", "Detalle de contactos, motivos y resultados (fecha, hora, número de contacto, nombre y recado)"],
  ["Plataforma online", "Consulta del historial de atenciones"],
  ["Reportería", "Online"],
];

export const BENEFICIOS: Array<[string, string]> = [
  ["Atención humana y personalizada", "sus clientes interactúan con una ejecutiva real, preparada para entregar una atención cordial y profesional."],
  ["Optimización del tiempo", "libere tiempo para concentrarse en las actividades estratégicas de su negocio."],
  ["Imagen corporativa", "proyecte una empresa organizada, accesible y preocupada por sus clientes."],
  ["Filtro inteligente de comunicaciones", "reciba únicamente las consultas y requerimientos que necesitan su intervención."],
  ["Control y trazabilidad", "revise online quiénes se han comunicado, cuántas veces lo han hecho y los motivos de contacto."],
  ["Flexibilidad operacional", "adapte los protocolos de atención y derivación a las necesidades de su empresa."],
  ["Eficiencia económica", "acceda a una ejecutiva profesional sin los costos asociados a mantener un puesto exclusivo."],
];

export const CONDICIONES_CONTRATACION: Array<[string, string]> = [
  ["Plazo mínimo", "3 meses de contratación."],
  ["Continuidad", "cumplido el plazo inicial, puede renovar en forma trimestral, semestral o anual, accediendo a los descuentos vigentes."],
  ["Término de contrato", "posterior al período mínimo, el cliente podrá solicitar el término del servicio mediante aviso escrito con al menos 15 días corridos de anticipación."],
  ["Modalidad", "ejecutiva compartida, no dedicada exclusivamente a un cliente."],
  ["Configuración", "los protocolos de atención, derivación y entrega de información serán definidos conjuntamente al inicio del servicio."],
];

export const NOTA_CONDICIONES_PARTICULARES =
  "El volumen de llamadas incluido, la distribución horaria y los eventuales excedentes quedarán establecidos en las condiciones particulares del servicio.";

export const COMPROMISO = [
  "En GEIMSER no buscamos solamente contestar llamadas. Queremos que cada interacción contribuya a fortalecer la relación con tus clientes, mejorar su experiencia y proyectar una imagen profesional de tu empresa.",
  "Mientras tú te concentras en hacer crecer tu negocio, nosotros nos encargamos de atender a tus clientes.",
];

export const LEMA = "GEIMSER – Su equipo de atención, sin necesidad de contratar uno propio.";

const ZONA = "America/Santiago";

function fechaLarga(fecha: Date): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone: ZONA, day: "numeric", month: "long", year: "numeric" }).format(fecha);
}

function primerNombreDe(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] || nombre;
}

/** Las condiciones particulares que la ejecutiva completó, como filas «campo: valor». */
export function filasCondiciones(condiciones: CondicionesParticulares): Array<[string, string]> {
  return [
    condiciones.llamadas != null ? ["Llamadas incluidas", `${condiciones.llamadas.toLocaleString("es-CL")} al mes`] : null,
    condiciones.horario ? ["Distribución horaria", condiciones.horario] : null,
    condiciones.excedente ? ["Excedentes", condiciones.excedente] : null,
  ].filter((fila): fila is [string, string] => fila !== null);
}

// ── Asunto y remitente ────────────────────────────────────────────────────

export function asuntoPropuestaSv(datos: Pick<DatosPropuestaSv, "cliente" | "folio">): string {
  const empresa = datos.cliente.empresa?.trim().toUpperCase();
  return `Propuesta Comercial${datos.folio ? ` N.º ${datos.folio}` : ""} — Servicio de Ejecutiva Virtual${empresa ? ` | ${empresa}` : ""}`;
}

/** Nombre visible del remitente: la ejecutiva, sobre el buzón de la empresa. */
export function remitenteSv(nombre: string): string {
  return `${nombre.trim()} · ${EMPRESA_SV}`;
}

// ── Correo HTML ───────────────────────────────────────────────────────────
//
// Marca Geimser: azul marino y naranjo del logo. Tablas y estilos en línea
// para Outlook y Gmail; el logo es texto (la «G» en naranjo), así se ve aunque
// el correo bloquee las imágenes. En pantallas chicas las columnas se apilan.

const AZUL = "#1b3561";
const AZUL_OSCURO = "#12264a";
const NARANJO = "#f08a3c";
const NARANJO_SUAVE = "#fdf1e7";
const TINTA = "#1d2733";
const TEXTO = "#45505c";
const GRIS = "#77818c";
const GRIS_CLARO = "#b7c3d4";
const LINEA = "#e3e7ec";
const FONDO = "#eef1f5";
const FUENTE = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;";

function esc(texto: string | null | undefined): string {
  return (texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((parte) => parte[0]!.toUpperCase()).join("") || "GE";
}

/** +56912345678 → +56 9 1234 5678; lo que no calce se deja como vino. */
function telefonoLegible(telefono: string): string {
  const digitos = telefono.replace(/\D/g, "");
  if (digitos.length === 11 && digitos.startsWith("569")) return `+56 9 ${digitos.slice(3, 7)} ${digitos.slice(7)}`;
  return telefono;
}

function etiqueta(texto: string, color = GRIS): string {
  return `<p style="margin:0 0 12px;${FUENTE}font-size:11px;line-height:14px;letter-spacing:1.4px;font-weight:bold;text-transform:uppercase;color:${color};">${esc(texto)}</p>`;
}

function fila(contenido: string, padding = "0 36px"): string {
  return `<tr><td class="px" style="padding:${padding};">${contenido}</td></tr>`;
}

function marca(tamano: number, color: string): string {
  return `<span style="${FUENTE}font-size:${tamano}px;line-height:${tamano + 4}px;font-weight:800;letter-spacing:1px;color:${color};"><span style="color:${NARANJO};">G</span>EIMSER</span>`;
}

function enlaceAceptar(datos: DatosPropuestaSv, asunto: string): string | null {
  const correo = datos.correoRespuesta || datos.ejecutivo.correo;
  if (!correo) return null;
  const empresa = datos.cliente.empresa?.trim() || "nuestra empresa";
  const cuerpo = `Hola ${primerNombreDe(datos.ejecutivo.nombre)}:\n\nQueremos contratar el servicio de Ejecutiva Virtual para ${empresa}. Quedamos atentos a los pasos para comenzar.\n\nSaludos,`;
  return `mailto:${correo}?subject=${encodeURIComponent(`Acepto la propuesta — ${asunto}`)}&body=${encodeURIComponent(cuerpo)}`;
}

function bloqueDatosCliente(datos: DatosPropuestaSv): string {
  const { cliente } = datos;
  const filas: Array<[string, string]> = [
    ["Cliente", cliente.empresa?.trim() || "—"],
    ["RUT", cliente.rut?.trim() || "—"],
    ["Correo", cliente.correo?.trim() || "—"],
    ["Teléfono", cliente.telefono ? telefonoLegible(cliente.telefono.trim()) : "—"],
    ["Fecha", fechaLarga(datos.fecha)],
  ];
  const celdas = filas
    .map(([campo, valor]) => `<tr>
      <td valign="top" width="96" style="padding:3px 12px 3px 0;${FUENTE}font-size:12px;line-height:18px;color:${GRIS};white-space:nowrap;">${esc(campo)}</td>
      <td valign="top" style="padding:3px 0;${FUENTE}font-size:13px;line-height:18px;font-weight:bold;color:${TINTA};word-break:break-word;">${esc(valor)}</td>
    </tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#f6f8fa" style="background:#f6f8fa;border-radius:10px;padding:14px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${celdas}</table>
  </td></tr></table>`;
}

function bloqueInversion(datos: DatosPropuestaSv, asunto: string): string {
  const sim = simular(datos.meses, datos.valorUf);
  const aceptar = enlaceAceptar(datos, asunto);
  const whatsapp = datos.ejecutivo.whatsapp?.replace(/\D/g, "") || null;
  const pesos = sim.pesos
    ? `<p style="margin:10px 0 0;${FUENTE}font-size:13px;line-height:19px;color:${GRIS_CLARO};">Unos <strong style="color:#ffffff;">${formatoPesos(sim.pesos.neto)} + IVA al mes</strong> con la UF de hoy (${formatoPesos(datos.valorUf)}).</p>`
    : "";
  const periodo = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr><td bgcolor="${AZUL_OSCURO}" style="background:${AZUL_OSCURO};border-left:3px solid ${NARANJO};border-radius:6px;padding:10px 14px;${FUENTE}font-size:13px;line-height:19px;color:#ffffff;">
      ${datos.meses === PLAZO_MINIMO ? "Plazo mínimo de 3 meses" : `Contrato de ${datos.meses} meses`}: <strong>${formatoUf(sim.ufNetoPeriodo)} UF + IVA</strong>${sim.pesos ? `, unos ${formatoPesos(sim.pesos.netoPeriodo)} + IVA en total` : ""}.
    </td></tr></table>`;
  const boton = aceptar
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr>
        <td align="center" bgcolor="${NARANJO}" style="background:${NARANJO};border-radius:8px;">
          <a href="${esc(aceptar)}" style="display:inline-block;padding:15px 30px;${FUENTE}font-size:16px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">Aceptar la propuesta &rarr;</a>
        </td></tr></table>`
    : "";
  const alternativa = [
    aceptar ? "o responda este correo" : null,
    whatsapp ? `<a href="https://wa.me/${whatsapp}" style="color:#ffffff;text-decoration:underline;">hable con ${esc(primerNombreDe(datos.ejecutivo.nombre))} por WhatsApp</a>` : null,
  ].filter(Boolean).join(" · ");

  return `<tr><td class="px" bgcolor="${AZUL}" style="background:${AZUL};padding:30px 36px 32px;">
    <p style="margin:0 0 8px;${FUENTE}font-size:11px;line-height:14px;letter-spacing:1.4px;font-weight:bold;text-transform:uppercase;color:#f7c49b;">Propuesta económica · ${esc(PLAN_BASE.nombre)}</p>
    <p class="cifra" style="margin:0;${FUENTE}font-size:44px;line-height:50px;font-weight:bold;letter-spacing:-1px;color:#ffffff;">${formatoUf(sim.ufNeto)} UF <span style="font-size:16px;font-weight:normal;letter-spacing:0;color:${GRIS_CLARO};">+ IVA mensual</span></p>
    ${pesos}
    <p style="margin:12px 0 0;${FUENTE}font-size:13px;line-height:19px;color:#ffffff;">Incluye atención de lunes a viernes, durante 42 horas semanales, bajo modalidad no exclusiva.</p>
    ${periodo}${boton}
    ${alternativa ? `<p style="margin:12px 0 0;${FUENTE}font-size:13px;line-height:19px;color:${GRIS_CLARO};">${aceptar ? "" : "Para avanzar, "}${alternativa}</p>` : ""}
  </td></tr>`;
}

function tablaDosColumnas(filas: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINEA};border-radius:10px;border-collapse:separate;">
    ${filas.map(([campo, valor], i) => `<tr>
      <td class="col" valign="top" width="38%" style="padding:9px 14px;${i ? `border-top:1px solid ${LINEA};` : ""}${FUENTE}font-size:12px;line-height:18px;font-weight:bold;color:${AZUL};">${esc(campo)}</td>
      <td class="col" valign="top" style="padding:9px 14px;${i ? `border-top:1px solid ${LINEA};` : ""}${FUENTE}font-size:13px;line-height:18px;color:${TEXTO};">${esc(valor)}</td>
    </tr>`).join("")}
  </table>`;
}

function lista(items: Array<[string, string]>, marcaColor: string, simbolo: string): string {
  return items
    .map(([titulo, texto]) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 7px;"><tr>
      <td valign="top" width="20" style="${FUENTE}font-size:13px;line-height:20px;font-weight:bold;color:${marcaColor};">${simbolo}</td>
      <td valign="top" style="${FUENTE}font-size:13px;line-height:20px;color:${TEXTO};"><strong style="color:${TINTA};">${esc(titulo)}:</strong> ${esc(texto)}</td>
    </tr></table>`)
    .join("");
}

function parrafos(textos: string[], color = TEXTO): string {
  return textos.map((texto) => `<p style="margin:0 0 10px;${FUENTE}font-size:14px;line-height:22px;color:${color};">${esc(texto)}</p>`).join("");
}

function bloqueCondicionesParticulares(datos: DatosPropuestaSv): string {
  if (!tieneCondiciones(datos.condiciones)) {
    return `<p style="margin:0;${FUENTE}font-size:13px;line-height:20px;color:${GRIS};">${esc(NOTA_CONDICIONES_PARTICULARES)}</p>`;
  }
  return tablaDosColumnas(filasCondiciones(datos.condiciones));
}

function bloqueFirma(datos: DatosPropuestaSv): string {
  const { ejecutivo } = datos;
  const correo = datos.correoRespuesta || ejecutivo.correo;
  const whatsapp = ejecutivo.whatsapp?.replace(/\D/g, "") || null;
  const contacto = [
    whatsapp ? `<a href="https://wa.me/${whatsapp}" style="color:${AZUL};font-weight:bold;text-decoration:none;">WhatsApp ${esc(telefonoLegible(ejecutivo.whatsapp!))}</a>` : null,
    correo ? `<a href="mailto:${esc(correo)}" style="color:${TINTA};text-decoration:none;">${esc(correo)}</a>` : null,
  ].filter(Boolean).join(`<span style="color:${GRIS_CLARO};">&nbsp; · &nbsp;</span>`);
  return fila(`<div style="border-top:1px solid ${LINEA};height:1px;line-height:1px;font-size:0;">&nbsp;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr>
      <td width="58" valign="top">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="46" height="46" align="center" valign="middle" bgcolor="${AZUL}" style="background:${AZUL};border-radius:23px;${FUENTE}font-size:15px;font-weight:bold;color:#ffffff;">${esc(iniciales(ejecutivo.nombre))}</td></tr></table>
      </td>
      <td valign="top">
        <p style="margin:0;${FUENTE}font-size:15px;line-height:21px;font-weight:bold;color:${TINTA};">${esc(ejecutivo.nombre)}</p>
        <p style="margin:0;${FUENTE}font-size:12px;line-height:18px;color:${GRIS};">${esc(ejecutivo.cargo)} · <strong style="color:${NARANJO};">${EMPRESA_SV}</strong>${ejecutivo.firma ? ` · ${esc(ejecutivo.firma)}` : ""}</p>
        ${contacto ? `<p style="margin:6px 0 0;${FUENTE}font-size:13px;line-height:19px;">${contacto}</p>` : ""}
      </td>
    </tr></table>`, "26px 36px 30px");
}

export function correoHtmlSv(datos: DatosPropuestaSv): string {
  const { cliente, fecha } = datos;
  const empresa = cliente.empresa?.trim() || null;
  const asunto = asuntoPropuestaSv(datos);
  const sim = simular(datos.meses, datos.valorUf);
  const preheader = [
    empresa ? `Propuesta para ${empresa}` : "Su propuesta de Ejecutiva Virtual",
    `${formatoUf(sim.ufNeto)} UF + IVA mensual`,
    "atención humana de lunes a viernes, 42 horas semanales",
  ].join(" — ");
  const saludo = `${esc(vocativo(cliente.contacto))} ${saludoSegunHora(fecha).toLocaleLowerCase("es-CL")}. ${
    empresa
      ? `Esta es la propuesta de Ejecutiva Virtual que preparé para <strong style="color:${TINTA};">${esc(empresa)}</strong>.`
      : "Esta es la propuesta de Ejecutiva Virtual que preparé para su empresa."
  }`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(asunto)}</title>
<style>
  a { text-decoration: none; }
  @media only screen and (max-width: 620px) {
    .marco { padding: 0 !important; }
    .px { padding-left: 20px !important; padding-right: 20px !important; }
    .col { display: block !important; width: 100% !important; }
    .cifra { font-size: 34px !important; line-height: 40px !important; }
    .cabecera-derecha { text-align: left !important; padding-top: 10px !important; }
  }
</style></head>
<body style="margin:0;padding:0;background:${FONDO};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${FONDO};">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FONDO}" style="background:${FONDO};"><tr><td class="marco" align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
  <tr><td class="px" bgcolor="#ffffff" style="background:#ffffff;padding:24px 36px 20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="col" valign="middle">${marca(26, AZUL)}</td>
      <td class="col cabecera-derecha" align="right" valign="middle">
        <p style="margin:0;${FUENTE}font-size:11px;line-height:14px;letter-spacing:1.4px;font-weight:bold;text-transform:uppercase;color:${AZUL};">Propuesta comercial${datos.folio ? ` N.º ${esc(datos.folio)}` : ""}</p>
        <p style="margin:3px 0 0;${FUENTE}font-size:12px;line-height:16px;color:${GRIS};">${esc(PLAN_BASE.servicio)}</p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${NARANJO}" style="background:${NARANJO};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
  ${fila(`<p style="margin:0 0 18px;${FUENTE}font-size:15px;line-height:23px;color:${TEXTO};">${saludo}</p>${bloqueDatosCliente(datos)}`, "26px 36px 26px")}
  ${bloqueInversion(datos, asunto)}
  ${fila(`${etiqueta("Descripción del servicio")}${parrafos(DESCRIPCION)}`, "28px 36px 6px")}
  ${fila(`${etiqueta("Características del Plan Base")}${tablaDosColumnas(CARACTERISTICAS)}`, "14px 36px 0")}
  ${fila(`${etiqueta("Beneficios para su empresa")}${lista(BENEFICIOS, NARANJO, "✓")}`, "26px 36px 0")}
  ${fila(`${etiqueta("Condiciones particulares")}${bloqueCondicionesParticulares(datos)}`, "20px 36px 0")}
  ${fila(`${etiqueta("Condiciones de contratación")}${lista(CONDICIONES_CONTRATACION, AZUL, "•")}`, "26px 36px 0")}
  ${fila(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${NARANJO_SUAVE}" style="background:${NARANJO_SUAVE};border-left:4px solid ${NARANJO};border-radius:10px;padding:18px 20px 10px;">
      ${etiqueta("Compromiso GEIMSER", AZUL)}${parrafos(COMPROMISO, TINTA)}
    </td></tr></table>`, "20px 36px 0")}
  ${bloqueFirma(datos)}
  <tr><td class="px" bgcolor="${AZUL}" style="background:${AZUL};padding:16px 36px;${FUENTE}font-size:13px;line-height:19px;color:#ffffff;text-align:center;">${marca(13, "#ffffff")} – Su equipo de atención, sin necesidad de contratar uno propio.</td></tr>
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;"><tr><td class="px" style="padding:18px 36px 0;${FUENTE}font-size:11px;line-height:16px;color:${GRIS};text-align:center;">
  Valores en UF más IVA; el monto en pesos es referencial, con la UF del ${esc(fechaLarga(fecha))}.<br>
  ${EMPRESA_SV} · Propuesta confidencial para ${empresa ? esc(empresa) : "su destinatario"}.
</td></tr></table>
</td></tr></table>
</body></html>`;
}

// ── WhatsApp y texto plano ────────────────────────────────────────────────

const RAYA = "━━━━━━━━━━━━━━━━━━━━";

/** El mensaje de WhatsApp, con el formato de WhatsApp (*negrita*, _cursiva_). */
export function mensajeWhatsappSv(datos: DatosPropuestaSv): string {
  const { cliente, ejecutivo } = datos;
  const sim = simular(datos.meses, datos.valorUf);
  const empresa = cliente.empresa?.trim().toUpperCase() || null;
  const condiciones = filasCondiciones(datos.condiciones);
  const correo = datos.correoRespuesta || ejecutivo.correo;
  return [
    cliente.contacto ? vocativo(cliente.contacto) : empresa ? `Señores *${empresa}*:` : "Estimados:",
    `${saludoSegunHora(datos.fecha)}. Le envío la propuesta comercial${datos.folio ? ` N.º ${datos.folio}` : ""} del *Servicio de Ejecutiva Virtual*${empresa && cliente.contacto ? ` para *${empresa}*` : ""}.`,
    cliente.rut ? `RUT: ${cliente.rut}` : null,
    "",
    RAYA,
    `*${PLAN_BASE.nombre.toUpperCase()}*`,
    RAYA,
    "",
    "✔️ Atención 100 % humana: telefónica, WhatsApp, correo y administrativa",
    "✔️ Lunes a viernes, 42 horas semanales, ejecutiva compartida",
    "✔️ Filtro y derivación según sus protocolos",
    "✔️ Registro de cada contacto y reportería online",
    "",
    `*Valor mensual: ${formatoUf(sim.ufNeto)} UF + IVA*`,
    sim.pesos ? `💰 _Aprox. ${formatoPesos(sim.pesos.neto)} + IVA al mes_` : null,
    `📅 ${datos.meses === PLAZO_MINIMO ? "Plazo mínimo: *3 meses*" : `Contrato: *${datos.meses} meses*`} (${formatoUf(sim.ufNetoPeriodo)} UF + IVA${sim.pesos ? `, aprox. ${formatoPesos(sim.pesos.netoPeriodo)} + IVA` : ""})`,
    "🔁 Renovación trimestral, semestral o anual; término con aviso escrito de 15 días corridos.",
    "",
    ...(condiciones.length
      ? ["*Condiciones particulares*", ...condiciones.map(([campo, valor]) => `• ${campo}: ${valor}`), ""]
      : [NOTA_CONDICIONES_PARTICULARES, ""]),
    "Mientras usted se concentra en hacer crecer su negocio, nosotros atendemos a sus clientes.",
    "",
    "Quedo a su disposición 🤝",
    "",
    "—",
    `*${ejecutivo.nombre}*`,
    `_${ejecutivo.cargo} · ${EMPRESA_SV}_`,
    ejecutivo.whatsapp ? `📱 ${ejecutivo.whatsapp}` : null,
    correo ? `✉ ${correo}` : null,
  ].filter((linea): linea is string => linea !== null).join("\n");
}

/** La parte de texto del correo: el mismo mensaje sin las marcas de WhatsApp. */
export function correoTextoSv(datos: DatosPropuestaSv): string {
  return mensajeWhatsappSv(datos).replace(/\*([^*\n]+)\*/g, "$1").replace(/_([^_\n]+)_/g, "$1");
}
