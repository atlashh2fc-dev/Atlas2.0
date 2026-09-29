/**
 * El correo de la cuenta Equifax: todo sale del buzón de la empresa con el
 * nombre del ejecutivo y con copia oculta a la jefatura comercial, sea la
 * propuesta del cotizador o una respuesta escrita en la ficha.
 */

import { EMPRESA_FIRMA, type EjecutivoFirma } from "./propuesta.ts";

export const COPIA_OCULTA_EQUIFAX = ["eduranb@geoinfobusiness.cl"];

function esc(texto: string | null | undefined): string {
  return (texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Re: …" una sola vez. */
export function asuntoDeRespuesta(asunto: string): string {
  const limpio = asunto.trim() || "Propuesta Equifax";
  return /^(re|rv|fw|fwd):/i.test(limpio) ? limpio : `Re: ${limpio}`;
}

/** Texto plano de la respuesta con la firma del ejecutivo al pie. */
export function respuestaTexto(texto: string, ejecutivo: EjecutivoFirma, correoRespuesta: string): string {
  return [
    texto.trim(),
    "",
    "—",
    ejecutivo.nombre,
    `${ejecutivo.cargo} · ${EMPRESA_FIRMA}`,
    ejecutivo.whatsapp ? `WhatsApp ${ejecutivo.whatsapp}` : null,
    correoRespuesta,
  ].filter((fila): fila is string => fila !== null).join("\n");
}

/** La misma respuesta en HTML sobrio: párrafos y la firma con los colores de la propuesta. */
export function respuestaHtml(texto: string, ejecutivo: EjecutivoFirma, correoRespuesta: string): string {
  const fuente = "font-family:'Open Sans','Helvetica Neue',Helvetica,Arial,sans-serif;";
  const parrafos = texto
    .trim()
    .split(/\n{2,}/)
    .map((parrafo) => `<p style="margin:0 0 14px;${fuente}font-size:14px;line-height:22px;color:#333e48;">${esc(parrafo).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const whatsapp = ejecutivo.whatsapp?.replace(/\D/g, "") || null;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;background:#ffffff;">
${parrafos}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;border-left:3px solid #9e1b32;"><tr><td style="padding:2px 0 2px 12px;">
  <p style="margin:0;${fuente}font-size:14px;line-height:20px;font-weight:bold;color:#1f262d;">${esc(ejecutivo.nombre)}</p>
  <p style="margin:0;${fuente}font-size:12px;line-height:18px;color:#76808a;">${esc(ejecutivo.cargo)} · <strong style="color:#9e1b32;">${EMPRESA_FIRMA}</strong></p>
  <p style="margin:4px 0 0;${fuente}font-size:12px;line-height:18px;color:#333e48;">${whatsapp ? `<a href="https://wa.me/${whatsapp}" style="color:#9e1b32;text-decoration:none;">WhatsApp ${esc(ejecutivo.whatsapp)}</a> · ` : ""}<a href="mailto:${esc(correoRespuesta)}" style="color:#333e48;text-decoration:none;">${esc(correoRespuesta)}</a></p>
</td></tr></table>
</body></html>`;
}
