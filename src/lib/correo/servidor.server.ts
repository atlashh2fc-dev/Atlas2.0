import { resolveMx } from "node:dns/promises";

/**
 * Los servidores IMAP y SMTP de una casilla, deducidos de su dominio.
 *
 * Quien conecta una casilla no tiene por qué saber qué es IMAP: el MX del
 * dominio dice dónde vive el correo (Google Workspace, Microsoft 365 o un
 * cPanel propio). Así, para conectar la casilla solo falta escribir la clave.
 */
export type ServidorDeCorreo = {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  proveedor: "google" | "microsoft" | "propio";
};

export async function servidorDeCorreo(address: string): Promise<ServidorDeCorreo | null> {
  const dominio = address.split("@")[1]?.trim().toLowerCase();
  if (!dominio) return null;
  try {
    const mx = (await resolveMx(dominio)).sort((a, b) => a.priority - b.priority);
    const principal = mx[0]?.exchange.toLowerCase();
    if (!principal) return null;
    if (/google\.com$|googlemail\.com$/.test(principal)) {
      return { imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 465, proveedor: "google" };
    }
    if (/outlook\.com$/.test(principal)) {
      return { imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587, proveedor: "microsoft" };
    }
    // cPanel y similares: el mismo servidor del MX atiende IMAP y SMTP.
    return { imap_host: principal, imap_port: 993, smtp_host: principal, smtp_port: 465, proveedor: "propio" };
  } catch {
    return null;
  }
}
