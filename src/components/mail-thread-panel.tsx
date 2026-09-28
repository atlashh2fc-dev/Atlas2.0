import { Mail, Reply } from "lucide-react";

import { queueAssignedMailReply } from "@/app/actions/mail";
import { ActionForm, ActionSubmit, Badge, SectionCard } from "@/components/ui";
import { parseMailMessageBody } from "@/lib/mail-message-body";

export type LeadMailMessage = {
  /** Id del correo en Atlas Lead: con él se reconstruye el original. */
  external_message_id?: string | null;
  id: string;
  direction: "inbound" | "outbound";
  from_email: string | null;
  to_email: string | null;
  subject: string;
  body_text: string;
  occurred_at: string;
};

export type LeadMailReplyCommand = {
  id: string;
  subject: string;
  body_text: string;
  status: "queued" | "delivered" | "failed";
  last_error: string | null;
  created_at: string;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
}

export function MailThreadPanel({
  leadId,
  messages,
  commands,
  canReply,
}: {
  leadId: string;
  messages: LeadMailMessage[];
  commands: LeadMailReplyCommand[];
  canReply: boolean;
}) {
  if (!messages.length) return null;
  const latestMessage = messages.at(-1)!;

  return (
    <SectionCard
      title="Hilo de correo"
      description="Mensajes enviados y respuestas de esta oportunidad."
      icon={Mail}
      tone="teal"
      actions={<Badge tone="neutral">{messages.length} mensaje{messages.length === 1 ? "" : "s"}</Badge>}
    >
      <div className="space-y-4 p-4">
        <div className="space-y-3">
          {messages.map((message) => {
            const bodySegments = parseMailMessageBody(message.body_text);
            const inbound = message.direction === "inbound";

            return (
              <article
                key={message.id}
                className={`overflow-hidden rounded-xl border shadow-sm ${inbound ? "border-border" : "border-primary/30"}`}
              >
                {/* Entrante en superficie apagada; saliente tintado con el primario, en ambos temas. */}
                <div className={`p-4 ${inbound ? "bg-surface-muted" : "bg-primary/10"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={inbound ? "success" : "info"}>
                        {inbound ? "Recibido" : "Enviado"}
                      </Badge>
                      <p className="text-sm font-medium text-foreground">{message.subject}</p>
                    </div>
                    <time className="text-xs text-muted-foreground">{formatDateTime(message.occurred_at)}</time>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {message.from_email ?? "—"} → {message.to_email ?? "—"}
                  </p>
                </div>
                {message.direction === "outbound" && message.external_message_id && !bodySegments.some((segment) => segment.kind === "image") ? (
                  <div className="border-t border-border/70 bg-surface">
                    {/* El HTML del correo está diseñado sobre blanco: se muestra tal cual llega al contacto. */}
                    <iframe
                      src={`/api/correo-campana/${message.id}`}
                      title={`Correo original: ${message.subject}`}
                      loading="lazy"
                      sandbox="allow-popups allow-popups-to-escape-sandbox"
                      className="block h-[760px] w-full border-0 bg-white"
                    />
                    <p className="border-t border-border/70 px-4 py-2 text-right">
                      <a href={`/api/correo-campana/${message.id}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">
                        Abrir el correo en una pestaña
                      </a>
                    </p>
                  </div>
                ) : (
                <div className="space-y-3 border-t border-border/70 bg-surface p-4">
                  {bodySegments.map((segment, index) =>
                    segment.kind === "text" ? (
                      <p key={`text-${index}`} className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                        {segment.value.trim()}
                      </p>
                    ) : (
                      <figure key={`image-${index}`} className="space-y-2">
                        {/* Dynamic campaign assets cannot be declared as fixed Next Image hosts. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={segment.url}
                          alt={`Pieza gráfica del correo: ${message.subject}`}
                          loading="lazy"
                          className="mx-auto max-h-[720px] w-full rounded-xl border border-border bg-white object-contain"
                        />
                        <figcaption className="text-right">
                          <a
                            href={segment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Abrir pieza en tamaño completo
                          </a>
                        </figcaption>
                      </figure>
                    ),
                  )}
                </div>
                )}
              </article>
            );
          })}
        </div>

        {commands.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Respuestas solicitadas desde CRM</p>
            {commands.map((command) => (
              <div key={command.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{command.subject}</span>
                <Badge tone={command.status === "delivered" ? "success" : command.status === "failed" ? "danger" : "warning"}>
                  {command.status === "delivered" ? "Enviada" : command.status === "failed" ? "Fallida" : "En cola"}
                </Badge>
                {command.last_error && <p className="w-full text-xs text-danger">{command.last_error}</p>}
              </div>
            ))}
          </div>
        )}

        {canReply && (
          <ActionForm action={queueAssignedMailReply} success="Respuesta encolada para envío">
            <input type="hidden" name="lead_id" value={leadId} />
            <input type="hidden" name="source_message_id" value={latestMessage.id} />
            <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
            <label className="block text-sm font-medium text-foreground" htmlFor="mail-reply-body">
              Responder
            </label>
            <textarea
              id="mail-reply-body"
              name="body_text"
              required
              maxLength={20000}
              rows={5}
              placeholder="Escribe la respuesta que recibirá el contacto…"
              className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            <div className="mt-3 flex justify-end">
              <ActionSubmit pendingLabel="Encolando…">
                <Reply size={15} aria-hidden="true" /> Enviar respuesta
              </ActionSubmit>
            </div>
          </ActionForm>
        )}
      </div>
    </SectionCard>
  );
}
