import nodemailer from "nodemailer";

import type { Buzon } from "./buzon";

/** Imagen incrustada en el HTML con `cid:`. */
export type ImagenIncrustada = { cid: string; nombre: string; base64: string; tipo: string };

/**
 * Enviar un correo por el SMTP del buzón de la empresa. Devuelve el
 * Message-ID para que la respuesta, cuando llegue, se enlace al hilo. Con
 * `html` va en dos partes (HTML y texto); las imágenes incrustadas viajan
 * dentro del mensaje porque muchos correos corporativos bloquean las remotas.
 */
export async function enviarCorreo(
  buzon: Buzon,
  correo: {
    para: string;
    nombre?: string | null;
    asunto: string;
    texto: string;
    html?: string | null;
    copiaOculta?: string[];
    imagenes?: ImagenIncrustada[];
    inReplyTo?: string | null;
    /** Nombre visible del remitente, si no es el del buzón (p. ej. "Ana Pérez · Equifax"). */
    remitenteNombre?: string | null;
    /** A dónde vuelven las respuestas; por defecto, el mismo buzón. */
    responderA?: string | null;
  },
) {
  const nombre = correo.remitenteNombre?.trim() || buzon.remitente;
  const transporte = nodemailer.createTransport({
    host: buzon.smtp_host,
    port: buzon.smtp_port,
    secure: buzon.smtp_port === 465,
    auth: { user: buzon.usuario, pass: buzon.clave },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  const resultado = await transporte.sendMail({
    from: nombre ? `"${nombre.replace(/"/g, "")}" <${buzon.address}>` : buzon.address,
    replyTo: correo.responderA?.trim() || buzon.address,
    to: correo.nombre ? `"${correo.nombre.replace(/"/g, "")}" <${correo.para}>` : correo.para,
    subject: correo.asunto,
    text: correo.texto,
    ...(correo.html ? { html: correo.html } : {}),
    ...(correo.copiaOculta?.length ? { bcc: correo.copiaOculta } : {}),
    ...(correo.imagenes?.length
      ? {
          attachments: correo.imagenes.map((imagen) => ({
            filename: imagen.nombre,
            content: Buffer.from(imagen.base64, "base64"),
            contentType: imagen.tipo,
            cid: imagen.cid,
          })),
        }
      : {}),
    ...(correo.inReplyTo ? { inReplyTo: correo.inReplyTo, references: correo.inReplyTo } : {}),
  });
  return { messageId: resultado.messageId as string, aceptados: (resultado.accepted ?? []).length };
}
