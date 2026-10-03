import { ArrowDownLeft, ArrowUpRight, Reply } from "lucide-react";

import { queueAssignedMailReply } from "@/app/actions/mail";
import { ActionForm, ActionSubmit, Avatar, Badge, SectionCard } from "@/components/ui";
import { CountBox, dateTimeLabel, relativeLabel } from "@/components/record-kit";
import { hasAtlasLeadOriginal, parseMailMessageBody } from "@/lib/mail-message-body";

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
      actions={<CountBox>{messages.length}</CountBox>}
    >
      <div className="border-t border-border">
        <ol className="divide-y divide-border">
          {messages.map((message) => {
            const bodySegments = parseMailMessageBody(message.body_text);
            const inbound = message.direction === "inbound";
            const sender = message.from_email ?? (inbound ? "Contacto" : "Atlas");

            return (
              <li key={message.id} className="px-5 py-4">
                {/* Quién escribe y hacia dónde va: el chip dice si entró o salió,
                    sin pintar la tarjeta entera de un color. */}
                <div className="flex items-start gap-3">
                  <Avatar name={sender} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="min-w-0 text-sm font-medium text-foreground">{message.subject}</p>
                      <time
                        dateTime={message.occurred_at}
                        title={dateTimeLabel(message.occurred_at)}
                        suppressHydrationWarning
                        className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
                      >
                        {relativeLabel(message.occurred_at)}
                      </time>
                    </div>
                    <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="icon-chip size-4 rounded" data-tone={inbound ? "teal" : "primary"} aria-hidden="true">
                        {inbound ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}
                      </span>
                      <span className="font-medium text-foreground/80">{inbound ? "Recibido" : "Enviado"}</span>
                      <span aria-hidden="true">·</span>
                      <span className="min-w-0 break-all">
                        {message.from_email ?? "—"} → {message.to_email ?? "—"}
                      </span>
                    </p>
                  </div>
                </div>
                {message.direction === "outbound" && hasAtlasLeadOriginal(message.external_message_id) && !bodySegments.some((segment) => segment.kind === "image") ? (
                  <div className="mt-3 overflow-hidden rounded-lg border border-border sm:ml-12">
                    {/* El HTML del correo está diseñado sobre blanco: se muestra tal cual llega al contacto. */}
                    <iframe
                      src={`/api/correo-campana/${message.id}`}
                      title={`Correo original: ${message.subject}`}
                      loading="lazy"
                      sandbox="allow-popups allow-popups-to-escape-sandbox"
                      className="block h-[760px] w-full border-0 bg-white"
                    />
                    <p className="border-t border-border bg-surface-raised px-4 py-2 text-right">
                      <a href={`/api/correo-campana/${message.id}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">
                        Abrir el correo en una pestaña
                      </a>
                    </p>
                  </div>
                ) : (
                <div className="mt-3 space-y-3 sm:pl-12">
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
                          className="mx-auto max-h-[720px] w-full rounded-lg border border-border bg-white object-contain"
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
              </li>
            );
          })}
        </ol>

      <div className="space-y-4 border-t border-border px-5 py-4 empty:hidden">
        {commands.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Respuestas solicitadas desde CRM</p>
            {commands.map((command) => (
              <div key={command.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
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
              className="mt-2 w-full rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            <div className="mt-3 flex justify-end">
              <ActionSubmit pendingLabel="Encolando…">
                <Reply size={15} aria-hidden="true" /> Enviar respuesta
              </ActionSubmit>
            </div>
          </ActionForm>
        )}
      </div>
      </div>
    </SectionCard>
  );
}
