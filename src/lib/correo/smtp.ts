import nodemailer from "nodemailer";

import type { Buzon } from "./buzon";

/**
 * Enviar un correo por el SMTP del buzón de la empresa. Devuelve el
 * Message-ID para que la respuesta, cuando llegue, se enlace al hilo.
 */
export async function enviarCorreo(buzon: Buzon, correo: { para: string; nombre?: string | null; asunto: string; texto: string; inReplyTo?: string | null }) {
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
    from: buzon.remitente ? `"${buzon.remitente.replace(/"/g, "")}" <${buzon.address}>` : buzon.address,
    to: correo.nombre ? `"${correo.nombre.replace(/"/g, "")}" <${correo.para}>` : correo.para,
    subject: correo.asunto,
    text: correo.texto,
    ...(correo.inReplyTo ? { inReplyTo: correo.inReplyTo, references: correo.inReplyTo } : {}),
  });
  return { messageId: resultado.messageId as string, aceptados: (resultado.accepted ?? []).length };
}
