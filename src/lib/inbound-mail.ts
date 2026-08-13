import { ImapFlow } from "imapflow";
import PostalMime from "postal-mime";

import { createAdminClient } from "@/lib/supabase/admin";

const INITIAL_MESSAGE_LIMIT = 100;
const MAX_BODY_CHARS = 50_000;
const MAX_PREVIEW_CHARS = 320;

export type InboundSyncResult = {
  imported: number;
  skipped: number;
  mailbox: string;
  syncedAt: string;
};

export type InboundDeleteResult = {
  deleted: number;
  movedToTrash: boolean;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta configurar el secreto ${name}.`);
  return value;
}

function createInboundClient() {
  const host = process.env.INBOUND_MAIL_HOST?.trim() || "cp7045.webempresa.eu";
  const port = Number(process.env.INBOUND_MAIL_PORT || "993");
  const user = required("INBOUND_MAIL_USER");
  const pass = required("INBOUND_MAIL_PASSWORD");
  return {
    user,
    client: new ImapFlow({
      host,
      port,
      secure: true,
      auth: { user, pass },
      logger: false,
    }),
  };
}

function normalizeBody(value: string | undefined): string {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_BODY_CHARS);
}

function preview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_PREVIEW_CHARS);
}

/** Detecta teléfonos chilenos habituales sin inventar un número cuando no existe. */
export function detectChileanPhone(value: string): string | null {
  const candidates = value.match(/(?:\+?56[\s.-]?)?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}/g) ?? [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length === 9 && digits.startsWith("9")) return `+56${digits}`;
    if (digits.length === 11 && digits.startsWith("569")) return `+${digits}`;
    if (digits.length === 8) return digits;
  }
  return null;
}

export async function syncAbogadoLegalInbox(): Promise<InboundSyncResult> {
  const { user, client } = createInboundClient();
  const admin = createAdminClient();

  const { data: mailbox, error: mailboxError } = await admin
    .from("inbound_mailboxes")
    .select("id,address,last_uid")
    .eq("address", user.toLowerCase())
    .eq("active", true)
    .single();

  if (mailboxError || !mailbox) {
    throw new Error(mailboxError?.message || "La casilla no está registrada en Atlas.");
  }

  let imported = 0;
  let skipped = 0;
  let highestUid = Number(mailbox.last_uid || 0);
  const syncedAt = new Date().toISOString();

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const status = await client.status("INBOX", { uidNext: true });
      const firstUid = highestUid > 0
        ? highestUid + 1
        : Math.max(1, Number(status.uidNext || 1) - INITIAL_MESSAGE_LIMIT);
      const lastUid = Math.max(0, Number(status.uidNext || 1) - 1);

      if (firstUid <= lastUid) {
        for await (const message of client.fetch(
          `${firstUid}:${lastUid}`,
          { uid: true, source: true, envelope: true, internalDate: true },
          { uid: true }
        )) {
          highestUid = Math.max(highestUid, Number(message.uid));
          if (!message.source) {
            skipped += 1;
            continue;
          }

          const parsed = await PostalMime.parse(message.source);
          const fromAddress = parsed.from?.address?.trim().toLowerCase();
          if (!fromAddress) {
            skipped += 1;
            continue;
          }

          const bodyText = normalizeBody(parsed.text);
          const replyTo = parsed.replyTo?.[0]?.address?.trim().toLowerCase() || null;
          const internalDate = message.internalDate
            ? new Date(message.internalDate).toISOString()
            : syncedAt;
          const receivedAt = parsed.date || internalDate;
          const { error } = await admin.from("inbound_emails").upsert(
            {
              mailbox_id: mailbox.id,
              imap_uid: Number(message.uid),
              message_id: parsed.messageId || message.envelope?.messageId || null,
              from_name: parsed.from?.name?.trim() || null,
              from_address: fromAddress,
              reply_to_address: replyTo,
              subject: parsed.subject?.trim() || "(Sin asunto)",
              body_text: bodyText,
              preview: preview(bodyText),
              detected_phone: detectChileanPhone(bodyText),
              received_at: new Date(receivedAt).toISOString(),
            },
            { onConflict: "mailbox_id,imap_uid", ignoreDuplicates: true }
          );

          if (error) throw error;
          imported += 1;
        }
      }
    } finally {
      lock.release();
    }

    const { error: stateError } = await admin
      .from("inbound_mailboxes")
      .update({ last_uid: highestUid, last_synced_at: syncedAt, last_sync_error: null })
      .eq("id", mailbox.id);
    if (stateError) throw stateError;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Error desconocido de sincronización";
    await admin
      .from("inbound_mailboxes")
      .update({ last_synced_at: syncedAt, last_sync_error: message })
      .eq("id", mailbox.id);
    throw new Error(`No se pudo sincronizar ${mailbox.address}: ${message}`);
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
  }

  return { imported, skipped, mailbox: mailbox.address, syncedAt };
}

/**
 * Elimina una selección validada tanto del INBOX remoto como del espejo local.
 * Si el proveedor expone una carpeta con special-use \Trash, se mueve allí para
 * conservar una vía de recuperación; solo se expurga cuando no existe Papelera.
 */
export async function deleteAbogadoLegalEmails(emailIds: string[]): Promise<InboundDeleteResult> {
  const ids = [...new Set(emailIds.filter(Boolean))].slice(0, 100);
  if (ids.length === 0) throw new Error("Selecciona al menos un correo.");

  const { user, client } = createInboundClient();
  const admin = createAdminClient();
  const { data: mailbox, error: mailboxError } = await admin
    .from("inbound_mailboxes")
    .select("id,address")
    .eq("address", user.toLowerCase())
    .eq("active", true)
    .single();
  if (mailboxError || !mailbox) throw new Error(mailboxError?.message || "La casilla no está registrada.");

  const { data: messages, error: messagesError } = await admin
    .from("inbound_emails")
    .select("id,imap_uid")
    .eq("mailbox_id", mailbox.id)
    .in("id", ids);
  if (messagesError) throw new Error(messagesError.message);
  if (!messages?.length) return { deleted: 0, movedToTrash: false };

  const uids = messages.map((message) => Number(message.imap_uid));
  let movedToTrash = false;
  try {
    await client.connect();
    const mailboxes = await client.list();
    const trash = mailboxes.find((item) => item.specialUse === "\\Trash");
    const lock = await client.getMailboxLock("INBOX");
    try {
      if (trash && trash.path.toUpperCase() !== "INBOX") {
        const moved = await client.messageMove(uids, trash.path, { uid: true });
        if (moved === false) throw new Error("El servidor no confirmó el movimiento a Papelera.");
        movedToTrash = true;
      } else {
        const deleted = await client.messageDelete(uids, { uid: true });
        if (!deleted) throw new Error("El servidor no confirmó la eliminación.");
      }
    } finally {
      lock.release();
    }

    const messageIds = messages.map((message) => message.id);
    const { error: deleteError } = await admin.from("inbound_emails").delete().in("id", messageIds);
    if (deleteError) throw deleteError;
    return { deleted: messages.length, movedToTrash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al eliminar correos";
    throw new Error(`No se pudieron eliminar los correos de ${mailbox.address}: ${message}`);
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
  }
}
