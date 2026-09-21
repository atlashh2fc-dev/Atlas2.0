import { createAdminClient } from "@/lib/supabase/admin";

/**
 * El buzón de una empresa: dónde leer (IMAP), por dónde responder (SMTP) y
 * con qué clave. La clave vive en el Vault de Supabase; solo la clave de
 * servicio la lee, y solo para conectar. La casilla histórica del call
 * center sigue con sus secretos de entorno.
 */

export type Buzon = {
  id: string;
  organization_id: string | null;
  campaign_id: string | null;
  address: string;
  label: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  usuario: string;
  clave: string;
  remitente: string | null;
  last_uid: number;
};

type Fila = {
  id: string;
  organization_id: string | null;
  campaign_id: string | null;
  address: string;
  label: string;
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  usuario: string | null;
  clave_secreto: string | null;
  remitente: string | null;
  last_uid: number | null;
  active: boolean;
};

const HOST_LEGADO = process.env.INBOUND_MAIL_HOST?.trim() || "cp7045.webempresa.eu";

async function completar(admin: ReturnType<typeof createAdminClient>, fila: Fila): Promise<Buzon | null> {
  let clave: string | null = null;
  let usuario = fila.usuario ?? fila.address;
  if (fila.clave_secreto) {
    const { data } = await admin.rpc("leer_clave_de_buzon", { p_mailbox: fila.id });
    clave = typeof data === "string" && data ? data : null;
  } else if (process.env.INBOUND_MAIL_USER?.trim().toLowerCase() === fila.address.toLowerCase()) {
    // La casilla histórica: sus secretos siguen en el entorno.
    usuario = process.env.INBOUND_MAIL_USER!.trim();
    clave = process.env.INBOUND_MAIL_PASSWORD?.trim() || null;
  }
  if (!clave) return null;
  return {
    id: fila.id,
    organization_id: fila.organization_id,
    campaign_id: fila.campaign_id,
    address: fila.address,
    label: fila.label,
    imap_host: fila.imap_host ?? HOST_LEGADO,
    imap_port: fila.imap_port ?? Number(process.env.INBOUND_MAIL_PORT || 993),
    smtp_host: fila.smtp_host ?? fila.imap_host ?? HOST_LEGADO,
    smtp_port: fila.smtp_port ?? 465,
    usuario,
    clave,
    remitente: fila.remitente,
    last_uid: Number(fila.last_uid ?? 0),
  };
}

const CAMPOS = "id, organization_id, campaign_id, address, label, imap_host, imap_port, smtp_host, smtp_port, usuario, clave_secreto, remitente, last_uid, active";

/** El buzón de una empresa, listo para conectar, o null si no tiene o no tiene clave. */
export async function buzonDeEmpresa(organizationId: string): Promise<Buzon | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("inbound_mailboxes").select(CAMPOS).eq("organization_id", organizationId).is("campaign_id", null).eq("active", true).limit(1).maybeSingle();
  return data ? completar(admin, data as Fila) : null;
}

/** Todos los buzones activos con clave, para la sincronización. */
export async function buzonesActivos(): Promise<Buzon[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("inbound_mailboxes").select(CAMPOS).eq("active", true).order("created_at");
  const listos: Buzon[] = [];
  for (const fila of (data ?? []) as Fila[]) {
    const buzon = await completar(admin, fila);
    if (buzon) listos.push(buzon);
  }
  return listos;
}
